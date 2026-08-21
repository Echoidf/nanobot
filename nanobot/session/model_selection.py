"""Session-scoped model preset metadata."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Literal, cast

# Session.metadata is public SDK data, so internal selectors use a reserved namespace.
SESSION_MODEL_PRESET_METADATA_KEY = "_nanobot_model_preset"
SESSION_MODEL_SELECTION_MODE_METADATA_KEY = "_nanobot_model_selection_mode"
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
