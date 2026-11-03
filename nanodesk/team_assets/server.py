"""Public team-asset sidecar (aiohttp): catalog, fixed-version download, submissions.

Security boundary (see handoff):

- Anonymous callers may only read the published catalog / fixed-version
  bundles and append size-limited pending submissions.
- Anonymous callers can never write published assets or list pending ones.
- Review / approve / reject stays on the team WebUI authenticated channel
  (existing ``webui_request`` mutations), never on this sidecar.
- CORS is ``*`` for these public GET/submit routes only; no credentials.
"""

from __future__ import annotations

import json
import time
from collections import defaultdict, deque
from pathlib import Path
from typing import Any, cast

from aiohttp import web
from loguru import logger

from nanodesk.team_assets.bundles import (
    MAX_SKILL_MARKDOWN_BYTES,
    build_mcp_manifest_envelope,
    build_skill_bundle,
    sanitize_mcp_manifest,
    validate_skill_markdown,
)
from nanodesk.team_assets.live import (
    find_live_row,
    load_live_mcp_manifest,
    load_live_skill_markdown,
    merged_catalog_rows,
)
from nanodesk.team_assets.store import (
    TeamAssetStore,
    normalize_asset_id,
    normalize_submission_id,
)

MAX_SUBMISSION_BYTES = 64 * 1024
GET_RATE_LIMIT = 60
GET_RATE_WINDOW_S = 60.0
SUBMIT_RATE_LIMIT = 10
SUBMIT_RATE_WINDOW_S = 3600.0

_SUBMITTER_MAX_LEN = 64
_VERSION_MAX_LEN = 32

__all__ = ["create_team_assets_app"]

_rate_hits: dict[str, deque[float]] = defaultdict(deque)


def _client_ip(request: web.Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()[:64] or "unknown"
    peer = request.remote or "unknown"
    return peer[:64]


def _check_rate(request: web.Request, *, limit: int, window_s: float) -> bool:
    now = time.monotonic()
    key = f"{_client_ip(request)}:{request.path}"
    hits = _rate_hits[key]
    while hits and now - hits[0] > window_s:
        hits.popleft()
    if len(hits) >= limit:
        return False
    hits.append(now)
    return True


def _cors_headers() -> dict[str, str]:
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "600",
    }


def _json(data: Any, *, status: int = 200) -> web.Response:
    return web.json_response(data, status=status, headers=_cors_headers())


def _error(status: int, message: str) -> web.Response:
    return _json({"error": {"message": message, "code": status}}, status=status)


async def _preflight(_request: web.Request) -> web.Response:
    return web.Response(status=204, headers=_cors_headers())


def create_team_assets_app(
    store: TeamAssetStore,
    *,
    instance_id: str,
    name: str = "",
    description: str = "",
    config_path: Path | str,
    workspace_path: Path | str,
) -> web.Application:
    """Build the public sidecar app bound to one team instance identity.

    The catalog is assembled live on every request: local skills/MCP
    servers appear as ``origin == "local"`` rows with content-derived
    versions, alongside approved fixed-version snapshots. The config is
    reloaded per request so WebUI edits show up immediately; when it
    cannot be loaded the sidecar degrades to fixed snapshots only.
    """
    identity = instance_id.strip()
    if not identity:
        raise ValueError("instance_id is required")
    app = web.Application(client_max_size=MAX_SUBMISSION_BYTES + 4096)
    app["team_asset_store"] = store
    app["team_instance_id"] = identity
    app["team_name"] = name.strip()[:64]
    app["team_description"] = description.strip()[:512]
    live_workspace = Path(workspace_path).expanduser()
    live_config_path = Path(config_path).expanduser()

    def _live_config() -> Any | None:
        try:
            from nanodesk.config.loader import load_config

            return load_config(live_config_path)
        except Exception as exc:  # never break the catalog on config errors
            logger.warning("team asset live catalog unavailable: {}", exc)
            return None

    def _published_rows() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        skills = [
            {
                "id": asset.asset_id,
                "version": asset.version,
                "description": asset.description,
                "content_hash": asset.content_hash,
                "origin": asset.origin or "local",
                "enabled": True,
            }
            for asset in store.list_published("skill")
        ]
        mcp = [
            {
                "id": asset.asset_id,
                "version": asset.version,
                "description": asset.description,
                "content_hash": asset.content_hash,
                "origin": asset.origin or "local",
                "enabled": True,
            }
            for asset in store.list_published("mcp")
        ]
        return skills, mcp

    def _merged_rows() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """Return merged (skills, mcp) rows, live local first."""
        config = _live_config()
        if config is None:
            return _published_rows()
        merged = merged_catalog_rows(live_workspace, config, team_instance_id=identity)
        return merged["skills"], merged["mcp"]

    async def handle_health(_request: web.Request) -> web.Response:
        return _json({"status": "ok"})

    async def handle_info(_request: web.Request) -> web.Response:
        return _json(
            {
                "instance_id": identity,
                "name": app["team_name"],
                "description": app["team_description"],
            }
        )

    async def handle_catalog(request: web.Request) -> web.Response:
        if not _check_rate(
            request, limit=GET_RATE_LIMIT, window_s=GET_RATE_WINDOW_S
        ):
            return _error(429, "rate limited")
        skills, mcp = _merged_rows()
        return _json({"instance_id": identity, "skills": skills, "mcp": mcp})

    async def handle_download(request: web.Request) -> web.Response:
        if not _check_rate(
            request, limit=GET_RATE_LIMIT, window_s=GET_RATE_WINDOW_S
        ):
            return _error(429, "rate limited")
        kind = request.match_info.get("kind", "")
        if kind not in ("skill", "mcp"):
            return _error(404, "unknown asset kind")
        try:
            asset_id = normalize_asset_id(
                "skill" if kind == "skill" else "mcp",
                request.match_info.get("asset_id", ""),
            )
            from nanodesk.team_assets.store import normalize_version

            version = normalize_version(request.match_info.get("version", ""))
        except ValueError as exc:
            return _error(400, str(exc))
        try:
            payload = store.read_published_bytes(
                "skill" if kind == "skill" else "mcp", asset_id, version
            )
        except FileNotFoundError:
            payload = None
        except ValueError as exc:
            logger.warning("team asset integrity failure: {}", exc)
            return _error(500, "asset integrity check failed")
        if payload is None:
            # No fixed-version snapshot: fall back to the live asset when
            # the requested version still matches its current content.
            # A mismatch means the asset changed (or was removed) after
            # the consumer listed the catalog.
            config = _live_config()
            if config is None:
                return _error(404, "asset version not found")
            row = find_live_row(
                live_workspace,
                config,
                kind="skill" if kind == "skill" else "mcp",
                asset_id=asset_id,
            )
            if row is None or row["version"] != version:
                return _error(404, "asset changed or was unpublished; reload the catalog")
            if kind == "skill":
                skill_markdown = load_live_skill_markdown(live_workspace, asset_id)
                if skill_markdown is None:
                    return _error(404, "asset changed or was unpublished; reload the catalog")
                try:
                    bundle = build_skill_bundle(
                        team_instance_id=identity,
                        skill_id=asset_id,
                        version=version,
                        skill_markdown=skill_markdown,
                    )
                except ValueError as exc:
                    logger.warning("team asset live skill invalid: {}", exc)
                    return _error(500, "asset integrity check failed")
                return web.Response(
                    body=bundle,
                    content_type="application/zip",
                    headers={
                        **_cors_headers(),
                        "Content-Disposition": (
                            f"attachment; filename={asset_id}-{version}.zip"
                        ),
                    },
                )
            manifest = load_live_mcp_manifest(config, asset_id)
            if manifest is None:
                return _error(404, "asset changed or was unpublished; reload the catalog")
            try:
                return _json(
                    build_mcp_manifest_envelope(
                        team_instance_id=identity,
                        name=asset_id,
                        version=version,
                        manifest=manifest,
                    )
                )
            except ValueError as exc:
                logger.warning("team asset live mcp invalid: {}", exc)
                return _error(500, "asset integrity check failed")
        if kind == "skill":
            bundle = build_skill_bundle(
                team_instance_id=identity,
                skill_id=asset_id,
                version=version,
                skill_markdown=payload.decode("utf-8"),
            )
            return web.Response(
                body=bundle,
                content_type="application/zip",
                headers={
                    **_cors_headers(),
                    "Content-Disposition": (
                        f"attachment; filename={asset_id}-{version}.zip"
                    ),
                },
            )
        manifest = cast(dict[str, Any], json.loads(payload.decode("utf-8")))
        envelope = build_mcp_manifest_envelope(
            team_instance_id=identity,
            name=asset_id,
            version=version,
            manifest=manifest,
        )
        return _json(envelope)

    async def handle_submission_status(request: web.Request) -> web.Response:
        """Return one submission's review state to whoever holds its id.

        The id is a random 16-hex token, so this is not enumerable; the
        response deliberately omits content, manifest and notes — only
        the asset identity and review state leave the instance.
        """
        if not _check_rate(
            request, limit=GET_RATE_LIMIT, window_s=GET_RATE_WINDOW_S
        ):
            return _error(429, "rate limited")
        try:
            submission_id = normalize_submission_id(
                request.match_info.get("submission_id", "")
            )
            record = store.get_pending(submission_id)
        except (ValueError, FileNotFoundError):
            return _error(404, "submission not found")
        return _json(
            {
                "submission_id": submission_id,
                "status": record.get("status", "pending"),
                "asset_type": record.get("asset_type", ""),
                "id": record.get("id", ""),
                "version": record.get("version", ""),
                "reviewed_at": record.get("reviewed_at", 0.0),
            }
        )

    async def handle_submit(request: web.Request) -> web.Response:
        if not _check_rate(
            request, limit=SUBMIT_RATE_LIMIT, window_s=SUBMIT_RATE_WINDOW_S
        ):
            return _error(429, "rate limited")
        try:
            body = await request.json()
        except (json.JSONDecodeError, UnicodeDecodeError):
            return _error(400, "invalid JSON body")
        if not isinstance(body, dict):
            return _error(400, "invalid submission")
        try:
            record = _validate_submission(cast(dict[str, Any], body))
        except ValueError as exc:
            return _error(400, str(exc))
        submission_id = store.append_pending(record)
        logger.info("team asset submission {} received", submission_id)
        return _json({"submission_id": submission_id, "status": "pending"})

    def _validate_submission(body: dict[str, Any]) -> dict[str, Any]:
        asset_type = body.get("asset_type")
        if asset_type not in ("skill", "mcp"):
            raise ValueError("asset_type must be 'skill' or 'mcp'")
        submitter = body.get("submitter", "")
        if not isinstance(submitter, str) or not submitter.strip():
            raise ValueError("submitter is required")
        submitter = submitter.strip()
        if len(submitter) > _SUBMITTER_MAX_LEN:
            raise ValueError("submitter is too long")
        raw_id = body.get("id", "")
        if not isinstance(raw_id, str):
            raise ValueError("id must be a string")
        asset_id = normalize_asset_id(
            "skill" if asset_type == "skill" else "mcp", raw_id
        )
        raw_version = body.get("version", "")
        if not isinstance(raw_version, str):
            raise ValueError("version must be a string")
        from nanodesk.team_assets.store import normalize_version

        version = normalize_version(raw_version)
        if len(version) > _VERSION_MAX_LEN:
            raise ValueError("version is too long")
        note = body.get("note", "")
        if not isinstance(note, str):
            raise ValueError("note must be a string")
        note = note.strip()[:512]
        if asset_type == "skill":
            content = body.get("content", "")
            if not isinstance(content, str):
                raise ValueError("content must be SKILL.md markdown text")
            if len(content.encode("utf-8")) > MAX_SKILL_MARKDOWN_BYTES:
                raise ValueError("skill content exceeds 64 KiB")
            validate_skill_markdown(asset_id, content)
            return {
                "asset_type": "skill",
                "id": asset_id,
                "version": version,
                "submitter": submitter,
                "note": note,
                "content": content,
            }
        manifest = body.get("manifest")
        if isinstance(manifest, dict):
            forbidden = [key for key in ("env", "headers") if key in manifest]
            if forbidden:
                raise ValueError(
                    f"mcp manifest must not contain credentials: {forbidden}"
                )
        clean = sanitize_mcp_manifest(manifest)
        return {
            "asset_type": "mcp",
            "id": asset_id,
            "version": version,
            "submitter": submitter,
            "note": note,
            "manifest": clean,
        }

    app.router.add_get("/health", handle_health)
    app.router.add_get("/v1/team/info", handle_info)
    app.router.add_get("/v1/team/assets", handle_catalog)
    app.router.add_route("OPTIONS", "/v1/team/assets", _preflight)
    app.router.add_get(
        "/v1/team/assets/{kind}/{asset_id}/{version}/download", handle_download
    )
    app.router.add_route(
        "OPTIONS", "/v1/team/assets/{kind}/{asset_id}/{version}/download",
        _preflight,
    )
    app.router.add_get("/v1/team/submissions/{submission_id}", handle_submission_status)
    app.router.add_post("/v1/team/submissions", handle_submit)
    app.router.add_route("OPTIONS", "/v1/team/submissions", _preflight)
    return app
