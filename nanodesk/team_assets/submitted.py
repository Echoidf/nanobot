"""Consumer-side record of assets submitted to remote team instances.

The receiving instance keeps its own pending/review record under
``pending/``. This file only records that *we* sent something, to whom,
and what came back on the last status check, so the WebUI can list our
submissions instead of showing a one-shot toast.

Layout: ``<workspace>/team_assets/submitted.json``::

    {"submissions": {"sub_<hex>": {kind, id, version, submitter, note,
     target_id, target_name, target_url, submitted_at, status,
     status_checked_at}}}

``status`` mirrors the peer's review state on the last check:
``pending``/``approved``/``rejected``, or ``gone`` when the peer no
longer knows this submission (rejected and cleared, or taken down).
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, cast

from nanodesk.team_assets.store import (
    AssetKind,
    TeamAssetStore,
    normalize_asset_id,
    normalize_submission_id,
    normalize_version,
)

SUBMITTED_RECORD_FILE = "submitted.json"
SUBMITTER_MAX_LEN = 64
NOTE_MAX_LEN = 512

_STATUS_VALUES = ("pending", "approved", "rejected", "gone")

__all__ = [
    "SUBMITTED_RECORD_FILE",
    "list_team_submitted",
    "record_team_submitted",
    "update_team_submitted_status",
]


def _submitted_path(workspace_path: Path) -> Path:
    return TeamAssetStore(workspace_path).root / SUBMITTED_RECORD_FILE


def _load(workspace_path: Path) -> dict[str, dict[str, Any]]:
    path = _submitted_path(workspace_path)
    try:
        data = cast(object, json.loads(path.read_text(encoding="utf-8")))
    except FileNotFoundError:
        return {}
    except (OSError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    raw = cast(dict[str, Any], data).get("submissions")
    if not isinstance(raw, dict):
        return {}
    return {
        str(key): cast(dict[str, Any], value)
        for key, value in cast(dict[str, Any], raw).items()
        if isinstance(value, dict)
    }


def _write(workspace_path: Path, records: dict[str, dict[str, Any]]) -> None:
    path = _submitted_path(workspace_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps({"submissions": records}, ensure_ascii=False, indent=2)
    tmp_path = path.with_suffix(".tmp")
    tmp_path.write_text(payload, encoding="utf-8")
    tmp_path.replace(path)


def list_team_submitted(workspace_path: Path) -> list[dict[str, Any]]:
    """Return every submission we sent, newest first."""
    records = _load(workspace_path)
    rows = list(records.values())
    rows.sort(key=lambda item: float(item.get("submitted_at", 0.0)), reverse=True)
    return rows


def record_team_submitted(
    workspace_path: Path,
    *,
    submission_id: str,
    kind: AssetKind,
    asset_id: str,
    version: str,
    submitter: str,
    note: str,
    target_id: str,
    target_name: str,
    target_url: str,
) -> dict[str, Any]:
    """Record one submission we just sent to a remote team instance."""
    normalized_id = normalize_asset_id(kind, asset_id)
    key = normalize_submission_id(submission_id)
    record = {
        "submission_id": key,
        "kind": kind,
        "id": normalized_id,
        "version": normalize_version(version),
        "submitter": submitter.strip()[:SUBMITTER_MAX_LEN],
        "note": note.strip()[:NOTE_MAX_LEN],
        "target_id": target_id.strip(),
        "target_name": target_name.strip(),
        "target_url": target_url.strip(),
        "submitted_at": time.time(),
        "status": "pending",
        "status_checked_at": 0.0,
    }
    records = _load(workspace_path)
    records[key] = record
    _write(workspace_path, records)
    return record


def update_team_submitted_status(
    workspace_path: Path,
    submission_id: str,
    status: str,
) -> dict[str, Any] | None:
    """Update one record's review state from a fresh peer status check.

    Returns the updated record, or ``None`` when this instance never
    recorded that submission.
    """
    if status not in _STATUS_VALUES:
        raise ValueError(f"invalid submission status: {status}")
    key = normalize_submission_id(submission_id)
    records = _load(workspace_path)
    record = records.get(key)
    if record is None:
        return None
    record["status"] = status
    record["status_checked_at"] = time.time()
    records[key] = record
    _write(workspace_path, records)
    return record
