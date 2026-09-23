"""Lightweight session owner lock for shared-instance use.

Goal: prevent two people from operating the same session at once without
building a full multi-user system. Ownership lives in session metadata so
it survives only as long as the session does:

- ``session_owner``: opaque owner id (e.g. browser UUID + username)
- ``session_owner_label``: human label shown to others
- ``session_owner_at``: last heartbeat epoch seconds

A claim succeeds when no owner exists, the caller already owns it, or the
previous heartbeat is stale (TTL). Heartbeats refresh while the owner tab
is open; release clears on explicit leave.
"""

from __future__ import annotations

import time
from typing import Any

OWNER_KEY = "session_owner"
OWNER_LABEL_KEY = "session_owner_label"
OWNER_AT_KEY = "session_owner_at"

OWNER_TTL_SECONDS = 60.0


def _now() -> float:
    return time.time()


def owner_status(metadata: dict[str, Any] | None, *, now: float | None = None) -> dict[str, Any]:
    """Return the public owner state for a session metadata dict."""
    meta = metadata or {}
    owner = meta.get(OWNER_KEY)
    if not isinstance(owner, str) or not owner:
        return {"owner": None, "label": None, "active": False, "stale": True}
    at = meta.get(OWNER_AT_KEY)
    at_value = float(at) if isinstance(at, (int, float)) else 0.0
    current = now if now is not None else _now()
    active = (current - at_value) < OWNER_TTL_SECONDS
    label = meta.get(OWNER_LABEL_KEY)
    return {
        "owner": owner,
        "label": label if isinstance(label, str) and label else None,
        "active": active,
        "stale": not active,
        "last_seen": at_value,
    }


def try_claim(
    metadata: dict[str, Any],
    *,
    owner_id: str,
    label: str | None = None,
    now: float | None = None,
) -> tuple[bool, dict[str, Any]]:
    """Claim ownership. Returns (ok, status). Existing owner wins unless stale."""
    current = owner_status(metadata, now=now)
    if current["active"] and current["owner"] not in (None, owner_id):
        return False, current
    timestamp = now if now is not None else _now()
    metadata[OWNER_KEY] = owner_id
    metadata[OWNER_AT_KEY] = timestamp
    if label:
        metadata[OWNER_LABEL_KEY] = label[:80]
    return True, owner_status(metadata, now=timestamp)


def heartbeat(
    metadata: dict[str, Any],
    *,
    owner_id: str,
    now: float | None = None,
) -> tuple[bool, dict[str, Any]]:
    """Refresh ownership. Fails when another active owner holds the session."""
    current = owner_status(metadata, now=now)
    if current["active"] and current["owner"] not in (None, owner_id):
        return False, current
    timestamp = now if now is not None else _now()
    metadata[OWNER_KEY] = owner_id
    metadata[OWNER_AT_KEY] = timestamp
    return True, owner_status(metadata, now=timestamp)


def release(metadata: dict[str, Any], *, owner_id: str) -> dict[str, Any]:
    """Release ownership when the holder leaves. Others cannot release."""
    if metadata.get(OWNER_KEY) == owner_id:
        metadata.pop(OWNER_KEY, None)
        metadata.pop(OWNER_LABEL_KEY, None)
        metadata.pop(OWNER_AT_KEY, None)
    return owner_status(metadata)
