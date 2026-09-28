import { extractCardOptionsFromText, resolveCardChoices } from "@/lib/card-options";
import { isModelCommandResponseText, isModelCommandText } from "@/lib/format";
import { isSystemCommandTurnId } from "@/lib/nanodesk-client";
import { scrubSubagentUiMessages } from "@/lib/subagent-channel-display";
import { stripToolCallMarkup } from "@/lib/tool-call-markup";
import type { UIMessage } from "@/lib/types";

const CARD_FENCE_START = /(?:^|\n)```[ \t]*cards/;

/**
 * Hoist ```` ```cards ```` fences out of assistant markdown into
 * ``message.cardOptions`` and drop the raw JSON from the rendered text.
 *
 * Structured ``agent_ui`` frames already land in ``cardOptions``, so only
 * messages that still carry a fence are touched. Fences that do not parse are
 * left alone and stay visible as ordinary code blocks.
 */
function hoistCardOptionMessages(messages: UIMessage[]): UIMessage[] {
  let next: UIMessage[] | null = null;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role !== "assistant" || message.kind === "trace") continue;
    if (message.cardOptions) continue;
    if (!CARD_FENCE_START.test(message.content)) continue;
    const { data, content } = extractCardOptionsFromText(message.content);
    if (!data) continue;
    next ??= [...messages];
    next[index] = { ...message, cardOptions: data, content };
  }
  return next ?? messages;
}

/**
 * Older WebUI disk snapshots and historical sessions may still contain
 * ``kind: "long_task"`` rows from the retired orchestrator UI. Map them to
 * ordinary trace rows so the thread stays readable without bespoke cards.
 */
export function normalizeLegacyLongTaskMessages(messages: UIMessage[]): UIMessage[] {
  return messages.map((m) => {
    const kind = (m as { kind?: string }).kind;
    if (kind !== "long_task") return m;
    const text = (m.content ?? "").trim() || "(legacy thread activity)";
    return {
      id: m.id,
      role: "tool",
      kind: "trace",
      content: text,
      traces: [text],
      createdAt: m.createdAt,
    };
  });
}

/**
 * Replay timestamps an assistant row when its first output is recorded, while
 * latency covers the whole turn. Derive the end from the matching user start
 * so the displayed time cannot double-count the pre-output interval.
 */
function deriveAssistantCompletionTimes(messages: UIMessage[]): UIMessage[] {
  const userStartedAtByTurn = new Map<string, number>();
  let latestUserStartedAt: number | undefined;

  return messages.map((message) => {
    if (message.role === "user") {
      if (Number.isFinite(message.createdAt)) {
        latestUserStartedAt = message.createdAt;
        if (message.turnId) userStartedAtByTurn.set(message.turnId, message.createdAt);
      }
      return message;
    }
    if (
      message.role !== "assistant"
      || message.kind === "trace"
      || message.completedAt !== undefined
      || message.latencyMs === undefined
      || !Number.isFinite(message.latencyMs)
      || message.latencyMs < 0
    ) {
      return message;
    }

    const startedAt = message.turnId
      ? userStartedAtByTurn.get(message.turnId)
      : message.source
        ? undefined
        : latestUserStartedAt;
    if (startedAt === undefined) return message;
    return { ...message, completedAt: startedAt + message.latencyMs };
  });
}

/**
 * Hide leaked text-format tool protocol from assistant bubbles.
 *
 * The provider normally strips `<tool_call>…</tool_call>` blocks before the
 * reply reaches the transcript, but persisted history and truncated streams
 * can still carry the raw markup. Clean the rendered copy only; the stored
 * message stays untouched. Code fences are preserved by the helper.
 */
function stripToolCallMarkupFromMessages(messages: UIMessage[]): UIMessage[] {
  let next: UIMessage[] | null = null;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role !== "assistant" || message.kind === "trace") continue;
    if (message.content.toLowerCase().indexOf("<tool_call") === -1) continue;
    const content = stripToolCallMarkup(message.content);
    if (content === message.content) continue;
    next ??= [...messages];
    next[index] = { ...message, content };
  }
  return next ?? messages;
}

export function projectWebuiThreadMessages(messages: UIMessage[]): UIMessage[] {
  const normalized = scrubSubagentUiMessages(normalizeLegacyLongTaskMessages(messages));
  const hiddenTurns = new Set(normalized.flatMap((message) => (
    message.role === "user" && isModelCommandText(message.content) && message.turnId
      ? [message.turnId]
      : []
  )));
  const visible = normalized.filter((message) => (
    !isSystemCommandTurnId(message.turnId)
    && (!message.turnId || !hiddenTurns.has(message.turnId))
    && !(message.role === "user" && isModelCommandText(message.content))
    && !(message.role === "assistant" && isModelCommandResponseText(message.content))
  ));
  // Card grouping and answering run on the visible list only: a hidden system
  // turn must never count as an answer to a card group.
  const scrubbed = stripToolCallMarkupFromMessages(visible);
  return resolveCardChoices(deriveAssistantCompletionTimes(hoistCardOptionMessages(scrubbed)));
}
