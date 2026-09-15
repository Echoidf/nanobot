from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from nanobot.agent.tools.base import Tool
from nanobot.agent.tools.registry import ToolRegistry
from nanobot.agent.workbench import (
    AgentProfileError,
    agent_profile_by_id,
    agents_payload,
    persist_agent_metadata,
    restricted_tools_for_agent,
    validate_agent_profile,
)
from nanobot.config.schema import Config


class DummyTool(Tool):
    def __init__(self, name: str, description: str = "") -> None:
        self._name = name
        self._description = description or f"{name} description"

    @property
    def name(self) -> str:
        return self._name

    @property
    def description(self) -> str:
        return self._description

    @property
    def parameters(self) -> dict[str, Any]:
        return {"type": "object", "properties": {}, "additionalProperties": False}

    async def execute(self, **kwargs: Any) -> str:
        return "ok"


def _write_skill(workspace: Path, name: str) -> None:
    skill = workspace / "skills" / name / "SKILL.md"
    skill.parent.mkdir(parents=True, exist_ok=True)
    skill.write_text(
        f"---\nname: {name}\ndescription: Test skill {name}\n---\n\nUse this skill.",
        encoding="utf-8",
    )


def test_config_rejects_duplicate_agent_profile_ids() -> None:
    with pytest.raises(ValidationError, match="duplicate agents.profiles id 'writer'"):
        Config(
            agents={
                "profiles": [
                    {"id": "writer", "name": "Writer"},
                    {"id": "writer", "name": "Writer Copy"},
                ]
            }
        )


def test_config_rejects_unknown_agent_model_preset() -> None:
    with pytest.raises(ValidationError, match=r"agents.profiles\['writer'\].model_preset 'missing'"):
        Config(agents={"profiles": [{"id": "writer", "name": "Writer", "model_preset": "missing"}]})


def test_agents_payload_reports_capability_status(tmp_path: Path) -> None:
    _write_skill(tmp_path, "drafting")
    config = Config(
        agents={
            "profiles": [
                {
                    "id": "writer",
                    "name": "Writer",
                    "description": "Draft copy",
                    "skills": ["drafting", "missing-skill"],
                    "tools": ["read_file", "missing_tool"],
                }
            ]
        }
    )

    payload = agents_payload(
        config=config,
        workspace=tmp_path,
        disabled_skills={"drafting"},
        tool_definitions=[
            {
                "type": "function",
                "function": {
                    "name": "read_file",
                    "description": "Read a file",
                    "parameters": {"type": "object"},
                },
            }
        ],
    )

    rows = {agent["id"]: agent for agent in payload["agents"]}
    assert payload["default_agent_id"] == "default"
    assert rows["default"]["capabilities_ok"] is True
    assert rows["default"]["tools"] == []
    assert rows["default"]["tool_names"] == []
    assert rows["writer"]["capabilities_ok"] is False
    assert rows["writer"]["disabled_skills"] == ["drafting"]
    assert rows["writer"]["missing_skills"] == ["missing-skill"]
    assert rows["writer"]["missing_tools"] == ["missing_tool"]
    assert rows["writer"]["tools"] == [{"name": "read_file", "description": "Read a file"}]
    assert rows["writer"]["tool_names"] == ["read_file", "missing_tool"]


def test_validate_agent_profile_rejects_disabled_missing_and_unavailable_capabilities(tmp_path: Path) -> None:
    _write_skill(tmp_path, "drafting")
    config = Config(
        agents={
            "profiles": [
                {
                    "id": "writer",
                    "name": "Writer",
                    "skills": ["drafting", "missing-skill"],
                    "tools": ["read_file", "missing_tool"],
                },
                {"id": "disabled", "name": "Disabled", "status": "disabled"},
            ]
        }
    )

    with pytest.raises(AgentProfileError, match="agent 'disabled' is disabled"):
        validate_agent_profile(
            agent_profile_by_id(config, "disabled"),
            workspace=tmp_path,
            disabled_skills=set(),
            tool_names=set(),
        )

    with pytest.raises(AgentProfileError) as excinfo:
        validate_agent_profile(
            agent_profile_by_id(config, "writer"),
            workspace=tmp_path,
            disabled_skills={"drafting"},
            tool_names={"read_file"},
        )

    message = excinfo.value.message
    assert "missing skills: missing-skill" in message
    assert "unavailable skills: drafting" in message
    assert "missing tools: missing_tool" in message
    assert excinfo.value.status == 409


def test_restricted_tools_for_agent_returns_allowlisted_registry() -> None:
    config = Config(
        agents={"profiles": [{"id": "writer", "name": "Writer", "tools": ["read_file"]}]}
    )
    registry = ToolRegistry()
    registry.register(DummyTool("read_file"))
    registry.register(DummyTool("write_file"))

    restricted = restricted_tools_for_agent(agent_profile_by_id(config, "writer"), registry)

    assert restricted is not registry
    assert restricted.tool_names == ["read_file"]
    assert restricted.get("read_file") is registry.get("read_file")
    assert restricted.get("write_file") is None


def test_default_agent_metadata_is_not_persisted() -> None:
    metadata = {"agent_id": "writer", "other": True}

    persist_agent_metadata(metadata, "default")

    assert metadata == {"other": True}
