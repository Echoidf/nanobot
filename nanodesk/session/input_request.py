"""Pending user-input request store (Codex request_user_input semantics)."""

from __future__ import annotations

from typing import Any, cast

INPUT_REQUEST_KEY = "pending_input_request"


def get_pending_input_request(metadata: Any) -> dict[str, Any] | None:
    """Return the suspended input request, or ``None`` when not waiting."""
    if not isinstance(metadata, dict):
        return None
    state = metadata.get(INPUT_REQUEST_KEY)
    if not isinstance(state, dict):
        return None
    state = cast(dict[str, Any], state)
    if not state.get("interaction_id") or not state.get("tool_call_id"):
        return None
    return state


def save_pending_input_request(metadata: dict[str, Any], request: dict[str, Any]) -> None:
    """Suspend the turn: record what the next user message answers."""
    metadata[INPUT_REQUEST_KEY] = dict(request)


def clear_pending_input_request(metadata: dict[str, Any] | Any) -> dict[str, Any] | None:
    """Resume the turn: drop the pending request and return it."""
    if not isinstance(metadata, dict):
        return None
    state = metadata.pop(INPUT_REQUEST_KEY, None)
    return state if isinstance(state, dict) else None
