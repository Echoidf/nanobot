"""Tests for shared-instance selective inheritance."""

import json
from pathlib import Path

from nanodesk.agent.skills import SkillsLoader
from nanodesk.config.schema import Config
from nanodesk.config.shared import (
    apply_shared_instances,
    shared_payload,
    shared_skill_names,
    shared_skills_dirs,
)


def _write_skill(skills_root: Path, name: str, body: str = "# Skill") -> Path:
    skill_dir = skills_root / name
    skill_dir.mkdir(parents=True, exist_ok=True)
    skill_file = skill_dir / "SKILL.md"
    skill_file.write_text(
        f"---\nname: {name}\ndescription: {name} description\n---\n\n{body}\n",
        encoding="utf-8",
    )
    return skill_file


def _write_shared_config(
    path: Path,
    workspace: Path,
    *,
    profiles: list[dict[str, object]] | None = None,
    mcp_servers: dict[str, object] | None = None,
) -> None:
    path.write_text(
        json.dumps({
            "agents": {
                "defaults": {"workspace": str(workspace)},
                "profiles": profiles or [],
            },
            "tools": {"mcp_servers": mcp_servers or {}},
        }),
        encoding="utf-8",
    )


def test_shared_skills_mcp_agents_are_merged(tmp_path: Path) -> None:
    shared_ws = tmp_path / "shared-ws"
    _write_skill(shared_ws / "skills", "team-skill")
    shared_path = tmp_path / "shared.json"
    _write_shared_config(
        shared_path,
        shared_ws,
        profiles=[{"id": "code-review", "name": "Code Review"}],
        mcp_servers={"docs": {"url": "http://example.com/mcp"}},
    )
    user_ws = tmp_path / "user-ws"
    user_ws.mkdir()

    config = Config.model_validate({
        "agents": {"defaults": {"workspace": str(user_ws)}},
        "sharedInstances": [{
            "id": "team",
            "name": "Team",
            "baseUrl": "http://team:8765",
            "configPath": str(shared_path),
            "inherit": {"skills": ["*"], "mcp": ["docs"], "agents": ["code-review"]},
        }],
    })
    apply_shared_instances(config)

    assert shared_skills_dirs(config) == [(shared_ws / "skills").resolve()]
    assert "docs" in config.tools.mcp_servers
    assert [p.id for p in config.agents.profiles] == ["code-review"]

    loader = SkillsLoader(
        user_ws,
        shared_skills_dirs=shared_skills_dirs(config),
        shared_skill_names=shared_skill_names(config),
    )
    entries = {
        entry["name"]: entry["source"]
        for entry in loader.list_skills(filter_unavailable=False)
    }
    assert entries["team-skill"] == "shared"


def test_user_values_win_and_selection_is_respected(tmp_path: Path) -> None:
    shared_ws = tmp_path / "shared-ws"
    _write_skill(shared_ws / "skills", "team-skill")
    _write_skill(shared_ws / "skills", "other-skill")
    shared_path = tmp_path / "shared.json"
    _write_shared_config(
        shared_path,
        shared_ws,
        profiles=[
            {"id": "code-review", "name": "Shared CR"},
            {"id": "deploy", "name": "Deploy"},
        ],
        mcp_servers={
            "docs": {"url": "http://example.com/mcp"},
            "other": {"url": "http://example.com/other"},
        },
    )
    user_ws = tmp_path / "user-ws"
    _write_skill(user_ws / "skills", "team-skill", body="# Mine")

    config = Config.model_validate({
        "agents": {
            "defaults": {"workspace": str(user_ws)},
            "profiles": [{"id": "code-review", "name": "Mine"}],
        },
        "tools": {"mcp_servers": {"docs": {"url": "http://mine.local/mcp"}}},
        "sharedInstances": [{
            "id": "team",
            "configPath": str(shared_path),
            "inherit": {"skills": ["team-skill"], "mcp": ["*"], "agents": ["deploy"]},
        }],
    })
    apply_shared_instances(config)

    # User MCP + agent entries are kept; only missing selected ones merge.
    assert config.tools.mcp_servers["docs"].url == "http://mine.local/mcp"
    assert "other" in config.tools.mcp_servers
    assert {p.id: p.name for p in config.agents.profiles} == {
        "code-review": "Mine",
        "deploy": "Deploy",
    }

    loader = SkillsLoader(
        user_ws,
        shared_skills_dirs=shared_skills_dirs(config),
        shared_skill_names=shared_skill_names(config),
    )
    entries = {
        entry["name"]: entry["source"]
        for entry in loader.list_skills(filter_unavailable=False)
        if entry["name"] in {"team-skill", "other-skill"}
    }
    # Workspace skill wins over the shared same-named one.
    assert entries["team-skill"] == "workspace"
    assert "other-skill" not in entries  # not selected for inheritance


def test_missing_shared_file_only_warns(tmp_path: Path) -> None:
    user_ws = tmp_path / "user-ws"
    user_ws.mkdir()
    config = Config.model_validate({
        "agents": {"defaults": {"workspace": str(user_ws)}},
        "sharedInstances": [{
            "id": "ghost",
            "configPath": str(tmp_path / "does-not-exist.json"),
        }],
    })
    apply_shared_instances(config)  # must not raise

    assert shared_skills_dirs(config) == []
    payload = shared_payload(config)
    assert payload["instances"][0]["id"] == "ghost"
    assert payload["instances"][0]["hasBaseUrl"] is False
    assert any("ghost" in warning for warning in payload["warnings"])


def test_shared_payload_hides_local_paths(tmp_path: Path) -> None:
    user_ws = tmp_path / "user-ws"
    user_ws.mkdir()
    config = Config.model_validate({
        "agents": {"defaults": {"workspace": str(user_ws)}},
        "sharedInstances": [{
            "id": "team",
            "name": "Team",
            "baseUrl": "http://team:8765",
            "configPath": "/srv/secret/config.json",
        }],
    })
    payload = shared_payload(config)
    dumped = json.dumps(payload)
    assert "/srv/secret/config.json" not in dumped
    assert payload["instances"][0]["hasBaseUrl"] is True
