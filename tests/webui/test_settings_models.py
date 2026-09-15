from __future__ import annotations

from typing import Any

import pytest

from nanobot.config.schema import Config
from nanobot.webui.settings_models import (
    WebUISettingsError,
    create_provider_settings,
    delete_provider_settings,
    model_settings_payload,
    update_agent_model_settings,
    update_provider_settings,
)


def _oauth_status(_spec: Any) -> dict[str, Any]:
    return {
        "configured": False,
        "account": None,
        "expires_at": None,
        "login_supported": True,
    }


def test_model_domain_owns_dto_and_config_updates() -> None:
    config = Config()
    config.providers.openrouter.api_key = "sk-before"

    agent_changed = update_agent_model_settings(
        config,
        {
            "model": ["openai/gpt-5.4"],
            "provider": ["openrouter"],
            "context_window_tokens": ["200000"],
        },
        oauth_status=_oauth_status,
    )
    provider_changed, restart_required = update_provider_settings(
        config,
        {
            "provider": ["openrouter"],
            "api_key": ["sk-after"],
        },
    )
    payload = model_settings_payload(config, oauth_status=_oauth_status)

    assert agent_changed is True
    assert provider_changed is True
    assert restart_required is False
    assert config.agents.defaults.model == "openai/gpt-5.4"
    assert config.agents.defaults.provider == "openrouter"
    assert config.agents.defaults.context_window_tokens == 200_000
    assert config.providers.openrouter.api_key == "sk-after"
    assert set(payload) == {
        "agent",
        "model_presets",
        "model_call_order",
        "model_call_order_editable",
        "providers",
    }
    assert payload["agent"]["model"] == "openai/gpt-5.4"


def test_delete_custom_provider_removes_configuration() -> None:
    config = Config()
    provider_key = create_provider_settings(
        config,
        {
            "name": ["Company Gateway"],
            "api_base": ["https://gateway.example/v1"],
            "api_key": ["sk-company"],
        },
    )
    assert provider_key == "custom-company-gateway"
    assert getattr(config.providers, provider_key).api_key == "sk-company"

    changed, restart_required = delete_provider_settings(
        config,
        {"provider": ["custom-company-gateway"]},
    )

    assert changed is True
    assert restart_required is False
    assert not hasattr(config.providers, "custom-company-gateway")


def test_delete_builtin_provider_resets_to_default() -> None:
    config = Config()
    config.providers.openrouter.api_key = "sk-before"

    changed, restart_required = delete_provider_settings(
        config,
        {"provider": ["openrouter"]},
    )

    assert changed is True
    assert restart_required is False
    assert config.providers.openrouter.api_key is None


def test_delete_provider_requires_provider_name() -> None:
    config = Config()
    with pytest.raises(WebUISettingsError, match="provider is required"):
        delete_provider_settings(config, {})


def test_delete_unknown_provider_raises() -> None:
    config = Config()
    with pytest.raises(WebUISettingsError, match="unknown provider"):
        delete_provider_settings(config, {"provider": ["no_such_provider"]})


def test_delete_provider_referenced_by_preset_is_blocked() -> None:
    config = Config()
    from nanobot.config.schema import ModelPresetConfig

    config.model_presets["gpt"] = ModelPresetConfig(
        model="gpt-5.4",
        provider="openrouter",
    )

    with pytest.raises(WebUISettingsError, match="model configuration"):
        delete_provider_settings(config, {"provider": ["openrouter"]})


