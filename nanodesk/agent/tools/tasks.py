"""Structured task-list tools for natural multi-step execution."""

# pyright: reportIncompatibleMethodOverride=false

from __future__ import annotations

import json
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any, cast

from nanodesk.agent.tools.base import Tool, ToolResult, tool_parameters
from nanodesk.agent.tools.context import RequestContext, ToolContext, current_request_context
from nanodesk.agent.tools.schema import (
    ArraySchema,
    IntegerSchema,
    ObjectSchema,
    StringSchema,
    tool_parameters_schema,
)
from nanodesk.bus.runtime_events import RuntimeEventBus, RuntimeEventContext, TaskStateChanged
from nanodesk.runtime_context import RuntimeContextBlock, wrap_runtime_context_lines
from nanodesk.session.manager import SessionManager
from nanodesk.session.task_state import (
    MAX_OBJECTIVE_CHARS,
    MAX_TASK_NOTE_CHARS,
    MAX_TASK_TITLE_CHARS,
    MAX_TASKS,
    TASK_STATE_KEY,
    TASK_STATUSES,
    derive_task_list_status,
    parse_task_state,
    task_state_raw,
    task_state_runtime_lines,
)
from nanodesk.utils.prompt_templates import render_template


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class _TaskToolsMixin:
    def __init__(
        self,
        sessions: SessionManager,
        runtime_events: RuntimeEventBus | None = None,
    ) -> None:
        self._sessions = sessions
        self._runtime_events = runtime_events

    def _session(self):
        request = current_request_context()
        if request is None or not request.session_key:
            return None
        return self._sessions.get_or_create(request.session_key)

    def _task_rows(self, state: dict[str, Any]) -> list[dict[str, Any]]:
        tasks = state.get("tasks")
        return cast(list[dict[str, Any]], tasks) if isinstance(tasks, list) else []

    def _snapshot(self, state: dict[str, Any], *, title_chars: int = 80) -> str:
        """Compact in-memory snapshot so same-turn iterations see fresh state.

        Runtime Context is resolved once per turn, so later iterations in the
        same turn would otherwise keep seeing the stale pre-creation list.
        """
        tasks = self._task_rows(state)
        lines = [
            f"Current task list (revision {state.get('revision', 1)}, "
            f"status {state.get('status', 'active')}):"
        ]
        for task in tasks[:MAX_TASKS]:
            title = str(task.get("title") or "").strip()[:title_chars]
            lines.append(f"- [{task.get('status') or 'pending'}] {task.get('id')}: {title}")
        return "\n".join(lines)

    def _save(self, session: Any, state: dict[str, Any]) -> None:
        previous = deepcopy(session.metadata)
        session.metadata[TASK_STATE_KEY] = state
        try:
            self._sessions.save(session)
        except BaseException:
            session.metadata.clear()
            session.metadata.update(previous)
            raise

    async def _publish(self, metadata: dict[str, Any]) -> None:
        request = current_request_context()
        if self._runtime_events is None or request is None or not request.chat_id:
            return
        await self._runtime_events.publish(
            TaskStateChanged(
                context=RuntimeEventContext(
                    channel=request.channel,
                    chat_id=request.chat_id,
                    session_key=request.session_key or f"{request.channel}:{request.chat_id}",
                    metadata=dict(request.metadata),
                ),
                session_metadata=dict(metadata),
            )
        )


_TASK_ITEM_SCHEMA = ObjectSchema(
    properties={"title": StringSchema(
        "One concrete, outcome-oriented task title. Must be verifiable work, not narration "
        "such as 'understand request' or 'reply to user'.",
        min_length=1,
        max_length=MAX_TASK_TITLE_CHARS,
    )},
    required=["title"],
    additional_properties=False,
)


@tool_parameters(
    tool_parameters_schema(
        objective=StringSchema(
            "The user-visible objective this task list executes.",
            min_length=1,
            max_length=MAX_OBJECTIVE_CHARS,
        ),
        tasks=ArraySchema(
            items=_TASK_ITEM_SCHEMA,
            description="Ordered material tasks. Use 3-20 tasks, each a verifiable outcome step; "
            "do not include trivial narration.",
            min_items=3,
            max_items=MAX_TASKS,
        ),
        required=["objective", "tasks"],
    )
)
class CreateTaskListTool(Tool, _TaskToolsMixin):
    """Create one structured task list for genuinely multi-step work."""

    def __init__(
        self,
        sessions: SessionManager,
        runtime_events: RuntimeEventBus | None = None,
    ) -> None:
        _TaskToolsMixin.__init__(self, sessions, runtime_events)

    @classmethod
    def create(cls, ctx: ToolContext) -> Tool:
        if ctx.sessions is None:
            raise RuntimeError("CreateTaskListTool requires an initialized session manager")
        return cls(ctx.sessions, ctx.runtime_events)

    @classmethod
    def enabled(cls, ctx: ToolContext) -> bool:
        return ctx.sessions is not None

    @property
    def name(self) -> str:
        return "create_task_list"

    @property
    def description(self) -> str:
        return (
            "Create a persistent task list only when the user's request needs 3 or more material "
            "steps (tool calls, file changes, research, implementation, verification). This is "
            "execution state, not a plan-only response: after creating it, immediately start the "
            "first task and keep statuses current with update_task. NEVER use for simple questions, "
            "single-file reads/edits, single commands, or anything finishable in 1-2 tool calls — "
            "just do that work directly without task tools."
        )

    def runtime_context_provider(self):
        return self._provide_runtime_context

    async def _provide_runtime_context(
        self,
        request: RequestContext,
    ) -> RuntimeContextBlock | None:
        if not request.session_key:
            return None
        session = self._sessions.get_or_create(request.session_key)
        lines = task_state_runtime_lines(session.metadata)
        guidance = render_template("agent/task_runtime.md", strip=True)
        state = wrap_runtime_context_lines(lines) if lines else ""
        content = "\n\n".join(part for part in (guidance, state) if part)
        if not content:
            return None
        return RuntimeContextBlock(source="task_list", content=content)

    async def execute(
        self,
        objective: str,
        tasks: list[dict[str, Any]],
        **kwargs: Any,
    ) -> str:
        session = self._session()
        if session is None:
            return ToolResult.error("Error: create_task_list requires an active chat session.")
        prior = parse_task_state(task_state_raw(session.metadata))
        if prior is not None and prior.get("status") in {"active", "blocked"}:
            return ToolResult.error(
                "Error: an active task list already exists. Update its tasks instead of creating "
                "a second list."
            )
        objective_text = objective.strip()[:MAX_OBJECTIVE_CHARS].strip()
        if not objective_text:
            return ToolResult.error("Error: objective must not be empty.")
        titles = [str(item.get("title") or "").strip() for item in tasks]
        titles = [title[:MAX_TASK_TITLE_CHARS].strip() for title in titles]
        titles = [title for title in titles if title][:MAX_TASKS]
        if not titles:
            return ToolResult.error("Error: at least one non-empty task title is required.")
        if len(titles) < 3:
            return ToolResult.error(
                "Error: a task list needs at least 3 material tasks. This looks like small work — "
                "execute it directly without task tools instead of creating a list."
            )
        now = _now()
        rows = [
            {
                "id": f"task-{index}",
                "title": title,
                "status": "pending",
                "created_at": now,
                "updated_at": now,
            }
            for index, title in enumerate(titles, start=1)
        ]
        state: dict[str, Any] = {
            "status": "active",
            "objective": objective_text,
            "revision": 1,
            "created_at": now,
            "updated_at": now,
            "tasks": rows,
        }
        self._save(session, state)
        await self._publish(session.metadata)
        ids = [{"id": row["id"], "title": row["title"]} for row in rows]
        return (
            "Task list created. Start the first task now; do not stop merely to present the list. "
            "Call update_task when a task starts and when its status changes.\n"
            + json.dumps(ids, ensure_ascii=False)
            + "\n"
            + self._snapshot(state)
        )


@tool_parameters(
    tool_parameters_schema(
        task_id=StringSchema("Stable task id returned by create_task_list.", min_length=1, max_length=80),
        status=StringSchema("New authoritative task status.", enum=sorted(TASK_STATUSES)),
        note=StringSchema(
            "Optional concise reason or progress note, including when the user changed the task.",
            max_length=MAX_TASK_NOTE_CHARS,
            nullable=True,
        ),
        evidence=StringSchema(
            "Optional completion evidence. User-provided evidence must be identified as such.",
            max_length=MAX_TASK_NOTE_CHARS,
            nullable=True,
        ),
        revision=IntegerSchema(
            description=(
                "Optional optimistic-concurrency guard: the revision last seen by the caller. "
                "When provided and stale, the update is rejected so it cannot overwrite "
                "newer state (e.g. after a user interruption)."
            ),
            minimum=1,
            nullable=True,
        ),
        required=["task_id", "status"],
    )
)
class UpdateTaskTool(Tool, _TaskToolsMixin):
    """Update one task after work or user guidance changes its state."""

    def __init__(
        self,
        sessions: SessionManager,
        runtime_events: RuntimeEventBus | None = None,
    ) -> None:
        _TaskToolsMixin.__init__(self, sessions, runtime_events)

    @classmethod
    def create(cls, ctx: ToolContext) -> Tool:
        if ctx.sessions is None:
            raise RuntimeError("UpdateTaskTool requires an initialized session manager")
        return cls(ctx.sessions, ctx.runtime_events)

    @classmethod
    def enabled(cls, ctx: ToolContext) -> bool:
        return ctx.sessions is not None

    @property
    def name(self) -> str:
        return "update_task"

    @property
    def description(self) -> str:
        return (
            "Update one task in the active task list. Use this when work starts, completes, fails, "
            "or becomes blocked, and when the user says they completed or no longer need a task. "
            "Match user messages to task ids carefully; ask for clarification instead of guessing."
        )

    async def execute(
        self,
        task_id: str,
        status: str,
        note: str | None = None,
        evidence: str | None = None,
        revision: int | None = None,
        **kwargs: Any,
    ) -> str:
        session = self._session()
        if session is None:
            return ToolResult.error("Error: update_task requires an active chat session.")
        state = parse_task_state(task_state_raw(session.metadata))
        if state is None or state.get("status") not in {"active", "blocked"}:
            return ToolResult.error("Error: there is no active task list to update.")
        if revision is not None and int(state.get("revision") or 0) != revision:
            return ToolResult.error(
                f"Error: stale revision {revision}; current revision is "
                f"{state.get('revision')}. Re-read the current task list from "
                "Runtime Context and retry with the fresh revision.\n"
                + self._snapshot(state)
            )
        tasks = self._task_rows(state)
        target = next(
            (item for item in tasks if str(item.get("id") or "") == task_id),
            None,
        )
        if target is None:
            available = [str(item.get("id") or "") for item in tasks]
            return ToolResult.error(
                f"Error: task id {task_id!r} not found. Available ids: {', '.join(available)}"
            )
        now = _now()
        target["status"] = status
        target["updated_at"] = now
        note_text = (note or "").strip()
        evidence_text = (evidence or "").strip()
        if note_text:
            target["note"] = note_text
        else:
            target.pop("note", None)
        if evidence_text:
            target["evidence"] = evidence_text
        else:
            target.pop("evidence", None)
        state["revision"] = int(state.get("revision") or 0) + 1
        state["updated_at"] = now
        state["status"] = derive_task_list_status(tasks)
        self._save(session, state)
        await self._publish(session.metadata)
        return (
            f"Task {task_id} marked {status}. Task list revision is {state['revision']} "
            f"and overall status is {state['status']}.\n"
            + self._snapshot(state)
        )


@tool_parameters(
    tool_parameters_schema(
        revision=IntegerSchema(
            description=(
                "Optimistic-concurrency guard: the revision last seen by the caller. "
                "Rejected when stale so an old plan cannot overwrite newer state."
            ),
            minimum=1,
        ),
        tasks=ArraySchema(
            items=_TASK_ITEM_SCHEMA,
            description="Replacement unfinished tasks. Use 1-20 tasks.",
            min_items=1,
            max_items=MAX_TASKS,
        ),
        reason=StringSchema(
            "Why the plan changed (e.g. user guidance, new findings).",
            max_length=MAX_TASK_NOTE_CHARS,
            nullable=True,
        ),
        objective=StringSchema(
            "Optional replacement objective when the requested outcome itself changed.",
            max_length=MAX_OBJECTIVE_CHARS,
            nullable=True,
        ),
        required=["revision", "tasks"],
    )
)
class ReplaceTasksTool(Tool, _TaskToolsMixin):
    """Replace the unfinished tail of the active task list when the goal shifts."""

    def __init__(
        self,
        sessions: SessionManager,
        runtime_events: RuntimeEventBus | None = None,
    ) -> None:
        _TaskToolsMixin.__init__(self, sessions, runtime_events)

    @classmethod
    def create(cls, ctx: ToolContext) -> Tool:
        if ctx.sessions is None:
            raise RuntimeError("ReplaceTasksTool requires an initialized session manager")
        return cls(ctx.sessions, ctx.runtime_events)

    @classmethod
    def enabled(cls, ctx: ToolContext) -> bool:
        return ctx.sessions is not None

    @property
    def name(self) -> str:
        return "replace_tasks"

    @property
    def description(self) -> str:
        return (
            "Replace unfinished tasks when the objective changes or the prior plan is wrong. "
            "Finished tasks (completed/cancelled) are preserved with their evidence; only "
            "pending/running/blocked/failed tasks are replaced. Pass the current revision; "
            "stale revisions are rejected. Never use this to create a second list."
        )

    async def execute(
        self,
        revision: int,
        tasks: list[dict[str, Any]],
        reason: str | None = None,
        objective: str | None = None,
        **kwargs: Any,
    ) -> str:
        session = self._session()
        if session is None:
            return ToolResult.error("Error: replace_tasks requires an active chat session.")
        state = parse_task_state(task_state_raw(session.metadata))
        if state is None or state.get("status") not in {"active", "blocked"}:
            return ToolResult.error("Error: there is no active task list to replace.")
        if int(state.get("revision") or 0) != revision:
            return ToolResult.error(
                f"Error: stale revision {revision}; current revision is "
                f"{state.get('revision')}. Re-read the current task list from "
                "Runtime Context and retry with the fresh revision.\n"
                + self._snapshot(state)
            )
        titles = [str(item.get("title") or "").strip() for item in tasks]
        titles = [title[:MAX_TASK_TITLE_CHARS].strip() for title in titles]
        titles = [title for title in titles if title][:MAX_TASKS]
        if not titles:
            return ToolResult.error("Error: at least one non-empty task title is required.")
        if objective is not None:
            objective_text = objective.strip()[:MAX_OBJECTIVE_CHARS].strip()
            if not objective_text:
                return ToolResult.error("Error: replacement objective must not be empty.")
            state["objective"] = objective_text
        now = _now()
        kept = [
            task for task in self._task_rows(state)
            if str(task.get("status") or "") in {"completed", "cancelled"}
        ]
        # Fresh ids continue the counter so reused ids never point at new work.
        max_n = 0
        for task_id in (str(task.get("id") or "") for task in self._task_rows(state)):
            if task_id.startswith("task-"):
                try:
                    max_n = max(max_n, int(task_id.split("-", 1)[1]))
                except ValueError:
                    continue
        new_rows = [
            {
                "id": f"task-{max_n + index}",
                "title": title,
                "status": "pending",
                "created_at": now,
                "updated_at": now,
            }
            for index, title in enumerate(titles, start=1)
        ]
        state["tasks"] = [*kept, *new_rows]
        reason_text = (reason or "").strip()[:MAX_TASK_NOTE_CHARS]
        if reason_text:
            state["replace_reason"] = reason_text
        else:
            state.pop("replace_reason", None)
        state["revision"] = int(state.get("revision") or 0) + 1
        state["updated_at"] = now
        state["status"] = derive_task_list_status(self._task_rows(state))
        self._save(session, state)
        await self._publish(session.metadata)
        return (
            f"Task list replaced at revision {state['revision']} "
            f"(overall status {state['status']}).\n"
            + self._snapshot(state)
        )


@tool_parameters(
    tool_parameters_schema(
        summary=StringSchema(
            "Short honest summary of what was achieved or why the list is closing.",
            min_length=1,
            max_length=MAX_TASK_NOTE_CHARS,
        ),
        revision=IntegerSchema(
            description=(
                "Optional optimistic-concurrency guard: the revision last seen by the caller."
            ),
            minimum=1,
            nullable=True,
        ),
        required=["summary"],
    )
)
class FinishTaskListTool(Tool, _TaskToolsMixin):
    """Archive the active task list when no further work is needed."""

    def __init__(
        self,
        sessions: SessionManager,
        runtime_events: RuntimeEventBus | None = None,
    ) -> None:
        _TaskToolsMixin.__init__(self, sessions, runtime_events)

    @classmethod
    def create(cls, ctx: ToolContext) -> Tool:
        if ctx.sessions is None:
            raise RuntimeError("FinishTaskListTool requires an initialized session manager")
        return cls(ctx.sessions, ctx.runtime_events)

    @classmethod
    def enabled(cls, ctx: ToolContext) -> bool:
        return ctx.sessions is not None

    @property
    def name(self) -> str:
        return "finish_task_list"

    @property
    def description(self) -> str:
        return (
            "Archive the active task list when all necessary work is done and verified, "
            "or when nothing remaining is worth doing. Unstarted tasks are marked cancelled; "
            "finished work keeps its evidence. After this the list is no longer active."
        )

    async def execute(
        self,
        summary: str,
        revision: int | None = None,
        **kwargs: Any,
    ) -> str:
        session = self._session()
        if session is None:
            return ToolResult.error("Error: finish_task_list requires an active chat session.")
        state = parse_task_state(task_state_raw(session.metadata))
        if state is None or state.get("status") not in {"active", "blocked"}:
            return ToolResult.error("Error: there is no active task list to finish.")
        if revision is not None and int(state.get("revision") or 0) != revision:
            return ToolResult.error(
                f"Error: stale revision {revision}; current revision is "
                f"{state.get('revision')}. Re-read the current task list from "
                "Runtime Context and retry with the fresh revision.\n"
                + self._snapshot(state)
            )
        summary_text = summary.strip()[:MAX_TASK_NOTE_CHARS].strip()
        if not summary_text:
            return ToolResult.error("Error: summary must not be empty.")
        now = _now()
        for task in self._task_rows(state):
            if str(task.get("status") or "") in {"pending", "running"}:
                task["status"] = "cancelled"
                task["updated_at"] = now
                task["note"] = f"Closed by finish_task_list: {summary_text[:200]}"
        state["status"] = "completed"
        state["summary"] = summary_text
        state["revision"] = int(state.get("revision") or 0) + 1
        state["updated_at"] = now
        self._save(session, state)
        await self._publish(session.metadata)
        return (
            f"Task list finished at revision {state['revision']}. {summary_text}\n"
            + self._snapshot(state)
        )
