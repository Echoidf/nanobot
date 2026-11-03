"""Publisher-side team assets: review submissions from other instances.

This module is the authenticated half of the team-asset contract. It never
talks to a remote host — it only reads this instance's workspace and writes
this instance's own ``published`` snapshots and pending queue. Remote peers
reach this data only through the anonymous sidecar in
``nanodesk.team_assets.server``.

There is no local publish step: local skills and MCP servers are served
live from the workspace and config. Only submissions from *other*
instances land here, and only an approved submission is copied into
``published``.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, cast

from nanodesk.team_assets.store import (
    PublishedAsset,
    TeamAssetStore,
    normalize_version,
)

__all__ = [
    "approve_team_submission",
    "delete_team_submission",
    "list_team_submissions",
    "reject_team_submission",
]


def list_team_submissions(
    workspace_path: Path, *, include_reviewed: bool = False
) -> list[dict[str, Any]]:
    """Return submissions for the reviewer surface.

    Pending items come first (oldest first, so nothing starves); reviewed
    items follow newest first. Pass ``include_reviewed`` for the full
    history with ``status``/``reviewer``/``reviewed_at`` attached.
    """
    records = TeamAssetStore(workspace_path).list_pending()
    if not include_reviewed:
        pending_only = [item for item in records if item.get("status") == "pending"]
        return sorted(pending_only, key=lambda item: float(item.get("created_at", 0.0)))
    pending = sorted(
        (item for item in records if item.get("status") == "pending"),
        key=lambda item: float(item.get("created_at", 0.0)),
    )
    reviewed = sorted(
        (item for item in records if item.get("status") != "pending"),
        key=lambda item: float(item.get("reviewed_at", item.get("created_at", 0.0))),
        reverse=True,
    )
    return [*pending, *reviewed]


def delete_team_submission(workspace_path: Path, submission_id: str) -> dict[str, Any]:
    """Delete one reviewed submission record without keeping an audit trail.

    Pending submissions must go through approve/reject; only reviewed
    records can be deleted (e.g. together with a takedown).
    """
    store = TeamAssetStore(workspace_path)
    try:
        record = store.get_pending(submission_id)
    except FileNotFoundError as exc:
        raise ValueError("submission not found") from exc
    if record.get("status") == "pending":
        raise ValueError("pending submissions must be approved or rejected first")
    store.delete_pending(submission_id)
    return {"submission_id": submission_id, "deleted": True}


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
            origin="remote",
        )
    else:
        manifest = record.get("manifest")
        if not isinstance(manifest, dict):
            raise ValueError("MCP submission has no manifest")
        asset = store.publish_mcp_version(
            name=asset_id,
            version=published_version,
            manifest=cast(dict[str, Any], manifest),
            origin="remote",
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
