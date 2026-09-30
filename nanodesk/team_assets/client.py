"""Client for a remote team instance's public asset surface.

This is the read/consume side of the team-asset contract defined in
``nanodesk/team_assets/server.py``. It only ever talks to the sidecar's
anonymous routes: ``/v1/team/info``, ``/v1/team/assets`` and the
fixed-version download endpoint, plus the public submission queue.

Security notes:

- Every asset id and version is normalized through the same validators the
  server uses, so a hostile catalog cannot smuggle path segments.
- Downloads are integrity-checked before the caller ever sees the payload.
  Skills carry a ``content_hash`` over the exact ``SKILL.md`` bytes; MCP
  envelopes carry one over the canonical manifest JSON. A mismatch is a hard
  error, never a warning.
- Outbound requests go through ``PinnedDNSAsyncTransport`` so DNS is pinned
  to the validated IPs. ``allow_loopback`` is on because a team sidecar
  legitimately runs on the same host; the transport still refuses metadata,
  link-local, and non-loopback private targets, which users must opt into
  explicitly via ``tools.ssrf_whitelist``.
"""

from __future__ import annotations

import hashlib
import json
import re
import zipfile
from io import BytesIO
from typing import Any, cast
from urllib.parse import quote

import httpx

from nanodesk.security.network import PinnedDNSAsyncTransport, UnsafeURLRequestError
from nanodesk.team_assets.bundles import validate_skill_markdown
from nanodesk.team_assets.store import (
    AssetKind,
    normalize_asset_id,
    normalize_version,
)

__all__ = [
    "MAX_DOWNLOAD_BYTES",
    "TeamAssetClientError",
    "download_team_mcp_asset",
    "download_team_skill_asset",
    "fetch_team_catalog",
    "fetch_team_info",
    "submit_team_asset",
]

MAX_DOWNLOAD_BYTES = 512 * 1024
_TIMEOUT = httpx.Timeout(20.0, connect=10.0)
_SUBMITTER_MAX_LEN = 64
_NOTE_MAX_LEN = 512
_SAFE_ID = re.compile(r"^[A-Za-z0-9._-]{1,64}$")


class TeamAssetClientError(Exception):
    """A safe, user-facing team-asset client error."""

    def __init__(self, message: str, *, status: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status = status


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=PinnedDNSAsyncTransport(allow_loopback=True),
        timeout=_TIMEOUT,
        follow_redirects=False,
    )


def _normalize_base_url(base_url: str) -> str:
    text = (base_url or "").strip().rstrip("/")
    if not text:
        raise TeamAssetClientError("team instance URL is required", status=400)
    if not text.startswith(("http://", "https://")):
        raise TeamAssetClientError("team instance URL must start with http:// or https://")
    return text


async def _request(
    client: httpx.AsyncClient,
    url: str,
    *,
    method: str = "GET",
    body: dict[str, Any] | None = None,
) -> httpx.Response:
    try:
        if method == "POST":
            return await client.post(url, json=body)
        return await client.get(url)
    except UnsafeURLRequestError as exc:
        raise TeamAssetClientError(f"team instance URL is blocked: {exc}", status=403) from exc
    except httpx.TimeoutException as exc:
        raise TeamAssetClientError("team instance did not respond in time", status=504) from exc
    except httpx.HTTPError as exc:
        raise TeamAssetClientError(f"team instance is unreachable: {exc}", status=502) from exc


def _error_from_response(response: httpx.Response) -> TeamAssetClientError:
    detail = ""
    try:
        payload = cast(object, response.json())
    except ValueError:
        payload = None
    if isinstance(payload, dict):
        error = cast(dict[str, Any], payload).get("error")
        if isinstance(error, dict):
            message = cast(dict[str, Any], error).get("message")
            if isinstance(message, str) and message.strip():
                detail = message.strip()[:200]
    if not detail:
        detail = f"team instance returned HTTP {response.status_code}"
    status = response.status_code
    if status in (401, 403):
        status = 502
    return TeamAssetClientError(detail, status=status)


def _json_object(response: httpx.Response) -> dict[str, Any]:
    if response.status_code >= 400:
        raise _error_from_response(response)
    try:
        payload = cast(object, response.json())
    except ValueError as exc:
        raise TeamAssetClientError("team instance returned malformed JSON", status=502) from exc
    if not isinstance(payload, dict):
        raise TeamAssetClientError("team instance returned an unexpected payload", status=502)
    return cast(dict[str, Any], payload)


def _str_field(payload: dict[str, Any], key: str, *, required: bool = True) -> str:
    raw = payload.get(key)
    if not isinstance(raw, str):
        if required:
            raise TeamAssetClientError(f"team instance payload is missing {key}", status=502)
        return ""
    return raw


def _catalog_entries(payload: dict[str, Any], key: str) -> list[dict[str, str]]:
    raw = payload.get(key)
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise TeamAssetClientError(f"team instance payload has an invalid {key} list", status=502)
    entries: list[dict[str, str]] = []
    for item in cast(list[Any], raw):
        if not isinstance(item, dict):
            continue
        data = cast(dict[str, Any], item)
        asset_id = data.get("id")
        version = data.get("version")
        if not isinstance(asset_id, str) or not isinstance(version, str):
            continue
        if _SAFE_ID.fullmatch(asset_id) is None or _SAFE_ID.fullmatch(version) is None:
            continue
        description = data.get("description")
        content_hash = data.get("content_hash")
        entries.append(
            {
                "id": asset_id,
                "version": version,
                "description": description if isinstance(description, str) else "",
                "content_hash": content_hash if isinstance(content_hash, str) else "",
            }
        )
    return entries


async def fetch_team_info(base_url: str) -> dict[str, str]:
    """Return the remote instance identity used to confirm the right team."""
    root = _normalize_base_url(base_url)
    async with _client() as client:
        response = await _request(client, f"{root}/v1/team/info")
    payload = _json_object(response)
    instance_id = _str_field(payload, "instance_id")
    try:
        normalize_asset_id("skill", instance_id)
    except ValueError as exc:
        raise TeamAssetClientError("team instance returned an invalid identity", status=502) from exc
    return {
        "instance_id": instance_id,
        "name": _str_field(payload, "name", required=False).strip()[:64],
        "description": _str_field(payload, "description", required=False).strip()[:512],
    }


async def fetch_team_catalog(base_url: str) -> dict[str, Any]:
    """Return the published skill and MCP catalog of one remote instance."""
    root = _normalize_base_url(base_url)
    async with _client() as client:
        response = await _request(client, f"{root}/v1/team/assets")
    payload = _json_object(response)
    instance_id = _str_field(payload, "instance_id")
    try:
        normalize_asset_id("skill", instance_id)
    except ValueError as exc:
        raise TeamAssetClientError("team instance returned an invalid identity", status=502) from exc
    return {
        "instance_id": instance_id,
        "skills": _catalog_entries(payload, "skills"),
        "mcp": _catalog_entries(payload, "mcp"),
    }


def _download_url(root: str, kind: AssetKind, asset_id: str, version: str) -> str:
    try:
        normalized_id = normalize_asset_id(kind, asset_id)
        normalized_version = normalize_version(version)
    except ValueError as exc:
        raise TeamAssetClientError(str(exc), status=400) from exc
    return (
        f"{root}/v1/team/assets/{kind}/{quote(normalized_id)}"
        f"/{quote(normalized_version)}/download"
    )


def _manifest_hash(manifest: dict[str, Any]) -> str:
    """Recompute the envelope hash exactly as the publisher computed it."""
    payload = json.dumps(manifest, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


async def download_team_skill_asset(
    base_url: str,
    skill_id: str,
    version: str,
    *,
    expected_hash: str = "",
) -> dict[str, Any]:
    """Download one fixed skill bundle and return its verified SKILL.md.

    ``expected_hash`` is the catalog's ``content_hash`` when the caller
    already listed the catalog; it is checked in addition to the hash
    carried inside the bundle so a swapped bundle is still caught.
    """
    root = _normalize_base_url(base_url)
    url = _download_url(root, "skill", skill_id, version)
    async with _client() as client:
        response = await _request(client, url)
    if response.status_code >= 400:
        raise _error_from_response(response)
    payload = response.content
    if len(payload) > MAX_DOWNLOAD_BYTES:
        raise TeamAssetClientError("skill bundle is larger than the download limit", status=502)

    try:
        with zipfile.ZipFile(BytesIO(payload), "r") as archive:
            names = set(archive.namelist())
            if "SKILL.md" not in names or "manifest.json" not in names:
                raise TeamAssetClientError(
                    "skill bundle is missing SKILL.md or manifest.json", status=502
                )
            skill_markdown = archive.read("SKILL.md").decode("utf-8")
            envelope = cast(dict[str, Any], json.loads(archive.read("manifest.json").decode("utf-8")))
    except (zipfile.BadZipFile, KeyError, UnicodeDecodeError, ValueError) as exc:
        raise TeamAssetClientError("skill bundle could not be read", status=502) from exc

    try:
        normalize_asset_id("skill", envelope.get("id", ""))
        normalize_version(envelope.get("version", ""))
    except ValueError as exc:
        raise TeamAssetClientError("skill bundle carries an invalid identity", status=502) from exc

    actual = hashlib.sha256(skill_markdown.encode("utf-8")).hexdigest()
    bundle_hash = envelope.get("content_hash")
    if not isinstance(bundle_hash, str) or bundle_hash != actual:
        raise TeamAssetClientError("skill bundle failed its integrity check", status=502)
    if expected_hash.strip() and expected_hash.strip() != actual:
        raise TeamAssetClientError("downloaded skill does not match the published catalog", status=502)

    # The publisher already validated this contract; re-check locally so a
    # tampered bundle can never reach the workspace skills directory.
    try:
        validate_skill_markdown(cast(str, envelope["id"]), skill_markdown)
    except ValueError as exc:
        raise TeamAssetClientError(f"downloaded skill is invalid: {exc}", status=502) from exc

    return {
        "id": cast(str, envelope["id"]),
        "version": cast(str, envelope["version"]),
        "team_instance_id": cast(str, envelope.get("team_instance_id", "")),
        "content_hash": actual,
        "skill_markdown": skill_markdown,
    }


async def download_team_mcp_asset(
    base_url: str,
    name: str,
    version: str,
    *,
    expected_hash: str = "",
) -> dict[str, Any]:
    """Download one fixed MCP manifest envelope and return the verified manifest."""
    root = _normalize_base_url(base_url)
    url = _download_url(root, "mcp", name, version)
    async with _client() as client:
        response = await _request(client, url)
    if response.status_code >= 400:
        raise _error_from_response(response)
    if len(response.content) > MAX_DOWNLOAD_BYTES:
        raise TeamAssetClientError("MCP manifest is larger than the download limit", status=502)

    payload = _json_object(response)
    try:
        normalized_name = normalize_asset_id("mcp", cast(str, payload.get("id", "")))
        normalized_version = normalize_version(cast(str, payload.get("version", "")))
    except ValueError as exc:
        raise TeamAssetClientError("MCP manifest carries an invalid identity", status=502) from exc

    manifest = payload.get("manifest")
    if not isinstance(manifest, dict):
        raise TeamAssetClientError("MCP manifest payload is malformed", status=502)
    clean = cast(dict[str, Any], manifest)

    actual = _manifest_hash(clean)
    envelope_hash = payload.get("content_hash")
    if not isinstance(envelope_hash, str) or envelope_hash != actual:
        raise TeamAssetClientError("MCP manifest failed its integrity check", status=502)
    if expected_hash.strip() and expected_hash.strip() != actual:
        raise TeamAssetClientError("downloaded MCP manifest does not match the catalog", status=502)

    return {
        "id": normalized_name,
        "version": normalized_version,
        "team_instance_id": _str_field(payload, "team_instance_id", required=False),
        "content_hash": actual,
        "manifest": clean,
    }


async def submit_team_asset(
    base_url: str,
    *,
    asset_type: AssetKind,
    asset_id: str,
    version: str,
    submitter: str,
    note: str = "",
    content: str = "",
    manifest: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Queue one local asset in a remote instance's public pending queue."""
    root = _normalize_base_url(base_url)
    who = submitter.strip()
    if not who:
        raise TeamAssetClientError("submitter is required", status=400)
    if len(who) > _SUBMITTER_MAX_LEN:
        raise TeamAssetClientError("submitter is too long", status=400)
    try:
        normalized_id = normalize_asset_id(asset_type, asset_id)
        normalized_version = normalize_version(version)
    except ValueError as exc:
        raise TeamAssetClientError(str(exc), status=400) from exc

    body: dict[str, Any] = {
        "asset_type": asset_type,
        "id": normalized_id,
        "version": normalized_version,
        "submitter": who,
        "note": note.strip()[:_NOTE_MAX_LEN],
    }
    if asset_type == "skill":
        try:
            validate_skill_markdown(normalized_id, content)
        except ValueError as exc:
            raise TeamAssetClientError(str(exc), status=400) from exc
        body["content"] = content
    else:
        if not isinstance(manifest, dict):
            raise TeamAssetClientError("an MCP manifest is required", status=400)
        body["manifest"] = manifest

    async with _client() as client:
        response = await _request(client, f"{root}/v1/team/submissions", method="POST", body=body)
    if response.status_code >= 400:
        raise _error_from_response(response)
    payload = _json_object(response)
    return {
        "submission_id": _str_field(payload, "submission_id"),
        "status": _str_field(payload, "status", required=False),
    }
