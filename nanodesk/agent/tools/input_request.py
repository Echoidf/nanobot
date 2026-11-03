"""Plain-text user-input request: suspend the turn until the user answers.

Unlike ``ask_cards`` (which renders option cards and starts a fresh turn on
answer), this tool suspends the *same* turn with no card UI. The question is
delivered as a normal text message; the user's next message resumes the turn
with the answer as this tool call's result (Codex ``request_user_input``
semantics). Use it for open questions. When options must be clickable, use
``ask_cards`` instead.
"""

# pyright: reportIncompatibleMethodOverride=false

from __future__ import annotations

from typing import Any

from nanodesk.agent.tools.base import Tool, ToolResult, tool_parameters
from nanodesk.agent.tools.context import ToolContext
from nanodesk.agent.tools.schema import StringSchema, tool_parameters_schema


@tool_parameters
class RequestUserInputTool(Tool):
    """Suspend the turn with a plain-text question; resume on user answer."""

    @classmethod
    def create(cls, ctx: ToolContext) -> Tool:
        return cls()

    @property
    def name(self) -> str:
        return "request_user_input"

    @property
    def description(self) -> str:
        return (
            "Ask the user an open question and wait for their answer. "
            "Call this (and end your turn work) whenever you cannot proceed "
            "without a user decision. Do NOT ask blocking questions in plain "
            "text without this tool -- the turn would keep running. "
            "For clickable options use ask_cards instead. "
            "After calling, stop and wait; the answer arrives as the tool result."
        )

    @property
    def parameters(self) -> dict[str, Any]:
        return tool_parameters_schema(
            question=StringSchema(
                description="The question to show the user as plain text.",
                min_length=1,
                max_length=2000,
            ),
            context=StringSchema(
                description="Optional background shown before the question.",
                max_length=2000,
                nullable=True,
            ),
            required=["question"],
        )

    @property
    def read_only(self) -> bool:
        return True

    @property
    def suspends_turn(self) -> bool:
        return True

    async def execute(
        self,
        question: str,
        context: str | None = None,
        **kwargs: Any,
    ) -> Any:
        # The runner intercepts suspending calls before execution; this is a
        # fallback so direct invocations still end the turn visibly.
        text = (question or "").strip()
        if context and str(context).strip():
            text = f"{str(context).strip()}\n\n{text}"
        return ToolResult.terminal(text or "(waiting for user input)")
