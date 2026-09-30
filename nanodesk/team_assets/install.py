"""Install verified team assets into this instance's workspace and config.

Every payload arriving here has already passed the integrity checks in
``nanodesk.team_assets.client``. This module owns the local side effects:

- Skills land in ``<workspace>/skills/<id>/SKILL.md``, where the runtime
  loader already looks for them.
- MCP manifests land in ``config.tools.mcp_servers``, where the MCP runtime
  already reads them. The manifest allowlist carries no credentials, so
  ``env``/``headers`` stay empty and the user supplies their own secrets.

Install provenance is kept in ``<workspace>/team_assets/installed.json`` so
the WebUI can show where an asset came from and detect version drift without
polluting the user's own config or skill directories.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, cast

from nanodesk.config.schema import MCPServerConfig
from nanodesk.security.workspace_policy import (
    WorkspaceBoundaryError,
    require_path_within,
)
from nanodesk.team_assets.bundles import validate_skill_markdown
from nanodesk.team_assets.store import AssetKind, TeamAssetStore, normalize_asset_id

__all__ = [
    "INSTALL_RECORD_FILE",
    "installed_team_assets",
    "install_team_mcp_asset",
    "install_team_skill_asset",
    "record_team_asset_install",
]

INSTALL_RECORD_FILE = "installed.json"


def _install_record_path(workspace_path: Path) -> Path:
    return TeamAssetStore(workspace_path).root / INSTALL_RECORD_FILE


def _load_install_records(workspace_path: Path) -> dict[str, dict[str, Any]]:
    path = _install_record_path(workspace_path)
    try:
        data = cast(object, json.loads(path.read_text(encoding="utf-8")))
    except FileNotFoundError:
        return {}
    except (OSError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    assets = cast(dict[str, Any], data).get("assets")
    if not isinstance(assets, dict):
        return {}
    records = cast(dict[str, Any], assets)
    return {
        str(key): cast(dict[str, Any], value)
        for key, value in records.items()
        if isinstance(value, dict)
    }


def installed_team_assets(workspace_path: Path) -> dict[str, dict[str, Any]]:
    """Return the recorded provenance of every team asset installed here."""
    return _load_install_records(workspace_path)


def record_team_asset_install(
    workspace_path: Path,
    *,
    kind: AssetKind,
    asset_id: str,
    version: str,
    content_hash: str,
    team_instance_id: str,
    source_url: str,
    description: str = "",
) -> dict[str, Any]:
    """Record one install so the UI can show origin and detect upgrades."""
    normalized_id = normalize_asset_id(kind, asset_id)
    records = _load_install_records(workspace_path)
    record = {
        "kind": kind,
        "id": normalized_id,
        "version": version,
        "content_hash": content_hash,
        "team_instance_id": team_instance_id,
        "source_url": source_url,
        "description": description[:1024],
        "installed_at": time.time(),
    }
    records[f"{kind}:{normalized_id}"] = record

    path = _install_record_path(workspace_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps({"assets": records}, ensure_ascii=False, indent=2)
    tmp_path = path.with_suffix(".tmp")
    tmp_path.write_text(payload, encoding="utf-8")
    tmp_path.replace(path)
    return record


def _skills_root(workspace_path: Path) -> Path:
    workspace = workspace_path.expanduser().resolve()
    workspace.mkdir(parents=True, exist_ok=True)
    try:
        return require_path_within(
            workspace / "skills",
            workspace,
            message="skills directory must stay inside the workspace",
        )
    except WorkspaceBoundaryError:
        raise


def install_team_skill_asset(
    workspace_path: Path,
    *,
    skill_id: str,
    version: str,
    skill_markdown: str,
    content_hash: str,
    team_instance_id: str,
    source_url: str,
    description: str = "",
) -> dict[str, Any]:
    """Write one verified team skill into ``<workspace>/skills``."""
    asset_id = normalize_asset_id("skill", skill_id)
    validate_skill_markdown(asset_id, skill_markdown)

    try:
        skills_root = _skills_root(workspace_path)
    except WorkspaceBoundaryError as exc:
        raise ValueError(str(exc)) from exc

    target = skills_root / asset_id
    if target.parent != skills_root:
        raise ValueError("invalid skill name")
    try:
        target.mkdir(parents=True, exist_ok=True)
        skill_file = target / "SKILL.md"
        tmp_file = skill_file.with_suffix(".tmp")
        tmp_file.write_text(skill_markdown, encoding="utf-8")
        tmp_file.replace(skill_file)
    except OSError as exc:
        raise ValueError(f"could not write skill {asset_id}: {exc}") from exc

    record_team_asset_install(
        workspace_path,
        kind="skill",
        asset_id=asset_id,
        version=version,
        content_hash=content_hash,
        team_instance_id=team_instance_id,
        source_url=source_url,
        description=description,
    )
    return {"kind": "skill", "id": asset_id, "version": version, "path": str(skill_file)}


def install_team_mcp_asset(
    config: Any,
    *,
    name: str,
    version: str,
    manifest: dict[str, Any],
    content_hash: str,
    team_instance_id: str,
    source_url: str,
) -> dict[str, Any]:
    """Materialize one verified team MCP manifest into the live config object.

    ``config`` is the loaded :class:`~nanodesk.config.schema.Config`; the
    caller persists it through the normal serialized config writer.
    """
    from nanodesk.team_assets.bundles import sanitize_mcp_manifest

    asset_id = normalize_asset_id("mcp", name)
    clean = sanitize_mcp_manifest(manifest)
    workspace_path = config.workspace_path

    # Credentials are never transported, so any user-supplied env/headers
    # for an existing entry must not be silently discarded or overwritten.
    existing = config.tools.mcp_servers.get(asset_id)
    env = dict(existing.env) if existing is not None else {}
    headers = dict(existing.headers) if existing is not None else {}

    server = MCPServerConfig(
        type=cast(Any, clean.get("type")),
        auth=cast(Any, clean.get("auth")),
        command=cast(str, clean.get("command", "")),
        args=list(cast(list[str], clean.get("args", []))),
        env=env,
        cwd=cast(str, clean.get("cwd", "")),
        url=cast(str, clean.get("url", "")),
        headers=headers,
        tool_timeout=int(cast(int, clean.get("tool_timeout", 30))),
        enabled_tools=list(cast(list[str], clean.get("enabled_tools", ["*"]))),
        enabled=bool(cast(bool, clean.get("enabled", True))),
        description=cast(str, clean.get("description", "")),
        docs_url=cast(str, clean.get("docs_url", "")),
    )
    config.tools.mcp_servers[asset_id] = server
    record_team_asset_install(
        workspace_path,
        kind="mcp",
        asset_id=asset_id,
        version=version,
        content_hash=content_hash,
        team_instance_id=team_instance_id,
        source_url=source_url,
        description=server.description,
    )
    return {
        "kind": "mcp",
        "id": asset_id,
        "version": version,
        "content_hash": content_hash,
        "team_instance_id": team_instance_id,
        "source_url": source_url,
        "manifest": clean,
    }
