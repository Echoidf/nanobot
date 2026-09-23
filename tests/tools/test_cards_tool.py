"""Tests for the ask_cards tool: payload contract and per-channel delivery."""

import json

import pytest

from nanodesk.agent.tools.cards import AskCardsTool, build_card_payload, plain_text_options
from nanodesk.agent.tools.context import RequestContext, request_context
from nanodesk.agent.tools.loader import ToolLoader
from nanodesk.bus.events import OUTBOUND_META_AGENT_UI, OutboundMessage


def _tool(sent: list[OutboundMessage]) -> AskCardsTool:
    async def _send(msg: OutboundMessage) -> None:
        sent.append(msg)

    return AskCardsTool(send_callback=_send)


def test_ask_cards_is_discovered_by_the_loader() -> None:
    """A new capability must reach the registry without extra wiring."""
    assert AskCardsTool in ToolLoader().discover()


def test_parameters_expose_the_documented_contract() -> None:
    tool = AskCardsTool()
    params = tool.parameters
    assert params["required"] == ["question", "options"]
    assert params["additionalProperties"] is False
    option_schema = params["properties"]["options"]
    assert option_schema["minItems"] == 2
    assert option_schema["maxItems"] == 8
    assert option_schema["items"]["required"] == ["title"]


def test_build_card_payload_normalizes_and_bounds() -> None:
    payload = build_card_payload(
        "Which plan?",
        [
            {"title": "Starter", "value": "plan-a", "icon": "🚀"},
            {"title": " Pro ", "description": " more  power "},
            {"title": "Team", "id": "x", "progress": 150},
            {"title": "Dup", "id": "x"},
        ],
        multi_select=True,
        allow_custom_input=True,
    )

    assert payload is not None
    assert payload["type"] == "card_options"
    assert payload["question"] == "Which plan?"
    assert payload["multiSelect"] is True
    assert payload["allowCustomInput"] is True
    # value defaults to the title, ids follow the WebUI dedupe rule.
    assert payload["options"][1]["value"] == "Pro"
    assert payload["options"][1]["description"] == "more power"
    assert payload["options"][3]["id"] == "x-4"
    # progress is clamped into the renderer's range.
    assert payload["options"][2]["progress"] == 100.0
    # Option ordering is stable, so a replayed answer maps back to a title.
    assert [option["title"] for option in payload["options"]] == [
        "Starter",
        "Pro",
        "Team",
        "Dup",
    ]


@pytest.mark.parametrize(
    ("question", "options"),
    [
        ("", [{"title": "A"}, {"title": "B"}]),
        ("Q", []),
        ("Q", [{"title": ""}, {"title": "B"}]),
        ("Q", "not-a-list"),
    ],
)
def test_build_card_payload_rejects_unusable_input(question, options) -> None:
    assert build_card_payload(question, options) is None


def test_plain_text_options_lists_every_choice() -> None:
    text = plain_text_options({
        "type": "card_options",
        "question": "Which channel?",
        "options": [
            {"id": "1", "title": "Email", "value": "email", "description": "daily digest"},
            {"id": "2", "title": "SMS", "value": "sms"},
        ],
    })
    assert "1. Email" in text
    assert "daily digest" in text
    assert "2. SMS" in text
    assert "Reply with the number" in text


@pytest.mark.asyncio
async def test_delivers_structured_cards_on_the_websocket_channel() -> None:
    sent: list[OutboundMessage] = []
    tool = _tool(sent)

    with request_context(RequestContext(channel="websocket", chat_id="chat-1", metadata={})):
        result = await tool.execute(
            question="Which runtime?",
            options=[{"title": "Python"}, {"title": "Node"}],
        )

    assert "Cards delivered to websocket:chat-1" in result
    assert result.is_terminal is True
    assert result.is_error is False
    assert len(sent) == 1
    message = sent[0]
    assert (message.channel, message.chat_id) == ("websocket", "chat-1")
    # The question is also the frame text, so replay shows a normal assistant row.
    assert message.content == "Which runtime?"
    blob = message.metadata[OUTBOUND_META_AGENT_UI]
    assert blob["kind"] == "card_options"
    assert blob["data"]["question"] == "Which runtime?"
    assert [option["id"] for option in blob["data"]["options"]] == ["option-1", "option-2"]
    # Round-trips through plain JSON, exactly like the wire payload does.
    assert json.loads(json.dumps(blob)) == blob


@pytest.mark.asyncio
async def test_plain_channels_receive_a_numbered_list_without_the_blob() -> None:
    sent: list[OutboundMessage] = []
    tool = _tool(sent)

    meta = {"feishu": {"message_id": "om_123"}}
    with request_context(
        RequestContext(channel="feishu", chat_id="oc_9", metadata=meta, message_id="om_123"),
    ):
        result = await tool.execute(
            question="Which region?",
            options=[{"title": "EU"}, {"title": "US"}],
        )

    assert "numbered list of 2 options" in result
    assert result.is_terminal is True
    assert len(sent) == 1
    message = sent[0]
    assert OUTBOUND_META_AGENT_UI not in message.metadata
    assert "1. EU" in message.content
    assert "2. US" in message.content
    # Context metadata survives so the channel can still thread the reply.
    assert message.metadata["feishu"] == {"message_id": "om_123"}
    assert message.metadata["message_id"] == "om_123"


@pytest.mark.asyncio
async def test_fails_visibly_without_a_target_or_a_send_path() -> None:
    tool = AskCardsTool()
    options = [{"title": "A"}, {"title": "B"}]

    result = await tool.execute(question="Q", options=options)
    assert result.startswith("Error:")

    with request_context(RequestContext(channel="websocket", chat_id="chat-1")):
        result = await tool.execute(question="Q", options=options)
    assert result == "Error: card delivery is not configured"


@pytest.mark.asyncio
async def test_transport_failure_surfaces_as_a_tool_error() -> None:
    async def _explode(msg: OutboundMessage) -> None:
        raise RuntimeError("channel down")

    tool = AskCardsTool(send_callback=_explode)
    with request_context(RequestContext(channel="websocket", chat_id="chat-1")):
        result = await tool.execute(question="Q", options=[{"title": "A"}, {"title": "B"}])

    assert "Error sending card options: channel down" == result
