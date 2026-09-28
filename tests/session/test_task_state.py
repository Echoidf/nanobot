"""Tests for ``nanodesk.session.task_state`` parsing and projection."""

from __future__ import annotations

from nanodesk.session.task_state import (
    MAX_TASKS,
    TASK_STATE_KEY,
    derive_task_list_status,
    parse_task_state,
    task_list_active,
    task_state_raw,
    task_state_runtime_lines,
    task_state_ws_blob,
)


def _meta(*tasks: object) -> dict[str, object]:
    return {TASK_STATE_KEY: {"status": "active", "objective": "O", "revision": 3, "tasks": list(tasks)}}


def test_task_state_raw_handles_missing_metadata():
    assert task_state_raw(None) is None
    assert task_state_raw({}) is None


def test_parse_task_state_rejects_non_list_tasks():
    assert parse_task_state({"status": "active", "tasks": {"a": 1}}) is None
    assert parse_task_state({"status": "active", "tasks": []}) is not None


def test_task_list_active_requires_open_tasks():
    assert task_list_active(None) is False
    assert task_list_active({}) is False
    assert task_list_active(_meta({"id": "task-1", "status": "running"})) is True
    assert task_list_active(
        _meta({"id": "task-1", "status": "completed"}, {"id": "task-2", "status": "cancelled"}),
    ) is False
    # An inactive status is never treated as an open list.
    assert task_list_active(
        {TASK_STATE_KEY: {"status": "completed", "tasks": [{"id": "task-1", "status": "pending"}]}},
    ) is False


def test_derive_task_list_status_reflects_blocking_tasks():
    assert derive_task_list_status([{"status": "completed"}, {"status": "pending"}]) == "active"
    assert derive_task_list_status([{"status": "completed"}, {"status": "blocked"}]) == "blocked"
    assert derive_task_list_status([{"status": "completed"}, {"status": "failed"}]) == "blocked"
    assert derive_task_list_status([{"status": "completed"}, {"status": "cancelled"}]) == "completed"


def test_runtime_lines_only_for_active_lists():
    assert task_state_runtime_lines(None) == []
    lines = task_state_runtime_lines(_meta({"id": "task-1", "status": "running", "title": "Run tests"}))
    assert lines[0] == "Task list (host-managed):"
    assert "Objective: O" in lines
    assert "Revision: 3" in lines
    assert any("- [running] task-1: Run tests" == line for line in lines)
    assert task_state_runtime_lines(
        {TASK_STATE_KEY: {"status": "completed", "tasks": [{"id": "task-1", "status": "completed"}]}},
    ) == []


def test_ws_blob_limits_task_count_and_fields():
    meta = _meta(*[{"id": f"task-{i}", "title": f"T{i}", "status": "pending"} for i in range(MAX_TASKS * 2)])
    blob = task_state_ws_blob(meta)
    assert len(blob["tasks"]) == MAX_TASKS
    assert blob["revision"] == 3
    assert blob["active"] is True
    assert blob["status"] == "active"


def test_ws_blob_normalises_unknown_status():
    blob = task_state_ws_blob(
        _meta({"id": "task-1", "title": "T1", "status": "not-a-status", "note": "  ", "evidence": ""}),
    )
    assert blob["tasks"][0]["status"] == "pending"
    assert "note" not in blob["tasks"][0]
    assert "evidence" not in blob["tasks"][0]


def test_ws_blob_reports_blocked_for_host_attention():
    blob = task_state_ws_blob(
        {TASK_STATE_KEY: {"status": "blocked", "objective": "O", "tasks": [{"id": "task-1", "status": "blocked"}]}},
    )
    assert blob["active"] is False
    assert blob["status"] == "blocked"
