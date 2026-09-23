"""Card-option tool: ask the user to choose through visual option cards."""

# pyright: reportIncompatibleMethodOverride=false

from __future__ import annotations

import re
from typing import Any, cast

from nanodesk.agent.tools.base import Tool, ToolResult, tool_parameters
from nanodesk.agent.tools.context import ToolContext, current_request_context
from nanodesk.agent.tools.schema import (
    ArraySchema,
    BooleanSchema,
    NumberSchema,
    ObjectSchema,
    StringSchema,
    tool_parameters_schema,
)
from nanodesk.bus.events import OUTBOUND_META_AGENT_UI, OutboundMessage

# Channels whose rich client renders the card grid. Everyone else receives the
# same options as a numbered list, so the question stays answerable anywhere.
RICH_CARD_CHANNELS = frozenset({"websocket"})
MAX_OPTIONS = 8

CARD_OPTIONS_KIND = "card_options"


def _clean_text(value: Any, *, default: str = "") -> str:
    """Normalize one single-line field the way the WebUI parser does."""
    if not isinstance(value, str):
        return default
    return re.sub(r"\s+", " ", value).strip() or default


def _clean_question(value: Any) -> str:
    """Normalize the lead-in question: newlines stay, ragged trailing space goes."""
    if not isinstance(value, str):
        return ""
    return re.sub(r"[ \t]+$", "", value, flags=re.MULTILINE).strip()


def normalize_options(raw: object) -> list[dict[str, Any]] | None:
    """Return card payloads in a deterministic shape, or ``None`` if unusable.

    Ids are de-duplicated with the same rule the WebUI parser uses, so the ids
    a client sees match the ids it would have produced from the same input.
    """
    if not isinstance(raw, list):
        return None
    entries = cast(list[object], raw)
    if not entries or len(entries) > MAX_OPTIONS:
        return None
    options: list[dict[str, Any]] = []
    seen: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            return None
        item = cast(dict[str, Any], entry)
        title = _clean_text(item.get("title"))
        if not title:
            return None
        index = len(options)
        option_id = _clean_text(item.get("id")) or f"option-{index + 1}"
        if option_id in seen:
            option_id = f"{option_id}-{index + 1}"
        seen.add(option_id)
        option: dict[str, Any] = {
            "id": option_id,
            "title": title,
            "value": _clean_text(item.get("value"), default=title),
        }
        description = _clean_text(item.get("description"))
        if description:
            option["description"] = description
        icon = _clean_text(item.get("icon"))
        if icon:
            option["icon"] = icon
        kind = _clean_text(item.get("kind"))
        if kind:
            option["kind"] = kind
        image_url = _clean_text(item.get("image_url") or item.get("imageUrl"))
        if image_url:
            option["imageUrl"] = image_url
        progress = item.get("progress")
        if isinstance(progress, (int, float)) and not isinstance(progress, bool):
            option["progress"] = max(0.0, min(100.0, float(progress)))
        options.append(option)
    return options


def build_card_payload(
    question: Any,
    options: Any,
    *,
    multi_select: Any = False,
    allow_custom_input: Any = False,
) -> dict[str, Any] | None:
    """Build the ``card_options`` body shared by every channel that renders it."""
    prompt = _clean_question(question)
    cleaned = normalize_options(options)
    if not prompt or cleaned is None:
        return None
    payload: dict[str, Any] = {
        "type": CARD_OPTIONS_KIND,
        "question": prompt,
        "options": cleaned,
    }
    if multi_select is True:
        payload["multiSelect"] = True
    if allow_custom_input is True:
        payload["allowCustomInput"] = True
    return payload


def plain_text_options(payload: dict[str, Any]) -> str:
    """Numbered fallback for channels that cannot render cards."""
    lines = [payload["question"], ""]
    for index, option in enumerate(payload["options"], start=1):
        description = option.get("description")
        lines.append(f"{index}. {option['title']}")
        if description:
            lines.append(f"   {description}")
    lines.append("")
    lines.append("Reply with the number (or your own answer).")
    return "\n".join(lines)


@tool_parameters(
    tool_parameters_schema(
        question=StringSchema(
            "Question shown above the option cards. Keep it a single clear question.",
            min_length=1,
            max_length=500,
        ),
        options=ArraySchema(
            ObjectSchema(
                properties={
                    "title": StringSchema(
                        "Card title. Also used as the answer text when value is omitted.",
                        min_length=1,
                        max_length=120,
                    ),
                    "value": StringSchema(
                        "Exact reply text delivered when this card is clicked. "
                        "Make it a short, actionable answer (defaults to the title).",
                        max_length=500,
                    ),
                    "description": StringSchema("Optional secondary line under the title.", max_length=300),
                    "icon": StringSchema("Optional emoji or icon name (e.g. 'rocket').", max_length=40),
                    "id": StringSchema("Optional stable identifier; defaults to option-N."),
                    "kind": StringSchema("Optional renderer hint: 'image' or 'progress'."),
                    "image_url": StringSchema("Optional image URL shown inside an 'image' card."),
                    "progress": NumberSchema(description="Optional 0-100 value for a 'progress' card."),
                },
                required=["title"],
            ),
            description="Between 2 and 8 options for the user to pick from.",
            min_items=2,
            max_items=MAX_OPTIONS,
        ),
        multi_select=BooleanSchema(
            description="True to let the user pick several options and confirm once.",
            default=False,
        ),
        allow_custom_input=BooleanSchema(
            description="True to add an 'Other…' entry with a free-text input.",
            default=False,
        ),
        required=["question", "options"],
    )
)
class AskCardsTool(Tool):
    """Ask the user to choose by delivering clickable option cards."""

    def __init__(
        self,
        send_callback: Any | None = None,
    ) -> None:
        self._send_callback = send_callback

    @classmethod
    def create(cls, ctx: ToolContext) -> Tool:
        return cls(send_callback=ctx.bus.publish_outbound if ctx.bus else None)

    def set_send_callback(self, callback: Any) -> None:
        self._send_callback = callback

    @property
    def name(self) -> str:
        return "ask_cards"

    @property
    def description(self) -> str:
        return (
            "Ask the user to choose between alternatives by showing clickable option cards. "
            "Prefer this over writing out a plain-text list of alternatives whenever the user must pick one. "
            "Each option's `value` is delivered back verbatim as the user's next message, so keep values short "
            "and specific enough to act on. "
            "Rich clients (WebUI) render the cards; other channels receive the same options as a numbered list. "
            "Delivery is asynchronous: end your turn after calling this tool and handle the user's answer as their "
            "next message — do not poll, loop, or wait inside the same turn."
        )

    async def execute(  # pyright: ignore[reportIncompatibleMethodOverride]
        self,
        question: str,
        options: list[dict[str, Any]],
        multi_select: bool = False,
        allow_custom_input: bool = False,
        **kwargs: Any,
    ) -> str:
        payload = build_card_payload(
            question,
            options,
            multi_select=multi_select,
            allow_custom_input=allow_custom_input,
        )
        if payload is None:
            return ToolResult.error(
                "Error: question and 2-8 options are required, and every option needs a non-empty title"
            )

        request_ctx = current_request_context()
        if request_ctx is None or not request_ctx.channel or not request_ctx.chat_id:
            return ToolResult.error("Error: no target conversation for card options")

        rich = request_ctx.channel in RICH_CARD_CHANNELS
        metadata = dict(request_ctx.metadata)
        # Same-target delivery, so the originating message id stays valid for
        # channels that thread replies (e.g. Feishu) on the text fallback.
        if request_ctx.message_id:
            metadata.setdefault("message_id", request_ctx.message_id)
        if rich:
            metadata[OUTBOUND_META_AGENT_UI] = {"kind": CARD_OPTIONS_KIND, "data": payload}
            content = payload["question"]
        else:
            content = plain_text_options(payload)

        from nanodesk.utils.helpers import strip_think

        message = OutboundMessage(
            channel=request_ctx.channel,
            chat_id=request_ctx.chat_id,
            content=strip_think(content),
            metadata=metadata,
        )
        send = self._send_callback
        if send is None:
            return ToolResult.error("Error: card delivery is not configured")
        try:
            await send(message)
        except Exception as exc:  # noqa: BLE001 - surface transport failures to the model
            return ToolResult.error(f"Error sending card options: {exc}")

        count = len(payload["options"])
        if rich:
            return ToolResult.terminal(
                f"Cards delivered to {request_ctx.channel}:{request_ctx.chat_id} ({count} options)."
            )
        return ToolResult.terminal(
            f"Sent a numbered list of {count} options to {request_ctx.channel}:{request_ctx.chat_id} "
            "(this channel does not render cards). Wait for their reply."
        )
