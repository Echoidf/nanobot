"""Durable structured task-list state stored in session metadata."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, cast

TASK_STATE_KEY = "task_state"
TASK_STATUSES = frozenset({
    "pending",
    "running",
    "completed",
    "cancelled",
    "blocked",
    "failed",
})
TERMINAL_TASK_STATUSES = frozenset({"completed", "cancelled"})
MAX_TASKS = 20
MAX_OBJECTIVE_CHARS = 2000
MAX_TASK_TITLE_CHARS = 300
MAX_TASK_NOTE_CHARS = 2000


def task_state_raw(metadata: Mapping[str, Any] | None) -> Any:
    return metadata.get(TASK_STATE_KEY) if metadata else None


def parse_task_state(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    state = cast(dict[str, Any], value)
    if not isinstance(state.get("tasks"), list):
        return None
    return state


def _task_rows(state: dict[str, Any]) -> list[dict[str, Any]]:
    tasks = state.get("tasks")
    if not isinstance(tasks, list):
        return []
    return cast(list[dict[str, Any]], tasks)


def task_list_active(metadata: Mapping[str, Any] | None) -> bool:
    state = parse_task_state(task_state_raw(metadata))
    if state is None or state.get("status") != "active":
        return False
    return any(task.get("status") in {"pending", "running"} for task in _task_rows(state))


def derive_task_list_status(tasks: list[dict[str, Any]]) -> str:
    statuses = {str(task.get("status") or "pending") for task in tasks}
    if statuses & {"pending", "running"}:
        return "active"
    if statuses & {"blocked", "failed"}:
        return "blocked"
    return "completed"


def task_state_runtime_lines(metadata: Mapping[str, Any] | None) -> list[str]:
    state = parse_task_state(task_state_raw(metadata))
    if state is None or state.get("status") not in {"active", "blocked"}:
        return []
    objective = str(state.get("objective") or "").strip()
    lines = ["Task list (host-managed):"]
    if objective:
        lines.append(f"Objective: {objective[:MAX_OBJECTIVE_CHARS]}")
    lines.append(f"Revision: {state.get('revision', 1)}")
    for task in _task_rows(state)[:MAX_TASKS]:
        task_id = str(task.get("id") or "?")
        status = str(task.get("status") or "pending")
        title = str(task.get("title") or "").strip()[:MAX_TASK_TITLE_CHARS]
        note = str(task.get("note") or "").strip()[:MAX_TASK_NOTE_CHARS]
        suffix = f" — {note}" if note else ""
        lines.append(f"- [{status}] {task_id}: {title}{suffix}")
    lines.append(
        "Use create_task_list only for work with 3 or more material steps. Smaller work "
        "(simple questions, single-file edits, single commands, 1-2 tool calls) must run "
        "directly without task tools. Use update_task before and "
        "after material steps so this list stays authoritative. User messages override the prior "
        "plan: reflect their updates with tools, and ask when a task match is ambiguous."
    )
    return lines


def task_state_ws_blob(metadata: Mapping[str, Any] | None) -> dict[str, Any]:
    state = parse_task_state(task_state_raw(metadata))
    if state is None:
        return {"active": False}
    tasks: list[dict[str, Any]] = []
    for task in _task_rows(state)[:MAX_TASKS]:
        status = str(task.get("status") or "pending")
        if status not in TASK_STATUSES:
            status = "pending"
        item: dict[str, Any] = {
            "id": str(task.get("id") or "")[:80],
            "title": str(task.get("title") or "")[:MAX_TASK_TITLE_CHARS],
            "status": status,
        }
        for key, limit in (("note", MAX_TASK_NOTE_CHARS), ("evidence", MAX_TASK_NOTE_CHARS)):
            value = str(task.get(key) or "").strip()
            if value:
                item[key] = value[:limit]
        tasks.append(item)
    status = str(state.get("status") or derive_task_list_status(tasks))
    return {
        "active": status == "active",
        "status": status,
        "objective": str(state.get("objective") or "")[:MAX_OBJECTIVE_CHARS],
        "revision": max(1, int(state.get("revision") or 1)),
        "updated_at": str(state.get("updated_at") or ""),
        "tasks": tasks,
    }
