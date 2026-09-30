"""Publisher-side team assets: publish local assets and review submissions.

This module is the authenticated half of the team-asset contract. It never
talks to a remote host — it only reads this instance's workspace and writes
this instance's own ``published`` catalog and pending queue. Remote peers
reach this data only through the anonymous sidecar in
``nanodesk.team_assets.server``.

Publishing a skill copies nothing but its ``SKILL.md``: the Agent Skills
identity contract is re-validated here so a malformed local skill can never
enter the catalog, and no executable resource from the skill directory is
ever published.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, cast

from nanodesk.config.schema import Config
from nanodesk.team_assets.bundles import sanitize_mcp_manifest
from nanodesk.team_assets.store import (
    PublishedAsset,
    TeamAssetStore,
    normalize_version,
)

__all__ = [
    "approve_team_submission",
    "list_team_submissions",
    "publish_local_mcp",
    "publish_local_skill",
    "reject_team_submission",
]


def publish_local_skill(
    workspace_path: Path,
    skill_id: str,
    version: str,
    *,
    description: str = "",
) -> PublishedAsset:
    """Publish one workspace skill as a fixed team asset version."""
    normalize_version(version)
    skill_file = workspace_path.expanduser() / "skills" / skill_id / "SKILL.md"
    if not skill_file.is_file():
        raise ValueError(f"skill not found in this workspace: {skill_id}")
    return TeamAssetStore(workspace_path).publish_skill_version(
        skill_id=skill_id,
        version=version,
        skill_markdown=skill_file.read_text(encoding="utf-8"),
        description=description,
    )


def publish_local_mcp(
    config: Config,
    workspace_path: Path,
    name: str,
    version: str,
) -> PublishedAsset:
    """Publish one configured MCP server definition, minus its credentials."""
    normalize_version(version)
    server = config.tools.mcp_servers.get(name)
    if server is None:
        raise ValueError(f"MCP server is not configured: {name}")
    # Explicitly drop env/headers: those hold the credentials that must
    # never leave this instance.
    manifest = sanitize_mcp_manifest(
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
    return TeamAssetStore(workspace_path).publish_mcp_version(
        name=name, version=version, manifest=manifest
    )


def list_team_submissions(workspace_path: Path) -> list[dict[str, Any]]:
    """Return pending submissions newest-last for the reviewer surface."""
    records = TeamAssetStore(workspace_path).list_pending()
    ordered = sorted(records, key=lambda item: float(item.get("created_at", 0.0)))
    return [record for record in ordered if record.get("status") == "pending"]


def approve_team_submission(
    workspace_path: Path,
    submission_id: str,
    *,
    reviewer: str = "",
    version: str = "",
) -> PublishedAsset:
    """Promote one pending submission into the published catalog."""
    store = TeamAssetStore(workspace_path)
    record = store.get_pending(submission_id)
    if record.get("status") != "pending":
        raise ValueError("submission was already reviewed")

    asset_type = record.get("asset_type")
    if asset_type not in ("skill", "mcp"):
        raise ValueError("submission has an unsupported asset type")
    kind = "skill" if asset_type == "skill" else "mcp"
    asset_id = str(record.get("id", ""))
    # Approving as an explicit version lets a reviewer cut a new fixed
    # version rather than inheriting whatever the submitter asked for.
    published_version = normalize_version(version.strip() or str(record.get("version", "")))

    if kind == "skill":
        content = record.get("content")
        if not isinstance(content, str) or not content.strip():
            raise ValueError("skill submission has no content")
        asset = store.publish_skill_version(
            skill_id=asset_id,
            version=published_version,
            skill_markdown=content,
            description=str(record.get("note", "")),
        )
    else:
        manifest = record.get("manifest")
        if not isinstance(manifest, dict):
            raise ValueError("MCP submission has no manifest")
        asset = store.publish_mcp_version(
            name=asset_id,
            version=published_version,
            manifest=cast(dict[str, Any], manifest),
        )

    store.set_pending_status(submission_id, "approved", reviewer=reviewer)
    return asset


def reject_team_submission(
    workspace_path: Path,
    submission_id: str,
    *,
    reviewer: str = "",
) -> dict[str, Any]:
    """Mark one pending submission rejected, keeping the audit record."""
    store = TeamAssetStore(workspace_path)
    record = store.get_pending(submission_id)
    if record.get("status") != "pending":
        raise ValueError("submission was already reviewed")
    return store.set_pending_status(submission_id, "rejected", reviewer=reviewer)
