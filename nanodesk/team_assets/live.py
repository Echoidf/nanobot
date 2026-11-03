"""Live local assets for the team-asset catalog.

The catalog a team instance serves is assembled live on every request:

- ``local`` rows come straight from this instance's workspace
  (``<workspace>/skills/*/SKILL.md``) and its configured MCP servers.
  They are visible to bound members whether or not they are enabled.
- ``remote`` rows are fixed-version snapshots another instance submitted
  and a reviewer approved (``published/`` with ``origin == "remote"``).
- Legacy ``published/`` snapshots without an origin marker predate this
  model; they read back as ``"local"`` and are hidden once the same asset
  exists live, so stale snapshots never shadow current content.

Live rows carry a content-derived version (``h`` + 12 hex chars of the
content hash) so the existing fixed-version download/install flow — and
its integrity checks — keeps working unchanged. If the content changes
between catalog and download, the version no longer matches and the
download fails with a "reload the catalog" error instead of serving
stale bytes.

Security notes (same contract as the fixed-version path):

- Skills expose only validated ``SKILL.md`` markdown, never executable
  resources from the skill directory.
- MCP manifests go through ``sanitize_mcp_manifest``: ``env``/``headers``
  and unknown keys are dropped before anything leaves this instance.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

from nanodesk.team_assets.bundles import mcp_manifest_hash
from nanodesk.team_assets.store import AssetKind, TeamAssetStore, normalize_asset_id

__all__ = [
    "LIVE_VERSION_PREFIX",
    "find_live_row",
    "is_live_version",
    "list_live_local_assets",
    "live_version_for_hash",
    "load_live_mcp_manifest",
    "load_live_skill_markdown",
    "merged_catalog_rows",
]

LIVE_VERSION_PREFIX = "h"
_LIVE_VERSION_LEN = 12


def live_version_for_hash(content_hash: str) -> str:
    """Return the live-catalog version for a content hash."""
    return f"{LIVE_VERSION_PREFIX}{content_hash[:_LIVE_VERSION_LEN]}"


def is_live_version(version: str) -> bool:
    """Return whether a version string is a live content-derived version."""
    text = (version or "").strip()
    return (
        len(text) == len(LIVE_VERSION_PREFIX) + _LIVE_VERSION_LEN
        and text.startswith(LIVE_VERSION_PREFIX)
        and all(c in "0123456789abcdef" for c in text[len(LIVE_VERSION_PREFIX):])
    )


def _skill_description(metadata: dict[str, object]) -> str:
    description = metadata.get("description")
    return description.strip()[:1024] if isinstance(description, str) else ""


def _live_skill_rows(workspace_path: Path) -> list[dict[str, Any]]:
    """Enumerate valid workspace skills as live ``local`` catalog rows."""
    from nanodesk.agent.skills import parse_skill_metadata

    rows: list[dict[str, Any]] = []
    skills_dir = workspace_path.expanduser() / "skills"
    if not skills_dir.is_dir():
        return rows
    for child in sorted(skills_dir.iterdir()):
        if not child.is_dir():
            continue
        try:
            skill_id = normalize_asset_id("skill", child.name)
        except ValueError:
            continue
        content = load_live_skill_markdown(workspace_path, skill_id)
        if content is None:
            continue
        metadata = parse_skill_metadata(content) or {}
        content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
        rows.append(
            {
                "kind": "skill",
                "id": skill_id,
                "version": live_version_for_hash(content_hash),
                "description": _skill_description(metadata),
                "content_hash": content_hash,
                "origin": "local",
                "enabled": True,
            }
        )
    return rows


def load_live_skill_markdown(workspace_path: Path, skill_id: str) -> str | None:
    """Return validated live ``SKILL.md`` text, or ``None`` when unusable."""
    from nanodesk.team_assets.bundles import validate_skill_markdown

    try:
        asset_id = normalize_asset_id("skill", skill_id)
    except ValueError:
        return None
    skill_file = workspace_path.expanduser() / "skills" / asset_id / "SKILL.md"
    if not skill_file.is_file():
        return None
    try:
        content = skill_file.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None
    try:
        validate_skill_markdown(asset_id, content)
    except ValueError:
        return None
    return content


def load_live_mcp_manifest(config: Any, name: str) -> dict[str, Any] | None:
    """Return the sanitized live MCP manifest, or ``None`` when unusable."""
    from nanodesk.team_assets.bundles import sanitize_mcp_manifest

    try:
        asset_id = normalize_asset_id("mcp", name)
    except ValueError:
        return None
    servers = getattr(getattr(config, "tools", None), "mcp_servers", {}) or {}
    server = servers.get(asset_id)
    if server is None:
        # Fall back to a case-insensitive lookup over the raw key.
        for key, candidate in servers.items():
            if key.strip() == asset_id:
                server = candidate
                break
    if server is None:
        return None
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
    except (ValueError, AttributeError):
        return None


def _live_mcp_rows(config: Any) -> list[dict[str, Any]]:
    """Enumerate configured MCP servers as live ``local`` catalog rows."""
    rows: list[dict[str, Any]] = []
    servers = getattr(getattr(config, "tools", None), "mcp_servers", {}) or {}
    for name in sorted(servers):
        try:
            asset_id = normalize_asset_id("mcp", name)
        except ValueError:
            continue
        clean = load_live_mcp_manifest(config, asset_id)
        if clean is None:
            continue
        server = servers[name]
        content_hash = mcp_manifest_hash(clean)
        rows.append(
            {
                "kind": "mcp",
                "id": asset_id,
                "version": live_version_for_hash(content_hash),
                "description": clean.get("description", ""),
                "content_hash": content_hash,
                "origin": "local",
                "enabled": bool(getattr(server, "enabled", True)),
            }
        )
    return rows


def list_live_local_assets(
    workspace_path: Path, config: Any
) -> dict[str, list[dict[str, Any]]]:
    """Return this instance's live local skills and MCP servers."""
    return {
        "skills": _live_skill_rows(workspace_path),
        "mcp": _live_mcp_rows(config),
    }


def _published_row(asset: Any) -> dict[str, Any]:
    return {
        "kind": asset.kind,
        "id": asset.asset_id,
        "version": asset.version,
        "description": asset.description,
        "content_hash": asset.content_hash,
        "origin": asset.origin or "local",
        "enabled": True,
    }


def merged_catalog_rows(
    workspace_path: Path, config: Any, *, team_instance_id: str = ""
) -> dict[str, list[dict[str, Any]]]:
    """Merge live local assets with approved fixed-version snapshots.

    Live rows win per ``(kind, id)``: a legacy local snapshot of an asset
    that still exists live is hidden so stale bytes never shadow current
    content. Snapshots of assets that no longer exist live stay visible
    so old consumers keep working.
    """
    live = list_live_local_assets(workspace_path, config)
    store = TeamAssetStore(workspace_path, team_instance_id=team_instance_id)
    merged: dict[str, list[dict[str, Any]]] = {"skills": [], "mcp": []}
    kinds: tuple[tuple[str, AssetKind], ...] = (("skills", "skill"), ("mcp", "mcp"))
    for key, kind in kinds:
        live_rows = live[key]
        live_ids = {row["id"] for row in live_rows}
        rows = list(live_rows)
        for asset in store.list_published(kind):
            if asset.origin == "local" and asset.asset_id in live_ids:
                continue
            rows.append(_published_row(asset))
        merged[key] = rows
    return merged


def find_live_row(
    workspace_path: Path, config: Any, *, kind: AssetKind, asset_id: str
) -> dict[str, Any] | None:
    """Return the live local row for one asset, or ``None``."""
    key = "skills" if kind == "skill" else "mcp"
    for row in list_live_local_assets(workspace_path, config)[key]:
        if row["id"] == asset_id:
            return row
    return None
