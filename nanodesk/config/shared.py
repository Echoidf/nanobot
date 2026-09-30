"""Shared-instance inheritance for team use.

A user instance declares external shared instances in
``sharedInstances`` and selectively inherits their skills, MCP servers
and agent profiles. Skills themselves stay on disk: we only collect the
shared ``<workspace>/skills`` directories. MCP/agent entries are merged
by name/id with user config winning on conflict.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, cast

from loguru import logger

from nanodesk.config.schema import (
    AgentProfileConfig,
    Config,
    MCPServerConfig,
)


def _select_names(available: list[str], selected: list[str]) -> list[str]:
    if "*" in selected:
        return list(available)
    wanted = set(selected)
    return [name for name in available if name in wanted]


def _as_dict(value: object) -> dict[str, Any]:
    return cast(dict[str, Any], value) if isinstance(value, dict) else {}


def _as_list(value: object) -> list[Any]:
    return cast(list[Any], value) if isinstance(value, list) else []


def _load_shared_dict(path: Path) -> dict[str, Any] | None:
    try:
        with path.open(encoding="utf-8") as handle:
            data = json.load(handle)
    except FileNotFoundError:
        logger.warning("shared instance config not found: {}", path)
        return None
    except (OSError, ValueError) as exc:
        logger.warning("shared instance config unreadable {}: {}", path, exc)
        return None
    if not isinstance(data, dict):
        logger.warning("shared instance config root must be an object: {}", path)
        return None
    return cast(dict[str, Any], data)


def apply_shared_instances(config: Config) -> None:
    """Merge shared skills/MCP/agents into an already-validated Config.

    Best-effort: missing/unreadable shared files only produce warnings.
    Never raises for shared-source problems; never overwrites user values.
    """
    shared_dirs: list[Path] = []
    warnings: list[str] = []
    shared_names: set[str] = set()
    inherited_agent_ids: set[str] = set()
    inherited_mcp_names: set[str] = set()
    shared_names_all = False
    instances = list(config.shared_instances or [])
    if not instances:
        config._shared_skills_dirs = []  # pyright: ignore[reportPrivateUsage]
        config._shared_skill_names = None  # pyright: ignore[reportPrivateUsage]
        config._shared_agent_ids = set()  # pyright: ignore[reportPrivateUsage]
        config._shared_mcp_names = set()  # pyright: ignore[reportPrivateUsage]
        config._shared_warnings = []  # pyright: ignore[reportPrivateUsage]
        return

    seen_ids: set[str] = set()
    for item in instances:
        item_id = item.id or "?"
        if item_id in seen_ids:
            warnings.append(f"duplicate sharedInstances id {item_id!r}")
            continue
        seen_ids.add(item_id)
        raw_path = (item.config_path or "").strip()
        if not raw_path:
            continue
        shared_path = Path(raw_path).expanduser()
        data = _load_shared_dict(shared_path)
        if data is None:
            warnings.append(f"shared instance {item_id!r}: cannot read {shared_path}")
            continue
        want_skills = list(item.inherit.skills or [])
        want_mcp = list(item.inherit.mcp or [])
        want_agents = list(item.inherit.agents or [])

        # --- shared skills dir: <shared workspace>/skills ---
        if want_skills:
            if "*" in want_skills:
                shared_names_all = True
            else:
                shared_names.update(want_skills)
            try:
                agents_section = _as_dict(data.get("agents"))
                defaults_section = _as_dict(agents_section.get("defaults"))
                workspace_raw = defaults_section.get("workspace")
                workspace = (
                    str(workspace_raw).strip()
                    if isinstance(workspace_raw, str) and workspace_raw.strip()
                    else str(shared_path.parent / "workspace")
                )
                skills_dir = Path(workspace).expanduser() / "skills"
                if skills_dir.is_dir():
                    resolved = skills_dir.resolve(strict=False)
                    if resolved not in shared_dirs:
                        shared_dirs.append(resolved)
                else:
                    warnings.append(f"shared instance {item_id!r}: skills dir missing {skills_dir}")
            except OSError as exc:
                warnings.append(f"shared instance {item_id!r}: {exc}")

        # --- MCP servers: merge by name, user wins ---
        try:
            tools_section = _as_dict(data.get("tools"))
            shared_mcp = _as_dict(tools_section.get("mcp_servers"))
            picked = _select_names(list(shared_mcp.keys()), want_mcp)
            local_mcp = config.tools.mcp_servers
            for name in picked:
                if name in local_mcp:
                    continue
                raw = shared_mcp[name]
                if isinstance(raw, dict):
                    local_mcp[name] = MCPServerConfig.model_validate(cast(dict[str, Any], raw))
                    inherited_mcp_names.add(name)
        except Exception as exc:  # defensive: never break startup
            warnings.append(f"shared instance {item_id!r}: mcp merge failed: {exc}")

        # --- agent profiles: merge by id, user wins ---
        try:
            agents_section = _as_dict(data.get("agents"))
            shared_agents = _as_list(agents_section.get("profiles"))
            available_ids: list[str] = []
            for entry in shared_agents:
                if not isinstance(entry, dict):
                    continue
                entry_obj = cast(dict[str, Any], entry)
                entry_id = entry_obj.get("id")
                if isinstance(entry_id, str) and entry_id:
                    available_ids.append(entry_id)
            picked_ids = set(_select_names(available_ids, want_agents))
            local_ids = {p.id for p in config.agents.profiles}
            for entry in shared_agents:
                if not isinstance(entry, dict):
                    continue
                entry_obj = cast(dict[str, Any], entry)
                entry_id = entry_obj.get("id")
                if not isinstance(entry_id, str) or entry_id not in picked_ids:
                    continue
                if entry_id in local_ids:
                    continue
                config.agents.profiles.append(AgentProfileConfig.model_validate(entry_obj))
                local_ids.add(entry_id)
                inherited_agent_ids.add(entry_id)
        except Exception as exc:
            warnings.append(f"shared instance {item_id!r}: agents merge failed: {exc}")

    config._shared_skills_dirs = shared_dirs  # pyright: ignore[reportPrivateUsage]
    config._shared_skill_names = None if shared_names_all else shared_names  # pyright: ignore[reportPrivateUsage]
    config._shared_agent_ids = inherited_agent_ids  # pyright: ignore[reportPrivateUsage]
    config._shared_mcp_names = inherited_mcp_names  # pyright: ignore[reportPrivateUsage]
    config._shared_warnings = warnings  # pyright: ignore[reportPrivateUsage]
    for message in warnings:
        logger.warning("sharedInstances: {}", message)


def shared_skills_dirs(config: Config) -> list[Path]:
    """Return resolved shared skills dirs (empty when none)."""
    dirs = config._shared_skills_dirs  # pyright: ignore[reportPrivateUsage]
    return list(dirs)


def shared_skill_names(config: Config) -> set[str] | None:
    """Return selected shared skill names (None = inherit all)."""
    return (
        set(config._shared_skill_names)  # pyright: ignore[reportPrivateUsage]
        if config._shared_skill_names is not None  # pyright: ignore[reportPrivateUsage]
        else None
    )


def shared_payload(config: Config) -> dict[str, Any]:
    """Return WebUI-safe shared-instance listing (no local paths)."""
    items: list[dict[str, Any]] = []
    for item in list(config.shared_instances or []):
        items.append({
            "id": item.id,
            "name": item.name or item.id,
            "description": item.description or "",
            "baseUrl": item.base_url or "",
            "hasBaseUrl": bool((item.base_url or "").strip()),
            "inherit": {
                "skills": list(item.inherit.skills or []),
                "mcp": list(item.inherit.mcp or []),
                "agents": list(item.inherit.agents or []),
            },
        })
    return {"instances": items, "warnings": list(config._shared_warnings)}  # pyright: ignore[reportPrivateUsage]
