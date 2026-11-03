"""Regression tests for repetitive-loop guards (identical calls + stuck text)."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from agent.runner_helpers import make_run_spec
from nanodesk.agent.context_governance import ContextGovernor
from nanodesk.agent.runner import AgentRunner
from nanodesk.agent.tools.base import Tool, ToolResult
from nanodesk.agent.tools.registry import ToolRegistry
from nanodesk.config.schema import AgentDefaults
from nanodesk.providers.base import LLMResponse, ToolCallRequest
from nanodesk.session.input_request import (
    clear_pending_input_request,
    get_pending_input_request,
    save_pending_input_request,
)
from nanodesk.utils.runtime import (
    normalize_assistant_fingerprint,
    record_tool_error,
    repeated_identical_tool_call_error,
    repeated_tool_error,
)

_MAX_TOOL_RESULT_CHARS = AgentDefaults().max_tool_result_chars


def test_repeated_identical_tool_call_blocked_on_third():
    seen: dict[str, int] = {}
    args = {"command": "ls"}
    assert repeated_identical_tool_call_error("exec", args, seen) is None
    assert repeated_identical_tool_call_error("exec", args, seen) is None
    err = repeated_identical_tool_call_error("exec", args, seen)
    assert err is not None
    assert "repeated identical tool call blocked" in err


def test_assistant_fingerprint_distinguishes_tools():
    a = normalize_assistant_fingerprint(
        "The implementation is partially complete",
        [ToolCallRequest(id="1", name="exec", arguments={"command": "ls"})],
    )
    b = normalize_assistant_fingerprint(
        "The implementation is partially complete",
        [ToolCallRequest(id="2", name="exec", arguments={"command": "pwd"})],
    )
    assert a != b
    c = normalize_assistant_fingerprint("The implementation is partially complete", [])
    assert c != a


def test_prune_stale_reasoning_keeps_recent():
    messages = [
        {"role": "assistant", "content": "a", "reasoning_content": "old-1"},
        {"role": "assistant", "content": "b", "reasoning_content": "old-2"},
        {"role": "assistant", "content": "c", "reasoning_content": "new-1"},
        {"role": "assistant", "content": "d", "reasoning_content": "new-2"},
    ]
    pruned = ContextGovernor.prune_stale_reasoning(messages, keep_last_n=2)
    assert pruned[0]["reasoning_content"] == ""
    assert pruned[1]["reasoning_content"] == ""
    assert pruned[2]["reasoning_content"] == "new-1"
    assert pruned[3]["reasoning_content"] == "new-2"
    # Persisted input untouched.
    assert messages[0]["reasoning_content"] == "old-1"


@pytest.mark.asyncio
async def test_runner_blocks_third_identical_exec_call():
    provider = MagicMock()
    calls = {"n": 0}

    async def chat_with_retry(*, messages, **kwargs):
        calls["n"] += 1
        if calls["n"] <= 3:
            return LLMResponse(
                content="working",
                tool_calls=[
                    ToolCallRequest(
                        id=f"call_{calls['n']}",
                        name="exec",
                        arguments={"command": "ls"},
                    )
                ],
                usage={},
            )
        return LLMResponse(content="done", tool_calls=[], usage={})

    provider.chat_with_retry = chat_with_retry
    tools = MagicMock()
    tools.get_definitions.return_value = []
    tools.execute = AsyncMock(return_value="ok")

    result = await AgentRunner().run(make_run_spec(
        provider,
        initial_messages=[{"role": "user", "content": "list"}],
        tools=tools,
        model="test-model",
        max_iterations=4,
        max_tool_result_chars=_MAX_TOOL_RESULT_CHARS,
    ))

    assert result.final_content == "done"
    # Third identical exec is blocked before execute().
    assert tools.execute.await_count == 2
    blocked = [
        m for m in result.messages
        if m.get("role") == "tool" and "repeated identical tool call blocked" in str(m.get("content"))
    ]
    assert blocked


@pytest.mark.asyncio
async def test_runner_nudges_repetitive_tool_plan():
    provider = MagicMock()
    calls = {"n": 0}

    async def chat_with_retry(*, messages, **kwargs):
        calls["n"] += 1
        if calls["n"] <= 3:
            return LLMResponse(
                content="The implementation is partially complete",
                tool_calls=[
                    ToolCallRequest(
                        id=f"call_{calls['n']}",
                        name="exec",
                        arguments={"command": "ls"},
                    )
                ],
                usage={},
            )
        return LLMResponse(content="finished now", tool_calls=[], usage={})

    provider.chat_with_retry = chat_with_retry
    tools = MagicMock()
    tools.get_definitions.return_value = []
    tools.execute = AsyncMock(return_value="ok")

    result = await AgentRunner().run(make_run_spec(
        provider,
        initial_messages=[{"role": "user", "content": "do complex task"}],
        tools=tools,
        model="test-model",
        max_iterations=5,
        max_tool_result_chars=_MAX_TOOL_RESULT_CHARS,
    ))

    assert result.final_content == "finished now"
    nudges = [
        m for m in result.messages
        if m.get("role") == "user" and "repeated the same response" in str(m.get("content"))
    ]
    assert len(nudges) == 1


class _NeverExecuteSuspendTool(Tool):
    @property
    def name(self) -> str:
        return "request_user_input"

    @property
    def description(self) -> str:
        return "suspend for tests"

    @property
    def parameters(self) -> dict:
        return {"type": "object", "properties": {}, "required": []}

    @property
    def suspends_turn(self) -> bool:
        return True

    async def execute(self, **kwargs):
        raise AssertionError("suspending tool must never execute")


def test_tool_error_fuse_counts_failures_only():
    seen: dict[str, int] = {}
    assert repeated_tool_error("update_task", seen) is None
    record_tool_error("update_task", seen)
    assert repeated_tool_error("update_task", seen) is None
    record_tool_error("update_task", seen)
    assert repeated_tool_error("update_task", seen) is None
    record_tool_error("update_task", seen)
    err = repeated_tool_error("update_task", seen)
    assert err is not None
    assert "has failed" in err


def test_tool_error_fuse_resets_on_success():
    seen: dict[str, int] = {}
    record_tool_error("update_task", seen)
    record_tool_error("update_task", seen)
    seen.pop("update_task", None)  # success clears the streak, as the runner does
    record_tool_error("update_task", seen)
    record_tool_error("update_task", seen)
    assert repeated_tool_error("update_task", seen) is None


def test_pending_input_request_roundtrip():
    metadata: dict = {}
    assert get_pending_input_request(metadata) is None
    save_pending_input_request(metadata, {"interaction_id": "abc", "tool_call_id": "call_1"})
    assert get_pending_input_request(metadata)["interaction_id"] == "abc"
    resumed = clear_pending_input_request(metadata)
    assert resumed["tool_call_id"] == "call_1"
    assert get_pending_input_request(metadata) is None


@pytest.mark.asyncio
async def test_runner_suspends_on_request_user_input():
    provider = MagicMock()
    provider.chat_with_retry = AsyncMock(return_value=LLMResponse(
        content="need your call",
        tool_calls=[ToolCallRequest(
            id="call_input_1",
            name="request_user_input",
            arguments={"question": "选哪个？ 1 本机继续 / 2 先补环境"},
        )],
        usage={},
    ))
    tools = ToolRegistry()
    tools.register(_NeverExecuteSuspendTool())

    result = await AgentRunner().run(make_run_spec(
        provider,
        initial_messages=[{"role": "user", "content": "start work"}],
        tools=tools,
        model="test-model",
        max_iterations=5,
        max_tool_result_chars=_MAX_TOOL_RESULT_CHARS,
    ))

    assert result.stop_reason == "awaiting_user"
    assert result.final_content == "选哪个？ 1 本机继续 / 2 先补环境"
    assert result.pending_input_request is not None
    assert result.pending_input_request["tool_call_id"] == "call_input_1"
    assert result.pending_input_request["interaction_id"]
    # No tool result for the suspended call yet; the answer arrives next turn.
    assert not [
        m for m in result.messages
        if m.get("role") == "tool" and m.get("tool_call_id") == "call_input_1"
    ]


@pytest.mark.asyncio
async def test_runner_fuses_same_tool_failing_with_different_args():
    provider = MagicMock()
    calls = {"n": 0}

    async def chat_with_retry(*, messages, **kwargs):
        calls["n"] += 1
        if calls["n"] <= 4:
            return LLMResponse(
                content="updating",
                tool_calls=[ToolCallRequest(
                    id=f"call_{calls['n']}",
                    name="update_task",
                    arguments={"task_id": f"t{calls['n']}", "status": "running"},
                )],
                usage={},
            )
        return LLMResponse(content="done", tool_calls=[], usage={})

    provider.chat_with_retry = chat_with_retry
    tools = MagicMock()
    tools.get_definitions.return_value = []
    tools.execute = AsyncMock(return_value=ToolResult.error("Error: boom"))

    result = await AgentRunner().run(make_run_spec(
        provider,
        initial_messages=[{"role": "user", "content": "work"}],
        tools=tools,
        model="test-model",
        max_iterations=5,
        max_tool_result_chars=_MAX_TOOL_RESULT_CHARS,
        fail_on_tool_error=False,
    ))

    assert result.final_content == "done"
    fused = [
        m for m in result.messages
        if m.get("role") == "tool" and "has failed" in str(m.get("content"))
    ]
    assert fused


@pytest.mark.asyncio
async def test_loop_resumes_suspended_turn_with_user_answer(tmp_path):
    from nanodesk.agent.loop import AgentLoop
    from nanodesk.bus.events import InboundMessage
    from nanodesk.bus.queue import MessageBus

    provider = MagicMock()
    provider.get_default_model.return_value = "test-model"
    captured: list[dict] = []

    async def chat_with_retry(*, messages, **kwargs):
        captured[:] = messages
        return LLMResponse(content="noted", tool_calls=[], usage={})

    provider.chat_with_retry = chat_with_retry
    provider.chat_stream_with_retry = AsyncMock(side_effect=chat_with_retry)

    loop = AgentLoop(bus=MessageBus(), provider=provider, workspace=tmp_path, model="test-model")
    loop.tools.get_definitions = MagicMock(return_value=[])
    loop.consolidator.maybe_consolidate_by_tokens = AsyncMock(return_value=False)  # type: ignore[method-assign]

    session = loop.sessions.get_or_create("cli:test")
    session.messages = [
        {"role": "user", "content": "start", "timestamp": "2026-01-01T00:00:00"},
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [{
                "id": "call_input_1",
                "type": "function",
                "function": {
                    "name": "request_user_input",
                    "arguments": '{"question": "选哪个？"}',
                },
            }],
            "timestamp": "2026-01-01T00:00:01",
        },
    ]
    save_pending_input_request(session.metadata, {
        "interaction_id": "inter1",
        "tool_call_id": "call_input_1",
        "tool_name": "request_user_input",
        "question": "选哪个？",
    })
    loop.sessions.save(session)

    result = await loop._process_message(
        InboundMessage(channel="cli", sender_id="user", chat_id="test", content="选 1")
    )

    assert result is not None
    assert result.content == "noted"
    answers = [
        m for m in captured
        if m.get("role") == "tool" and m.get("tool_call_id") == "call_input_1"
    ]
    assert len(answers) == 1
    assert answers[0]["content"] == "选 1"
    assert get_pending_input_request(loop.sessions.get_or_create("cli:test").metadata) is None
