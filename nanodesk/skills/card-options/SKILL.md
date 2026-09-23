---
name: card-options
description: Ask the user to choose with clickable option cards instead of a plain-text list.
metadata: {"nanodesk":{"emoji":"🃏"}}
---

# Card options

When the user has to pick between a handful of alternatives, call `ask_cards`
instead of writing the alternatives as prose. The WebUI renders them as cards
and a click becomes the user's reply, so nobody has to retype an answer.

## Call shape

```json
{
  "question": "Which runtime should run the job?",
  "options": [
    {"title": "Python", "value": "python", "description": "CPython 3.12", "icon": "terminal"},
    {"title": "Node", "value": "node", "description": "Node 22", "icon": "rocket"}
  ]
}
```

- `question` — one clear question, shown above the cards.
- `title` — what the user reads.
- `value` — what comes back to you verbatim. Make it a short answer you can act
  on, not a restatement of the card.
- `description` — optional second line; use it for the tradeoff that matters.
- `icon` — optional emoji or icon name (`rocket`, `terminal`, `globe`, `image`).
- 2–8 options. If you have more, you have a taxonomy problem — narrow it first.
- `multi_select: true` when several answers are wanted; the UI collects them
  behind one confirm.
- `allow_custom_input: true` when no option may fit (a budget, a date, a name).

Two extra option fields power richer card styles: `kind: "image"` with
`image_url`, and `kind: "progress"` with `progress` (0–100).

## What happens next

Delivery is asynchronous. The tool returns once the cards are sent — end your
turn and read the user's next message as the answer. Do not poll, loop, or ask
"did you choose?" inside the same turn.

Only one group is live at a time: once the user answers (or types their own
reply), that group locks.

## Other channels

Cards render only in the WebUI. Everywhere else — Telegram, Feishu, Discord,
email — the tool falls back to a numbered list and the user replies with a
number or free text. The same call works on both, so never fork your behaviour
on the channel.

## When not to use it

- Free-form questions ("what went wrong?") — just ask in text.
- Two obvious choices where one is a default — state the default and act.
- Anything the user already answered earlier in the conversation.

## Text-only fallback

If tools are unavailable, the WebUI also parses a JSON block fenced with three
backticks and the language tag `cards` inside your reply into the same card
group. Prefer the tool; the fence is for contexts where you cannot call one.
