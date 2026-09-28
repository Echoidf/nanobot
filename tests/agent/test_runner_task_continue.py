"""Tests that an active task list drives AgentRunner continuation.

The task list is not a mode: the runner simply keeps working while the list has
open tasks and stops as soon as the model finishes them.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from agent.runner_helpers import make_run_spec
from nanodesk.config.schema import AgentDefaults
from nanodesk.providers.base import LLMProvider, LLMResponse

_MAX_TOOL_RESULT_CHARS = AgentDefaults().max_tool_result_chars


def _provider(text: str = "still working") -> MagicMock:
    provider = MagicMock(spec=LLMProvider)
    provider.chat_with_retry = AsyncMock(return_value=LLMResponse(
        content=text, tool_calls=[], usage={},
    ))
    return provider


def _tools() -> MagicMock:
    tools = MagicMock()
    tools.get_definitions.return_value = []
    return tools


@pytest.mark.asyncio
async def test_runner_continues_while_task_list_is_active():
    from nanodesk.agent.runner import AgentRunner

    provider = _provider()
    open_tasks = {"open": True}
    runner = AgentRunner()
    result = await runner.run(make_run_spec(provider,
        initial_messages=[{"role": "user", "content": "fix the suite"}],
        tools=_tools(),
        model="test-model",
        max_iterations=3,
        max_tool_result_chars=_MAX_TOOL_RESULT_CHARS,
        goal_active_predicate=lambda: open_tasks["open"],
        goal_continue_message=lambda: "You have active work:\n\nTask list:\n- [running] task-1: Run tests",
    ))

    assert result.stop_reason == "max_iterations"
    user_msgs = [m for m in result.messages if m.get("role") == "user"]
    assert any("Task list" in str(m.get("content", "")) for m in user_msgs)


@pytest.mark.asyncio
async def test_runner_stops_when_task_list_is_finished():
    """Once the model finishes every task the predicate flips and the turn ends."""
    from nanodesk.agent.runner import AgentRunner

    provider = _provider(text="all done")
    open_tasks = {"open": True}
    calls = {"n": 0}

    async def chat_with_retry(*args, **kwargs):  # noqa: ANN002, ANN003
        calls["n"] += 1
        # Simulate finish_task_list landing before the next iteration.
        open_tasks["open"] = False
        return LLMResponse(content="all done", tool_calls=[], usage={})

    provider.chat_with_retry = chat_with_retry
    runner = AgentRunner()
    result = await runner.run(make_run_spec(provider,
        initial_messages=[{"role": "user", "content": "fix the suite"}],
        tools=_tools(),
        model="test-model",
        max_iterations=3,
        max_tool_result_chars=_MAX_TOOL_RESULT_CHARS,
        goal_active_predicate=lambda: open_tasks["open"],
        goal_continue_message=lambda: "You have active work",
    ))

    assert result.stop_reason == "completed"
    assert calls["n"] == 1


@pytest.mark.asyncio
async def test_runner_does_not_continue_on_error_with_active_task_list():
    from nanodesk.agent.runner import AgentRunner

    provider = MagicMock(spec=LLMProvider)
    provider.chat_with_retry = AsyncMock(return_value=LLMResponse(
        content=None, tool_calls=[], usage={}, finish_reason="error",
    ))
    runner = AgentRunner()
    result = await runner.run(make_run_spec(provider,
        initial_messages=[{"role": "user", "content": "fix the suite"}],
        tools=_tools(),
        model="test-model",
        max_iterations=2,
        max_tool_result_chars=_MAX_TOOL_RESULT_CHARS,
        goal_active_predicate=lambda: True,
        goal_continue_message=lambda: "You have active work",
    ))

    assert result.stop_reason == "error"
