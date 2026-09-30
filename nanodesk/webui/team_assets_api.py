"""Team-asset actions for the WebUI.

Pure functions over the loaded config / workspace; ``ws_http`` supplies the
auth, the install lock, and the HTTP response. Keeping the logic here means
the consumer and reviewer flows are testable without a live WebUI.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, cast

from nanodesk.config.schema import Config, TeamAssetSourceConfig
from nanodesk.team_assets.bundles import sanitize_mcp_manifest
from nanodesk.team_assets.client import (
    TeamAssetClientError,
    download_team_mcp_asset,
    download_team_skill_asset,
    fetch_team_catalog,
    fetch_team_info,
    submit_team_asset,
)
from nanodesk.team_assets.install import (
    install_team_mcp_asset,
    install_team_skill_asset,
    installed_team_assets,
)
from nanodesk.team_assets.review import (
    approve_team_submission,
    list_team_submissions,
    publish_local_mcp,
    publish_local_skill,
    reject_team_submission,
)
from nanodesk.team_assets.store import AssetKind, TeamAssetStore, normalize_asset_id

__all__ = [
    "TeamAssetsError",
    "approve_submission",
    "fetch_team_asset",
    "install_fetched_team_asset",
    "probe_team_instance",
    "publish_team_asset",
    "remote_catalog_payload",
    "reject_submission",
    "remove_team_asset_source",
    "save_team_asset_source",
    "submit_local_asset",
    "team_assets_payload",
]

_SOURCE_ID_MAX = 64
_NAME_MAX = 64
_NOTE_MAX = 512
_SUBMITTER_MAX = 64


class TeamAssetsError(Exception):
    """A safe, user-facing team-asset error."""

    def __init__(self, message: str, *, status: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status = status


def _kind(value: object) -> AssetKind:
    if value == "skill":
        return "skill"
    if value == "mcp":
        return "mcp"
    raise TeamAssetsError("asset kind must be 'skill' or 'mcp'")


def find_team_asset_source(config: Config, source_id: str) -> TeamAssetSourceConfig:
    """Resolve one configured source, or fail with a user-facing error."""
    wanted = (source_id or "").strip()
    for source in config.team_assets.sources:
        if source.id == wanted:
            return source
    raise TeamAssetsError(f"unknown team instance: {wanted or '(empty)'}", status=404)


def _published_summary(workspace_path: Path) -> dict[str, list[dict[str, Any]]]:
    store = TeamAssetStore(workspace_path)
    if not store.published_dir.is_dir():
        return {"skills": [], "mcp": []}
    return {
        "skills": [_published_entry(asset, "skill") for asset in store.list_published("skill")],
        "mcp": [_published_entry(asset, "mcp") for asset in store.list_published("mcp")],
    }


def _published_entry(asset: Any, kind: AssetKind) -> dict[str, Any]:
    return {
        "kind": kind,
        "id": asset.asset_id,
        "version": asset.version,
        "description": asset.description,
        "content_hash": asset.content_hash,
        "created_at": asset.created_at,
    }


def team_assets_payload(config: Config, workspace_path: Path) -> dict[str, Any]:
    """Return the whole team-assets surface for one WebUI refresh."""
    cfg = config.team_assets
    pending = list_team_submissions(workspace_path)
    return {
        "publisher": {
            "enabled": cfg.enabled,
            "instance_id": cfg.instance_id,
            "name": cfg.name,
            "description": cfg.description,
            "host": cfg.host,
            "port": cfg.port,
            "published": _published_summary(workspace_path),
        },
        "sources": [
            {
                "id": source.id,
                "name": source.name or source.id,
                "base_url": source.base_url,
                "enabled": source.enabled,
            }
            for source in cfg.sources
        ],
        "installed": sorted(
            installed_team_assets(workspace_path).values(),
            key=lambda item: f"{item.get('kind', '')}:{item.get('id', '')}",
        ),
        "submissions": [
            {
                "submission_id": record.get("submission_id", ""),
                "asset_type": record.get("asset_type", ""),
                "asset_id": record.get("id", ""),
                "version": record.get("version", ""),
                "submitter": record.get("submitter", ""),
                "note": record.get("note", ""),
                "created_at": record.get("created_at", 0.0),
                "preview": _submission_preview(record),
            }
            for record in pending
        ],
    }


def _submission_preview(record: dict[str, Any]) -> str:
    """Return a short, inert preview of what a submission would publish."""
    if record.get("asset_type") == "skill":
        content = record.get("content")
        if not isinstance(content, str):
            return ""
        head = content.strip().splitlines()
        if head and head[0].strip() == "---":
            for line in head[1:]:
                if line.strip().lower().startswith("description:"):
                    return line.split(":", 1)[1].strip().strip("\"'")[:200]
        return head[0][:200] if head else ""
    manifest = record.get("manifest")
    if isinstance(manifest, dict):
        description = cast(dict[str, Any], manifest).get("description")
        if isinstance(description, str) and description.strip():
            return description.strip()[:200]
    return ""


async def probe_team_instance(base_url: str) -> dict[str, str]:
    """Resolve a team instance's identity from its URL.

    The instance id is chosen by the *publishing* side, so a consumer must
    never have to invent one: binding only asks for the URL, and the id and
    display name are read back from ``/v1/team/info``. Probing first also
    means an unreachable or non-team URL fails before anything is persisted.
    """
    try:
        info = await fetch_team_info(base_url)
    except TeamAssetClientError as exc:
        raise TeamAssetsError(exc.message, status=exc.status) from exc
    return info


def save_team_asset_source(
    config: Config,
    *,
    base_url: str,
    source_id: str = "",
    name: str = "",
    enabled: bool = True,
) -> dict[str, Any]:
    """Create or update one consumer source in the config object.

    ``source_id`` is optional: leave it empty for a new binding and pass the
    id returned by :func:`probe_team_instance`. Pass it only to rename an
    instance that is already bound.
    """
    wanted = (source_id or "").strip()
    if not wanted:
        raise TeamAssetsError("team instance id is required")
    if len(wanted) > _SOURCE_ID_MAX:
        raise TeamAssetsError("team instance id is too long")
    clean_name = (name or "").strip()[:_NAME_MAX]

    try:
        candidate = TeamAssetSourceConfig.model_validate(
            {"id": wanted, "name": clean_name, "baseUrl": base_url, "enabled": enabled}
        )
    except ValueError as exc:
        raise TeamAssetsError(str(exc)) from exc

    sources = list(config.team_assets.sources)
    for index, existing in enumerate(sources):
        if existing.id != wanted:
            continue
        if existing.base_url != candidate.base_url:
            # The id is the peer's own identity; the same id pointing at a
            # different URL means the peer was replaced, so re-probe instead
            # of silently retargeting an existing binding.
            raise TeamAssetsError(
                f"team instance {wanted} is already bound to {existing.base_url}",
                status=409,
            )
        if not clean_name:
            candidate = candidate.model_copy(update={"name": existing.name})
        sources[index] = candidate
        break
    else:
        sources.append(candidate)
    config.team_assets.sources = sources
    return {"id": wanted, "name": candidate.name or wanted, "base_url": candidate.base_url}


def remove_team_asset_source(config: Config, *, source_id: str) -> dict[str, Any]:
    """Detach one consumer source; already-installed assets are kept."""
    wanted = (source_id or "").strip()
    sources = list(config.team_assets.sources)
    remaining = [source for source in sources if source.id != wanted]
    if len(remaining) == len(sources):
        raise TeamAssetsError(f"unknown team instance: {wanted or '(empty)'}", status=404)
    config.team_assets.sources = remaining
    return {"id": wanted, "removed": True}


async def remote_catalog_payload(config: Config, *, source_id: str) -> dict[str, Any]:
    """Fetch and normalize one remote instance's catalog."""
    source = find_team_asset_source(config, source_id)
    try:
        catalog = await fetch_team_catalog(source.base_url)
    except TeamAssetClientError as exc:
        raise TeamAssetsError(exc.message, status=exc.status) from exc
    installed = installed_team_assets(config.workspace_path)
    return {
        "source_id": source.id,
        "source_name": source.name or source.id,
        "instance": catalog,
        "skills": _with_install_state("skill", catalog["skills"], installed),
        "mcp": _with_install_state("mcp", catalog["mcp"], installed),
    }


def _with_install_state(
    kind: AssetKind,
    assets: list[dict[str, Any]],
    installed: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Annotate each catalog row with what this instance already installed."""
    rows: list[dict[str, Any]] = []
    for asset in assets:
        record = installed.get(f"{kind}:{asset['id']}")
        rows.append(
            {
                **asset,
                "kind": kind,
                "installed": record is not None,
                "installed_version": (record or {}).get("version", ""),
                "upgradable": record is not None
                and (record or {}).get("version", "") != asset["version"],
            }
        )
    return rows


async def fetch_team_asset(
    config: Config,
    *,
    source_id: str,
    kind: str,
    asset_id: str,
    version: str,
    expected_hash: str = "",
) -> tuple[TeamAssetSourceConfig, AssetKind, dict[str, Any]]:
    """Download and verify one asset, without touching local state.

    Split from the install so the network round trip never runs while the
    config file lock is held.
    """
    source = find_team_asset_source(config, source_id)
    asset_kind = _kind(kind)
    try:
        if asset_kind == "skill":
            asset = await download_team_skill_asset(
                source.base_url, asset_id, version, expected_hash=expected_hash
            )
        else:
            asset = await download_team_mcp_asset(
                source.base_url, asset_id, version, expected_hash=expected_hash
            )
    except TeamAssetClientError as exc:
        raise TeamAssetsError(exc.message, status=exc.status) from exc
    return source, asset_kind, asset


def install_fetched_team_asset(
    config: Config,
    source: TeamAssetSourceConfig,
    asset_kind: AssetKind,
    asset: dict[str, Any],
) -> dict[str, Any]:
    """Materialize an already-verified asset into the workspace and config."""
    workspace_path = config.workspace_path
    try:
        if asset_kind == "skill":
            result = install_team_skill_asset(
                workspace_path,
                skill_id=asset["id"],
                version=asset["version"],
                skill_markdown=asset["skill_markdown"],
                content_hash=asset["content_hash"],
                team_instance_id=asset["team_instance_id"],
                source_url=source.base_url,
            )
        else:
            result = install_team_mcp_asset(
                config,
                name=asset["id"],
                version=asset["version"],
                manifest=asset["manifest"],
                content_hash=asset["content_hash"],
                team_instance_id=asset["team_instance_id"],
                source_url=source.base_url,
            )
    except ValueError as exc:
        raise TeamAssetsError(str(exc), status=400) from exc
    return {**result, "source_id": source.id, "requires_restart": asset_kind == "mcp"}


def publish_team_asset(
    config: Config,
    *,
    kind: str,
    asset_id: str,
    version: str,
    description: str = "",
) -> dict[str, Any]:
    """Publish one local workspace skill or configured MCP server."""
    asset_kind = _kind(kind)
    workspace_path = config.workspace_path
    try:
        if asset_kind == "skill":
            asset = publish_local_skill(
                workspace_path,
                asset_id,
                version,
                description=description.strip()[:1024],
            )
        else:
            asset = publish_local_mcp(config, workspace_path, asset_id, version)
    except ValueError as exc:
        raise TeamAssetsError(str(exc)) from exc
    except OSError as exc:
        raise TeamAssetsError(f"could not publish asset: {exc}", status=500) from exc
    return _published_entry(asset, asset_kind)


def approve_submission(
    workspace_path: Path,
    *,
    submission_id: str,
    version: str = "",
    reviewer: str = "",
) -> dict[str, Any]:
    """Approve one pending submission into the published catalog."""
    try:
        asset = approve_team_submission(
            workspace_path,
            submission_id,
            reviewer=reviewer.strip()[:_NAME_MAX],
            version=version,
        )
    except FileNotFoundError as exc:
        raise TeamAssetsError("submission not found", status=404) from exc
    except ValueError as exc:
        raise TeamAssetsError(str(exc)) from exc
    return {
        "submission_id": submission_id,
        "approved": True,
        **_published_entry(asset, asset.kind),
    }


def reject_submission(
    workspace_path: Path,
    *,
    submission_id: str,
    reviewer: str = "",
) -> dict[str, Any]:
    """Reject one pending submission, keeping the audit record."""
    try:
        record = reject_team_submission(
            workspace_path, submission_id, reviewer=reviewer.strip()[:_NAME_MAX]
        )
    except FileNotFoundError as exc:
        raise TeamAssetsError("submission not found", status=404) from exc
    except ValueError as exc:
        raise TeamAssetsError(str(exc)) from exc
    return {"submission_id": submission_id, "rejected": True, "status": record.get("status", "")}


def _local_skill_content(workspace_path: Path, skill_id: str) -> str:
    skill_file = workspace_path.expanduser() / "skills" / skill_id / "SKILL.md"
    if not skill_file.is_file():
        raise TeamAssetsError(f"skill not found in this workspace: {skill_id}", status=404)
    return skill_file.read_text(encoding="utf-8")


def _local_mcp_manifest(config: Config, name: str) -> dict[str, Any]:
    server = config.tools.mcp_servers.get(name)
    if server is None:
        raise TeamAssetsError(f"MCP server is not configured: {name}", status=404)
    try:
        return sanitize_mcp_manifest(
            {
                "type": server.type,
                "auth": server.auth,
                "command": server.command,
                "args": list(server.args),
                "cwd": server.cwd,
                "url": server.url,
                "tool_timeout": server.tool_timeout,
                "enabled_tools": list(server.enabled_tools),
                "enabled": server.enabled,
                "description": server.description,
                "docs_url": server.docs_url,
            }
        )
    except ValueError as exc:
        raise TeamAssetsError(str(exc)) from exc


async def submit_local_asset(
    config: Config,
    *,
    source_id: str,
    kind: str,
    asset_id: str,
    version: str,
    submitter: str,
    note: str = "",
) -> dict[str, Any]:
    """Queue one local asset in a remote instance's public review queue."""
    source = find_team_asset_source(config, source_id)
    asset_kind = _kind(kind)
    who = (submitter or "").strip()
    if not who:
        raise TeamAssetsError("submitter is required")
    if len(who) > _SUBMITTER_MAX:
        raise TeamAssetsError("submitter is too long")

    try:
        normalized_id = normalize_asset_id(asset_kind, asset_id)
    except ValueError as exc:
        raise TeamAssetsError(str(exc)) from exc

    content = ""
    manifest: dict[str, Any] | None = None
    if asset_kind == "skill":
        content = _local_skill_content(config.workspace_path, normalized_id)
    else:
        manifest = _local_mcp_manifest(config, normalized_id)

    try:
        result = await submit_team_asset(
            source.base_url,
            asset_type=asset_kind,
            asset_id=normalized_id,
            version=version,
            submitter=who,
            note=note.strip()[:_NOTE_MAX],
            content=content,
            manifest=manifest,
        )
    except TeamAssetClientError as exc:
        raise TeamAssetsError(exc.message, status=exc.status) from exc
    return {**result, "source_id": source.id, "kind": asset_kind, "asset_id": normalized_id}
