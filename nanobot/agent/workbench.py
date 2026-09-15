"""Agent Workbench profile catalog and session binding helpers."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

from nanobot.agent.skills import SkillsLoader
from nanobot.agent.tools.registry import ToolRegistry
from nanobot.config.schema import AgentProfileConfig, Config

AGENT_ID_METADATA_KEY = "agent_id"
DEFAULT_AGENT_ID = "default"


class AgentProfileError(Exception):
    """Raised when a session-bound agent profile cannot be used."""

    def __init__(self, message: str, *, status: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status = status


@dataclass(frozen=True)
class AgentRuntimeProfile:
    id: str
    name: str
    icon: str | None
    description: str
    status: str
    model_preset: str | None
    system_prompt: str | None
    skills: tuple[str, ...]
    tools: tuple[str, ...]

    @property
    def unrestricted_tools(self) -> bool:
        return not self.tools


@dataclass(frozen=True)
class AgentCapabilityStatus:
    missing_skills: tuple[str, ...]
    disabled_skills: tuple[str, ...]
    missing_tools: tuple[str, ...]

    @property
    def ok(self) -> bool:
        return not self.missing_skills and not self.disabled_skills and not self.missing_tools


def _default_agent(config: Config) -> AgentRuntimeProfile:
    defaults = config.agents.defaults
    return AgentRuntimeProfile(
        id=DEFAULT_AGENT_ID,
        name=defaults.bot_name or "NanoDesk",
        icon=defaults.bot_icon or None,
        description="Default NanoDesk assistant using the global model, skills, and tools.",
        status="active",
        model_preset=defaults.model_preset or "default",
        system_prompt=None,
        skills=(),
        tools=(),
    )


def _configured_agent(profile: AgentProfileConfig) -> AgentRuntimeProfile:
    return AgentRuntimeProfile(
        id=profile.id,
        name=profile.name,
        icon=profile.icon,
        description=profile.description,
        status=profile.status,
        model_preset=profile.model_preset,
        system_prompt=profile.system_prompt,
        skills=tuple(dict.fromkeys(profile.skills)),
        tools=tuple(dict.fromkeys(profile.tools)),
    )


def configured_agent_profiles(config: Config) -> list[AgentRuntimeProfile]:
    """Return configured profiles plus the built-in default profile."""
    profiles = [_default_agent(config)]
    seen = {DEFAULT_AGENT_ID}
    for profile in config.agents.profiles:
        if profile.id in seen:
            continue
        profiles.append(_configured_agent(profile))
        seen.add(profile.id)
    return profiles


def agent_profile_by_id(config: Config, agent_id: str | None) -> AgentRuntimeProfile:
    requested = (agent_id or DEFAULT_AGENT_ID).strip() or DEFAULT_AGENT_ID
    for profile in configured_agent_profiles(config):
        if profile.id == requested:
            return profile
    raise AgentProfileError(f"agent {requested!r} not found", status=404)


def agent_id_from_metadata(metadata: dict[str, Any] | None) -> str | None:
    raw = (metadata or {}).get(AGENT_ID_METADATA_KEY)
    return raw if isinstance(raw, str) and raw.strip() else None


def persist_agent_metadata(metadata: dict[str, Any], agent_id: str | None) -> None:
    if not agent_id or agent_id == DEFAULT_AGENT_ID:
        metadata.pop(AGENT_ID_METADATA_KEY, None)
        return
    metadata[AGENT_ID_METADATA_KEY] = agent_id


def _tool_name(schema: dict[str, Any]) -> str:
    function = schema.get("function")
    if isinstance(function, dict):
        name = cast(dict[str, Any], function).get("name")
        return name if isinstance(name, str) else ""
    name = schema.get("name")
    return name if isinstance(name, str) else ""


def _tool_description(schema: dict[str, Any]) -> str:
    function = schema.get("function")
    if isinstance(function, dict):
        description = cast(dict[str, Any], function).get("description")
        return description if isinstance(description, str) else ""
    description = schema.get("description")
    return description if isinstance(description, str) else ""


def capability_status(
    profile: AgentRuntimeProfile,
    *,
    workspace: Path,
    disabled_skills: set[str] | None,
    tool_names: set[str],
) -> AgentCapabilityStatus:
    all_loader = SkillsLoader(workspace)
    available_loader = SkillsLoader(workspace, disabled_skills=disabled_skills)
    all_skill_names = {
        entry["name"] for entry in all_loader.list_skills(filter_unavailable=False)
    }
    available_skill_names = {
        entry["name"] for entry in available_loader.list_skills(filter_unavailable=True)
    }
    requested_skills = set(profile.skills)
    return AgentCapabilityStatus(
        missing_skills=tuple(sorted(requested_skills - all_skill_names)),
        disabled_skills=tuple(
            sorted(requested_skills - available_skill_names - (requested_skills - all_skill_names))
        ),
        missing_tools=tuple(sorted(set(profile.tools) - tool_names)),
    )


def validate_agent_profile(
    profile: AgentRuntimeProfile,
    *,
    workspace: Path,
    disabled_skills: set[str] | None,
    tool_names: set[str],
) -> AgentCapabilityStatus:
    status = capability_status(
        profile,
        workspace=workspace,
        disabled_skills=disabled_skills,
        tool_names=tool_names,
    )
    if profile.status == "disabled":
        raise AgentProfileError(f"agent {profile.id!r} is disabled", status=409)
    if not status.ok:
        parts: list[str] = []
        if status.missing_skills:
            parts.append("missing skills: " + ", ".join(status.missing_skills))
        if status.disabled_skills:
            parts.append("unavailable skills: " + ", ".join(status.disabled_skills))
        if status.missing_tools:
            parts.append("missing tools: " + ", ".join(status.missing_tools))
        raise AgentProfileError(
            f"agent {profile.id!r} cannot start; " + "; ".join(parts),
            status=409,
        )
    return status


def restricted_tools_for_agent(profile: AgentRuntimeProfile, tools: ToolRegistry) -> ToolRegistry:
    """Return a tool registry restricted by an agent allowlist, or the original registry."""
    if profile.unrestricted_tools:
        return tools
    restricted = ToolRegistry()
    for name in profile.tools:
        tool = tools.get(name)
        if tool is not None:
            restricted.register(tool)
    return restricted


def agent_prompt_block(profile: AgentRuntimeProfile, workspace: Path) -> str:
    """Build the session-level agent instruction block for the system prompt."""
    lines = [
        "# Active Agent",
        f"- ID: {profile.id}",
        f"- Name: {profile.name}",
    ]
    if profile.description:
        lines.append(f"- Description: {profile.description}")
    if profile.tools:
        lines.append("- Enabled tools: " + ", ".join(profile.tools))
    if profile.skills:
        lines.append("- Required skills: " + ", ".join(profile.skills))
    if profile.system_prompt:
        lines.append("\n## Agent Instructions\n" + profile.system_prompt.strip())
    if profile.skills:
        skills = SkillsLoader(workspace).load_skills_for_context(list(profile.skills))
        if skills:
            lines.append("\n## Agent Skills\n" + skills)
    return "\n".join(lines)


def _agent_payload(
    profile: AgentRuntimeProfile,
    *,
    workspace: Path,
    disabled_skills: set[str] | None,
    tool_payload_by_name: dict[str, dict[str, str]],
) -> dict[str, Any]:
    tool_names = set(tool_payload_by_name)
    status = capability_status(
        profile,
        workspace=workspace,
        disabled_skills=disabled_skills,
        tool_names=tool_names,
    )
    return {
        "id": profile.id,
        "name": profile.name,
        "icon": profile.icon,
        "description": profile.description,
        "status": profile.status,
        "model_preset": profile.model_preset,
        "system_prompt": profile.system_prompt,
        "skills": list(profile.skills),
        "tools": [
            tool_payload_by_name[name]
            for name in profile.tools
            if name in tool_payload_by_name
        ],
        "tool_names": list(profile.tools),
        "capabilities_ok": status.ok and profile.status != "disabled",
        "missing_skills": list(status.missing_skills),
        "disabled_skills": list(status.disabled_skills),
        "missing_tools": list(status.missing_tools),
    }


def agents_payload(
    *,
    config: Config,
    workspace: Path,
    disabled_skills: set[str] | None,
    tool_definitions: list[dict[str, Any]],
) -> dict[str, Any]:
    tool_payload_by_name = {
        name: {"name": name, "description": _tool_description(schema)}
        for schema in tool_definitions
        if (name := _tool_name(schema))
    }
    skill_catalog = SkillsLoader(workspace=workspace, disabled_skills=disabled_skills or set()).list_skills(
        filter_unavailable=False
    )
    return {
        "schema_version": 1,
        "default_agent_id": DEFAULT_AGENT_ID,
        "skill_catalog": [
            {"name": item["name"], "source": item.get("source", "")} for item in skill_catalog
        ],
        "tool_catalog": list(tool_payload_by_name.values()),
        "agents": [
            _agent_payload(
                profile,
                workspace=workspace,
                disabled_skills=disabled_skills,
                tool_payload_by_name=tool_payload_by_name,
            )
            for profile in configured_agent_profiles(config)
        ],
    }


def update_agent_profiles(config: Config, payload: dict[str, Any], action: str) -> None:
    """Validate and persist one WebUI agent profile mutation."""
    raw = payload.get("profile")
    if not isinstance(raw, dict):
        raise AgentProfileError("profile must be an object")
    try:
        profile = AgentProfileConfig.model_validate(raw)
    except Exception as exc:
        raise AgentProfileError(f"invalid agent profile: {exc}") from exc
    if profile.id == DEFAULT_AGENT_ID:
        raise AgentProfileError("the default agent cannot be edited", status=409)
    profiles = config.agents.profiles
    index = next((i for i, item in enumerate(profiles) if item.id == profile.id), None)
    if action == "create":
        if index is not None:
            raise AgentProfileError("agent id already exists", status=409)
        profiles.append(profile)
    elif action == "update":
        if index is None:
            raise AgentProfileError("agent not found", status=404)
        profiles[index] = profile
    elif action == "delete":
        if index is None:
            raise AgentProfileError("agent not found", status=404)
        del profiles[index]
    else:
        raise AgentProfileError("unknown agent action", status=404)
