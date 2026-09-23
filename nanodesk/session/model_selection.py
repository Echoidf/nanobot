"""Session-scoped model preset metadata."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Literal, cast

# Session.metadata is public SDK data, so internal selectors use a reserved namespace.
SESSION_MODEL_PRESET_METADATA_KEY = "_nanodesk_model_preset"
SESSION_MODEL_SELECTION_MODE_METADATA_KEY = "_nanodesk_model_selection_mode"
SESSION_REASONING_EFFORT_METADATA_KEY = "_nanodesk_reasoning_effort"
ModelSelectionMode = Literal["auto", "manual"]


def model_preset_from_metadata(metadata: object) -> str | None:
    """Read the canonical session preset name from persisted metadata."""
    if not isinstance(metadata, Mapping):
        return None
    typed_metadata = cast(Mapping[object, object], metadata)
    if SESSION_MODEL_PRESET_METADATA_KEY not in typed_metadata:
        return None
    value = typed_metadata[SESSION_MODEL_PRESET_METADATA_KEY]
    if not isinstance(value, str) or not value.strip():
        raise ValueError("session model preset must be a non-empty string")
    return value.strip()


def model_selection_mode_from_metadata(metadata: object) -> ModelSelectionMode:
    """Read the session model mode, treating legacy preset selections as manual."""
    if not isinstance(metadata, Mapping):
        return "auto"
    typed_metadata = cast(Mapping[object, object], metadata)
    value = typed_metadata.get(SESSION_MODEL_SELECTION_MODE_METADATA_KEY)
    if value is None:
        return "manual" if model_preset_from_metadata(metadata) is not None else "auto"
    if value not in {"auto", "manual"}:
        raise ValueError("session model selection mode must be 'auto' or 'manual'")
    return cast(ModelSelectionMode, value)


def normalize_session_reasoning_effort(value: object) -> str | None:
    """Normalize a session reasoning-effort override; empty/default clears it."""
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("session reasoning effort must be a string")
    trimmed = value.strip()
    if not trimmed or trimmed.casefold() in {"default", "preset", "auto"}:
        return None
    if len(trimmed) > 64:
        raise ValueError("session reasoning effort must be at most 64 characters")
    if any(part.isspace() for part in trimmed):
        raise ValueError("session reasoning effort must be a single value without spaces")
    return trimmed


def reasoning_effort_from_metadata(metadata: object) -> str | None:
    """Read the session-scoped reasoning-effort override, if any."""
    if not isinstance(metadata, Mapping):
        return None
    typed_metadata = cast(Mapping[object, object], metadata)
    if SESSION_REASONING_EFFORT_METADATA_KEY not in typed_metadata:
        return None
    return normalize_session_reasoning_effort(
        typed_metadata[SESSION_REASONING_EFFORT_METADATA_KEY]
    )
