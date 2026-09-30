"""Tests for team-assets instance identity validation."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from nanodesk.agent.workbench import update_agent_profiles
from nanodesk.config.loader import ConfigLoadError, load_config, save_config
from nanodesk.config.schema import Config, TeamAssetsConfig


def test_team_assets_accepts_empty_instance_id_while_disabled() -> None:
    """A disabled sidecar must round-trip with the empty default it declares.

    The field's default is "", and the app always serializes the key, so an
    explicit "" has to validate too. A 1-based pattern made every saved config
    unreadable, which broke every config write (including agent creation).
    """
    config = TeamAssetsConfig.model_validate({"enabled": False, "instanceId": ""})
    assert config.instance_id == ""

    # The field's own default must satisfy its own pattern.
    assert TeamAssetsConfig().instance_id == ""


def test_team_assets_requires_instance_id_when_enabled() -> None:
    with pytest.raises(ValidationError):
        TeamAssetsConfig.model_validate({"enabled": True, "instanceId": ""})


def test_team_assets_rejects_malformed_instance_id() -> None:
    with pytest.raises(ValidationError):
        TeamAssetsConfig.model_validate({"enabled": False, "instanceId": "bad id!"})
    with pytest.raises(ValidationError):
        TeamAssetsConfig.model_validate({"enabled": False, "instanceId": "x" * 65})


def test_saved_config_reloads_when_team_assets_disabled(tmp_path: Path) -> None:
    """The failure mode that broke agent creation: write, then read back."""
    path = tmp_path / "config.json"
    config = Config.model_validate({
        "agents": {"defaults": {"workspace": str(tmp_path)}},
    })
    save_config(config, path)

    saved = json.loads(path.read_text(encoding="utf-8"))
    assert saved["teamAssets"]["instanceId"] == ""

    # A gateway config write (agent create) reloads before mutating.
    update_agent_profiles(load_config(path), {
        "profile": {
            "id": "my-agent",
            "name": "My Agent",
            "description": "",
            "status": "active",
            "skills": [],
            "tools": [],
        }
    }, "create")


def test_load_config_reports_empty_instance_id_as_valid(tmp_path: Path) -> None:
    path = tmp_path / "config.json"
    path.write_text(
        json.dumps({"teamAssets": {"enabled": False, "instanceId": ""}}),
        encoding="utf-8",
    )

    assert load_config(path).team_assets.instance_id == ""


def test_load_config_still_surfaces_genuinely_invalid_instance_id(tmp_path: Path) -> None:
    path = tmp_path / "config.json"
    path.write_text(
        json.dumps({"teamAssets": {"enabled": False, "instanceId": "not valid"}}),
        encoding="utf-8",
    )

    with pytest.raises(ConfigLoadError):
        load_config(path)
