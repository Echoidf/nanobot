"""Tests for the natural task-list tools (``create_task_list``, ``update_task``)."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from nanodesk.agent.loop import AgentLoop
from nanodesk.agent.tools.context import RequestContext, request_context
from nanodesk.agent.tools.registry import ToolRegistry
from nanodesk.agent.tools.tasks import CreateTaskListTool, UpdateTaskTool
from nanodesk.bus.outbound_events import TaskStateSyncEvent
from nanodesk.bus.queue import MessageBus
from nanodesk.bus.runtime_events import RuntimeEventBus
from nanodesk.session.manager import SessionManager
from nanodesk.session.task_state import (
    MAX_TASK_TITLE_CHARS,
    TASK_STATE_KEY,
    task_list_active,
    task_state_ws_blob,
)
from nanodesk.session.webui_turns import WebuiTurnCoordinator


def _request_context(
    *,
    chat_id: str = "c1",
    channel: str = "websocket",
) -> RequestContext:
    return RequestContext(
        channel=channel,
        chat_id=chat_id,
        session_key=f"{channel}:{chat_id}",
        original_user_text=None,
    )


def _tools(sm: SessionManager, runtime_events: RuntimeEventBus | None = None):
    return (
        CreateTaskListTool(sessions=sm, runtime_events=runtime_events),
        UpdateTaskTool(sessions=sm, runtime_events=runtime_events),
    )


async def _execute(tool, ctx: RequestContext, **kwargs):
    with request_context(ctx):
        return await tool.execute(**kwargs)


def _sample_tasks() -> list[dict[str, object]]:
    return [
        {"title": "Reproduce the failing test"},
        {"title": "Patch the validation step"},
        {"title": "Re-run the suite"},
    ]


@pytest.mark.asyncio
async def test_create_task_list_persists_metadata_and_ids(tmp_path):
    sm = SessionManager(tmp_path)
    create, _update = _tools(sm)
    ctx = _request_context()

    out = await _execute(
        create,
        ctx,
        objective="Fix the flaky validation suite",
        tasks=_sample_tasks(),
    )

    assert "Task list created" in out
    sess = sm.get_or_create("websocket:c1")
    blob = sess.metadata[TASK_STATE_KEY]
    assert blob["status"] == "active"
    assert blob["objective"] == "Fix the flaky validation suite"
    assert blob["revision"] == 1
    assert [task["id"] for task in blob["tasks"]] == ["task-1", "task-2", "task-3"]
    assert all(task["status"] == "pending" for task in blob["tasks"])
    assert task_list_active(sess.metadata)


@pytest.mark.asyncio
async def test_create_task_list_is_replayed_from_disk(tmp_path):
    sm = SessionManager(tmp_path)
    create, _update = _tools(sm)
    await _execute(
        create,
        _request_context(),
        objective="Objective on disk",
        tasks=_sample_tasks(),
    )

    restored = SessionManager(tmp_path).get_or_create("websocket:c1")
    blob = restored.metadata[TASK_STATE_KEY]
    assert blob["objective"] == "Objective on disk"
    assert [task["id"] for task in blob["tasks"]] == ["task-1", "task-2", "task-3"]


@pytest.mark.asyncio
async def test_create_task_list_refuses_second_active_list(tmp_path):
    sm = SessionManager(tmp_path)
    create, _update = _tools(sm)
    await _execute(create, _request_context(), objective="First", tasks=_sample_tasks())

    out = await _execute(
        create,
        _request_context(),
        objective="Second",
        tasks=[{"title": "Other"}],
    )

    assert "already exists" in out
    sess = sm.get_or_create("websocket:c1")
    assert sess.metadata[TASK_STATE_KEY]["objective"] == "First"


@pytest.mark.asyncio
async def test_update_task_marks_completed_with_user_evidence(tmp_path):
    """The manual-completion flow: user reports work done, model records evidence."""
    sm = SessionManager(tmp_path)
    create, update = _tools(sm)
    await _execute(create, _request_context(), objective="Suite green", tasks=_sample_tasks())

    out = await _execute(
        update,
        _request_context(),
        task_id="task-3",
        status="completed",
        note="由用户手动完成",
        evidence="由用户手动完成 · 全部通过",
    )

    assert "task-3 marked completed" in out
    sess = sm.get_or_create("websocket:c1")
    task = next(item for item in sess.metadata[TASK_STATE_KEY]["tasks"] if item["id"] == "task-3")
    assert task["status"] == "completed"
    assert task["note"] == "由用户手动完成"
    assert task["evidence"] == "由用户手动完成 · 全部通过"
    assert sess.metadata[TASK_STATE_KEY]["revision"] == 2
    assert task_list_active(sess.metadata)


@pytest.mark.asyncio
async def test_update_task_lists_available_ids_when_missing(tmp_path):
    sm = SessionManager(tmp_path)
    create, update = _tools(sm)
    await _execute(create, _request_context(), objective="O", tasks=_sample_tasks())

    out = await _execute(update, _request_context(), task_id="task-42", status="completed")

    assert "not found" in out
    assert "task-1, task-2, task-3" in out
    sess = sm.get_or_create("websocket:c1")
    assert all(task["status"] == "pending" for task in sess.metadata[TASK_STATE_KEY]["tasks"])


@pytest.mark.asyncio
async def test_update_task_without_active_list_is_error(tmp_path):
    sm = SessionManager(tmp_path)
    _create, update = _tools(sm)

    out = await _execute(update, _request_context(), task_id="task-1", status="completed")

    assert "no active task list" in out


@pytest.mark.asyncio
async def test_finishing_all_tasks_derives_completed_status(tmp_path):
    sm = SessionManager(tmp_path)
    create, update = _tools(sm)
    await _execute(create, _request_context(), objective="O", tasks=_sample_tasks())
    for index in ("task-1", "task-2", "task-3"):
        await _execute(update, _request_context(), task_id=index, status="completed")

    sess = sm.get_or_create("websocket:c1")
    blob = sess.metadata[TASK_STATE_KEY]
    assert blob["status"] == "completed"
    assert task_list_active(sess.metadata) is False
    assert blob["revision"] == 4


@pytest.mark.asyncio
async def test_update_task_rolls_back_metadata_on_save_failure(tmp_path):
    sm = SessionManager(tmp_path)
    create, update = _tools(sm)
    await _execute(create, _request_context(), objective="O", tasks=_sample_tasks())
    sess = sm.get_or_create("websocket:c1")
    original = sess.metadata[TASK_STATE_KEY]
    sm.save = MagicMock(side_effect=RuntimeError("disk on fire"))

    with pytest.raises(RuntimeError, match="disk on fire"):
        await _execute(update, _request_context(), task_id="task-1", status="running")

    assert sess.metadata[TASK_STATE_KEY] == original


@pytest.mark.asyncio
async def test_task_tools_keep_request_context_per_chat(tmp_path):
    sm = SessionManager(tmp_path)
    create, update = _tools(sm)
    ctx_a = _request_context(chat_id="a")
    ctx_b = _request_context(chat_id="b")

    await asyncio.gather(
        _execute(create, ctx_a, objective="Objective A", tasks=_sample_tasks()),
        _execute(create, ctx_b, objective="Objective B", tasks=_sample_tasks()),
    )

    assert sm.get_or_create("websocket:a").metadata[TASK_STATE_KEY]["objective"] == "Objective A"
    assert sm.get_or_create("websocket:b").metadata[TASK_STATE_KEY]["objective"] == "Objective B"

    await asyncio.gather(
        _execute(update, ctx_a, task_id="task-1", status="completed"),
        _execute(update, ctx_b, task_id="task-2", status="cancelled"),
    )

    a_tasks = {t["id"]: t["status"] for t in sm.get_or_create("websocket:a").metadata[TASK_STATE_KEY]["tasks"]}
    b_tasks = {t["id"]: t["status"] for t in sm.get_or_create("websocket:b").metadata[TASK_STATE_KEY]["tasks"]}
    assert a_tasks["task-1"] == "completed"
    assert b_tasks["task-2"] == "cancelled"
    assert a_tasks["task-2"] == "pending"
    assert b_tasks["task-1"] == "pending"


@pytest.mark.asyncio
async def test_task_state_events_publish_sync_blob(tmp_path):
    bus = MagicMock()
    bus.publish_outbound = AsyncMock()
    runtime_events = RuntimeEventBus()
    sm = SessionManager(tmp_path)
    WebuiTurnCoordinator(
        bus=bus,
        sessions=sm,
        schedule_background=lambda _coro: None,
    ).subscribe(runtime_events)
    create, update = _tools(sm, runtime_events)
    await _execute(
        create,
        _request_context(chat_id="chat-99"),
        objective="Objective alpha",
        tasks=_sample_tasks(),
    )

    bus.publish_outbound.assert_awaited_once()
    call = bus.publish_outbound.await_args.args[0]
    assert call.chat_id == "chat-99"
    assert isinstance(call.event, TaskStateSyncEvent)
    blob = call.event.task_state
    assert blob["active"] is True
    assert blob["status"] == "active"
    assert blob["objective"] == "Objective alpha"
    assert [task["id"] for task in blob["tasks"]] == ["task-1", "task-2", "task-3"]

    bus.publish_outbound.reset_mock()
    await _execute(
        update,
        _request_context(chat_id="chat-99"),
        task_id="task-1",
        status="completed",
        evidence="tests green",
    )

    call = bus.publish_outbound.await_args.args[0]
    assert isinstance(call.event, TaskStateSyncEvent)
    assert call.event.task_state["revision"] == 2
    assert next(t for t in call.event.task_state["tasks"] if t["id"] == "task-1")["evidence"] == "tests green"


@pytest.mark.asyncio
async def test_task_state_ws_blob_is_allowlisted_and_truncated(tmp_path):
    sm = SessionManager(tmp_path)
    create, _update = _tools(sm)
    await _execute(
        create,
        _request_context(),
        objective="O",
        tasks=[{"title": "T" * (MAX_TASK_TITLE_CHARS * 2)}, {"title": "B"}, {"title": "C"}],
    )
    sess = sm.get_or_create("websocket:c1")
    sess.metadata[TASK_STATE_KEY]["objective"] = "x" * 5000
    sess.metadata["secret_field"] = "must-not-leak"
    sm.save(sess)

    blob = task_state_ws_blob(sess.metadata)

    assert "secret_field" not in blob
    assert len(blob["objective"]) == 2000
    assert len(blob["tasks"][0]["title"]) == MAX_TASK_TITLE_CHARS
    for task in blob["tasks"]:
        assert set(task) <= {"id", "title", "status", "note", "evidence"}


@pytest.mark.asyncio
async def test_task_tools_registered_in_base_registry(tmp_path):
    bus = MessageBus()
    provider = MagicMock()
    provider.get_default_model.return_value = "test-model"
    loop = AgentLoop(bus=bus, provider=provider, workspace=tmp_path, model="test-model")

    create = loop.tools.get("create_task_list")
    update = loop.tools.get("update_task")
    replace = loop.tools.get("replace_tasks")
    finish = loop.tools.get("finish_task_list")
    assert create is not None and create.name == "create_task_list"
    assert update is not None and update.name == "update_task"
    assert replace is not None and replace.name == "replace_tasks"
    assert finish is not None and finish.name == "finish_task_list"
    assert set(create.parameters["properties"]) == {"objective", "tasks"}
    assert create.parameters["required"] == ["objective", "tasks"]
    assert create.parameters["properties"]["tasks"]["minItems"] == 3
    assert set(update.parameters["properties"]) == {"task_id", "status", "note", "evidence", "revision"}
    assert update.parameters["required"] == ["task_id", "status"]
    assert set(replace.parameters["properties"]) == {"revision", "tasks", "reason", "objective"}
    assert replace.parameters["required"] == ["revision", "tasks"]
    assert set(finish.parameters["properties"]) == {"summary", "revision"}
    assert finish.parameters["required"] == ["summary"]

    contract = " ".join((create.description, update.description)).lower()
    # The task list must emerge from ordinary tool use; no slash-command gating.
    assert "/goal" not in contract
    assert "authoriz" not in contract


@pytest.mark.asyncio
async def test_registry_executes_task_tools_and_reports_bad_ids(tmp_path):
    sm = SessionManager(tmp_path)
    create, update = _tools(sm)
    registry = ToolRegistry()
    registry.register(create)
    registry.register(update)
    ctx = _request_context()

    with request_context(ctx):
        created = await registry.execute(
            "create_task_list",
            {"objective": "O", "tasks": [{"title": "A"}, {"title": "B"}, {"title": "C"}]},
        )
        missing = await registry.execute(
            "update_task",
            {"task_id": "nope", "status": "completed"},
        )
        ok = await registry.execute("update_task", {"task_id": "task-1", "status": "running"})

    assert "Task list created" in str(created)
    assert "not found" in str(missing)
    assert "task-1 marked running" in str(ok)


@pytest.mark.asyncio
async def test_first_turn_runtime_context_contains_guidance_without_state(tmp_path):
    """Regression:首轮无 task_state 时也必须注入任务指导，否则 LLM 只会输出 Markdown."""
    sm = SessionManager(tmp_path)
    create, _update = _tools(sm)
    provider = create.runtime_context_provider()
    assert provider is not None
    ctx = _request_context()
    with request_context(ctx):
        block = await provider(ctx)
    assert block is not None
    assert "create_task_list" in block.content


@pytest.mark.asyncio
async def test_create_task_list_rejects_empty_titles_and_truncates(tmp_path):
    sm = SessionManager(tmp_path)
    create, _update = _tools(sm)
    out = await _execute(
        create, _request_context(), objective="O", tasks=[{"title": "  "}, {"title": ""}]
    )
    assert "non-empty task title" in out
    sess = sm.get_or_create("websocket:c1")
    assert TASK_STATE_KEY not in sess.metadata

    out = await _execute(
        create,
        _request_context(),
        objective="O",
        tasks=[{"title": "T" * (MAX_TASK_TITLE_CHARS + 50)}, {"title": "ok"}, {"title": "ok2"}],
    )
    assert "Task list created" in out
    sess = sm.get_or_create("websocket:c1")
    assert len(sess.metadata[TASK_STATE_KEY]["tasks"][0]["title"]) == MAX_TASK_TITLE_CHARS


@pytest.mark.asyncio
async def test_create_task_list_refuses_when_blocked(tmp_path):
    sm = SessionManager(tmp_path)
    create, update = _tools(sm)
    await _execute(create, _request_context(), objective="O", tasks=_sample_tasks())
    await _execute(update, _request_context(), task_id="task-1", status="blocked")
    await _execute(update, _request_context(), task_id="task-2", status="blocked")
    await _execute(update, _request_context(), task_id="task-3", status="blocked")
    out = await _execute(
        create, _request_context(), objective="Second", tasks=[{"title": "Other"}]
    )
    assert "already exists" in out


def _all_tools(sm: SessionManager, runtime_events=None):
    from nanodesk.agent.tools.tasks import (
        FinishTaskListTool,
        ReplaceTasksTool,
    )

    create, update = _tools(sm, runtime_events)
    return (
        create,
        update,
        ReplaceTasksTool(sessions=sm, runtime_events=runtime_events),
        FinishTaskListTool(sessions=sm, runtime_events=runtime_events),
    )


@pytest.mark.asyncio
async def test_tool_results_carry_fresh_snapshot_for_same_turn(tmp_path):
    """同轮状态滞后回归：工具返回必须自带快照，不依赖下一轮的 Runtime Context."""
    sm = SessionManager(tmp_path)
    create, update, _replace, _finish = _all_tools(sm)
    created = await _execute(
        create, _request_context(), objective="O", tasks=[{"title": "A"}, {"title": "B"}, {"title": "C"}]
    )
    assert "Current task list (revision 1" in created
    assert "task-1" in created and "task-2" in created

    marked = await _execute(
        update, _request_context(), task_id="task-1", status="running"
    )
    assert "Current task list (revision 2" in marked
    assert "[running] task-1" in marked


@pytest.mark.asyncio
async def test_update_task_rejects_stale_revision(tmp_path):
    sm = SessionManager(tmp_path)
    create, update, _replace, _finish = _all_tools(sm)
    await _execute(create, _request_context(), objective="O", tasks=_sample_tasks())
    await _execute(update, _request_context(), task_id="task-1", status="running")

    stale = await _execute(
        update, _request_context(), task_id="task-2", status="running", revision=1
    )
    assert "stale revision" in stale
    assert "Current task list (revision 2" in stale
    sess = sm.get_or_create("websocket:c1")
    task2 = next(t for t in sess.metadata[TASK_STATE_KEY]["tasks"] if t["id"] == "task-2")
    assert task2["status"] == "pending"

    ok = await _execute(
        update, _request_context(), task_id="task-2", status="running", revision=2
    )
    assert "task-2 marked running" in ok


@pytest.mark.asyncio
async def test_replace_tasks_keeps_finished_and_rejects_stale_revision(tmp_path):
    sm = SessionManager(tmp_path)
    create, update, replace, _finish = _all_tools(sm)
    await _execute(create, _request_context(), objective="Ship v1", tasks=_sample_tasks())
    await _execute(update, _request_context(), task_id="task-1", status="completed")

    stale = await _execute(
        replace, _request_context(), revision=1, tasks=[{"title": "New plan"}]
    )
    assert "stale revision" in stale

    out = await _execute(
        replace,
        _request_context(),
        revision=2,
        tasks=[{"title": "New A"}, {"title": "New B"}],
        reason="用户改了目标",
    )
    assert "replaced at revision 3" in out
    sess = sm.get_or_create("websocket:c1")
    blob = sess.metadata[TASK_STATE_KEY]
    assert blob["revision"] == 3
    assert blob["status"] == "active"
    by_id = {t["id"]: t for t in blob["tasks"]}
    # Finished work preserved with evidence slot intact; ids never reused.
    assert by_id["task-1"]["status"] == "completed"
    assert "task-2" not in by_id and "task-3" not in by_id
    assert by_id["task-4"]["title"] == "New A"
    assert by_id["task-5"]["title"] == "New B"
    assert task_list_active(sess.metadata)


@pytest.mark.asyncio
async def test_finish_task_list_archives_and_unlocks_new_list(tmp_path):
    sm = SessionManager(tmp_path)
    create, update, _replace, finish = _all_tools(sm)
    await _execute(create, _request_context(), objective="O", tasks=_sample_tasks())
    await _execute(update, _request_context(), task_id="task-1", status="completed")

    out = await _execute(finish, _request_context(), summary="核心已上线，剩余抛弃")
    assert "finished at revision" in out
    sess = sm.get_or_create("websocket:c1")
    blob = sess.metadata[TASK_STATE_KEY]
    assert blob["status"] == "completed"
    assert blob["summary"] == "核心已上线，剩余抛弃"
    assert task_list_active(sess.metadata) is False
    # Finished list is locked …
    locked = await _execute(
        update, _request_context(), task_id="task-2", status="completed"
    )
    assert "no active task list" in locked
    # … but a new list may start afterwards.
    again = await _execute(
        create,
        _request_context(),
        objective="Next",
        tasks=[{"title": "Solo A"}, {"title": "Solo B"}, {"title": "Solo C"}],
    )
    assert "Task list created" in again
    assert sm.get_or_create("websocket:c1").metadata[TASK_STATE_KEY]["objective"] == "Next"


@pytest.mark.asyncio
async def test_finish_task_list_rejects_stale_revision(tmp_path):
    sm = SessionManager(tmp_path)
    create, update, _replace, finish = _all_tools(sm)
    await _execute(create, _request_context(), objective="O", tasks=_sample_tasks())
    await _execute(update, _request_context(), task_id="task-1", status="running")
    stale = await _execute(finish, _request_context(), summary="done", revision=1)
    assert "stale revision" in stale
    assert task_list_active(sm.get_or_create("websocket:c1").metadata)
