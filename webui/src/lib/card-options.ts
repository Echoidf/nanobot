import type { UIMessage } from "@/lib/types";

/**
 * Visual card-option ("quiz") contract shared by the WebUI renderer and the
 * agent-side ``ask_cards`` tool.
 *
 * Two transports produce the same {@link CardOptionsData} payload and both
 * must normalize through {@link parseCardOptionsData} before rendering,
 * because both are untrusted model/server output:
 *
 * - **structured** — an assistant ``message`` frame carrying an ``agent_ui``
 *   blob shaped ``{kind: "card_options", data: {...}}``. The websocket
 *   transcript writer persists the blob verbatim, so replay re-creates it.
 * - **textual** — a ```` ```cards ```` fenced block inside assistant markdown.
 *   {@link extractCardOptionsFromText} hoists it into ``message.cardOptions``
 *   at projection time and strips it from the rendered text.
 *
 * Selection semantics: clicking a card sends the option's ``value`` (options
 * joined by ``\n`` for multi-select) as an ordinary user message. The display
 * label is recovered from those values in {@link resolveCardChoices}, so the
 * transcript and the agent both stay authoritative — nothing extra is
 * persisted.
 */

/** One clickable card. */
export interface CardOption {
  /** Unique within a group; stable across live render and replay. */
  id: string;
  /** Primary label. Shown in the transcript instead of ``value`` once answered. */
  title: string;
  /** Secondary line under ``title``. */
  description?: string;
  /** Emoji, or a registered lucide icon name (falls back to raw text). */
  icon?: string;
  /** Exact text delivered to the agent when this card is picked. */
  value: string;
  /** Pluggable body renderer; unknown kinds fall back to the default body. */
  kind?: string;
  imageUrl?: string;
  /** 0–100. Used by the ``progress`` renderer. */
  progress?: number;
  /** Escape hatch for third-party renderers. */
  meta?: Record<string, unknown>;
}

export interface CardOptionsData {
  type: "card_options";
  /** Lead-in question rendered above the card grid. */
  question: string;
  options: CardOption[];
  /** Toggle selection and require an explicit confirm instead of firing on click. */
  multiSelect?: boolean;
  /** Offer an "Other…" entry that expands a free-text input. */
  allowCustomInput?: boolean;
}

/** Boundaries for untrusted payloads. */
const MAX_QUESTION_LENGTH = 500;
const MAX_TITLE_LENGTH = 120;
const MAX_VALUE_LENGTH = 500;
const MAX_DESCRIPTION_LENGTH = 300;
const MAX_OPTIONS = 12;
const MAX_ICON_LENGTH = 40;

/** Options are joined with this when a multi-select answer goes on the wire. */
export const CARD_CHOICE_VALUE_SEPARATOR = "\n";
/** Matching titles are joined with this when relabeling the user turn. */
export const CARD_CHOICE_TITLE_SEPARATOR = "、";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function cleanMultiline(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  const trimmed = value.replace(/[ \t]+$/gm, "").trim();
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function normalizeOption(raw: unknown, index: number, seen: Set<string>): CardOption | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const title = cleanText(rec.title, MAX_TITLE_LENGTH);
  if (!title) return null;

  let id = cleanText(rec.id, 64) || `option-${index + 1}`;
  if (seen.has(id)) id = `${id}-${index + 1}`;
  seen.add(id);

  const option: CardOption = { id, title, value: cleanText(rec.value, MAX_VALUE_LENGTH) || title };
  const description = cleanText(rec.description, MAX_DESCRIPTION_LENGTH);
  if (description) option.description = description;
  const icon = cleanText(rec.icon, MAX_ICON_LENGTH);
  if (icon) option.icon = icon;
  const kind = cleanText(rec.kind, 40);
  if (kind) option.kind = kind;
  const imageUrl = cleanText(rec.imageUrl, 2048);
  if (imageUrl) option.imageUrl = imageUrl;
  if (typeof rec.progress === "number" && Number.isFinite(rec.progress)) {
    option.progress = Math.min(100, Math.max(0, rec.progress));
  }
  const meta = asRecord(rec.meta);
  if (meta) option.meta = meta;
  return option;
}

/**
 * Normalize a card payload from either transport. Returns ``null`` when the
 * input is not renderable as cards, so callers keep the previous behaviour
 * (raw code block / plain trace) instead of showing an empty group.
 */
export function parseCardOptionsData(input: unknown): CardOptionsData | null {
  const root = asRecord(input);
  if (!root) return null;
  const question = cleanMultiline(root.question, MAX_QUESTION_LENGTH);
  const rawOptions = Array.isArray(root.options) ? root.options : null;
  if (!question || !rawOptions || rawOptions.length === 0) return null;

  const seen = new Set<string>();
  const options: CardOption[] = [];
  for (const raw of rawOptions) {
    if (options.length >= MAX_OPTIONS) break;
    const option = normalizeOption(raw, options.length, seen);
    if (option) options.push(option);
  }
  if (options.length === 0) return null;

  const data: CardOptionsData = { type: "card_options", question, options };
  if (root.multiSelect === true) data.multiSelect = true;
  if (root.allowCustomInput === true) data.allowCustomInput = true;
  return data;
}

/**
 * Parse an ``agent_ui`` blob. Non-card blobs (and malformed ones) return
 * ``null`` so the caller keeps treating the frame as plain trace text.
 */
export function parseCardOptionsBlob(blob: unknown): CardOptionsData | null {
  const rec = asRecord(blob);
  if (!rec || rec.kind !== "card_options") return null;
  return parseCardOptionsData(rec.data ?? rec);
}

/** Parse the body of a ```` ```cards ```` fence (tolerant of stray commas). */
export function parseCardOptionsFence(code: string): CardOptionsData | null {
  // Drop a byte-order mark so a copied JSON blob still parses.
  const source = code.replace(/^\uFEFF/, "").trim();
  if (!source) return null;
  const attempts = [source, source.replace(/,(\s*[}\]])/g, "$1")];
  for (const attempt of attempts) {
    try {
      return parseCardOptionsData(JSON.parse(attempt));
    } catch {
      // Try the next, more tolerant form.
    }
  }
  return null;
}

/**
 * Hoist card fences out of assistant markdown.
 *
 * Returns the first valid group plus the fence-free text. Invalid fences are
 * left in place so the ordinary code renderer can still show them (a model
 * that emitted broken JSON should not silently lose the payload).
 */
export function extractCardOptionsFromText(text: string): {
  data: CardOptionsData | null;
  content: string;
} {
  let data: CardOptionsData | null = null;
  const pattern = new RegExp(
    "(?:^|\\n)```[ \\t]*cards\\b[^\\n]*\\r?\\n([\\s\\S]*?)\\r?\\n```",
    "g",
  );
  const content = text.replace(pattern, (match, body: string) => {
    const parsed = data ?? parseCardOptionsFence(body);
    if (!parsed) return match;
    data = parsed;
    return "";
  });
  if (!data) return { data: null, content: text };
  // Collapse the whitespace the removed fences left behind.
  return { data, content: content.replace(/\n{3,}/g, "\n\n").trim() };
}

/** Wire payload for one confirm: values joined, optional custom answer last. */
export function cardChoiceValue(
  data: CardOptionsData,
  selectedIds: string[],
  customText?: string,
): string {
  const selected = data.options.filter((option) => selectedIds.includes(option.id));
  const parts = selected.map((option) => option.value);
  const custom = customText?.trim();
  if (custom) parts.push(custom);
  return parts.join(CARD_CHOICE_VALUE_SEPARATOR);
}

/**
 * Inverse of {@link cardChoiceValue}: which option ids an answered turn
 * contains. Typed text simply yields no id, so a custom answer leaves the
 * group unchecked instead of guessing.
 */
export function cardChoiceSelectedIds(content: string, data: CardOptionsData): string[] {
  const idByValue = new Map(data.options.map((option) => [option.value, option.id]));
  const ids: string[] = [];
  for (const line of content.split(CARD_CHOICE_VALUE_SEPARATOR)) {
    const id = idByValue.get(line) ?? idByValue.get(line.trim());
    if (id !== undefined && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * Recover the human label for an answered card group.
 *
 * Matching is exact and value-based, so replaying a transcript relabels the
 * same way the live click did. Returns ``null`` when no option value appears
 * in the content — the turn was typed by hand and must stay verbatim.
 */
export function cardChoiceTitle(content: string, data: CardOptionsData): string | null {
  const lines = content.split(CARD_CHOICE_VALUE_SEPARATOR);
  const byValue = new Map(data.options.map((option) => [option.value, option]));
  const titles = lines.map((line) => byValue.get(line)?.title ?? byValue.get(line.trim())?.title);
  if (titles.every((title) => title === undefined)) return null;
  if (titles.every((title) => title !== undefined)) {
    return titles.join(CARD_CHOICE_TITLE_SEPARATOR);
  }
  // Mixed answer (options plus typed text): only swap the matched lines.
  return lines.map((line, index) => titles[index] ?? line).join(CARD_CHOICE_VALUE_SEPARATOR);
}

/**
 * Mark card groups that the conversation has already moved past, and relabel
 * the answering user turn from option values back to their titles.
 *
 * Runs on both live and replayed message lists, is idempotent, and returns the
 * input array untouched when nothing changes.
 */
export function resolveCardChoices(messages: UIMessage[]): UIMessage[] {
  let next: UIMessage[] | null = null;
  const touched = new Set<number>();

  for (let index = 0; index < messages.length; index += 1) {
    const card = messages[index];
    if (!card.cardOptions || card.cardOptionsResolvedAt !== undefined) continue;

    let answerIndex = -1;
    for (let j = index + 1; j < messages.length; j += 1) {
      if (messages[j].role === "user") {
        answerIndex = j;
        break;
      }
    }
    if (answerIndex < 0) continue;

    next ??= [...messages];
    const answer = next[answerIndex];
    const createdAt = Number.isFinite(answer.createdAt) ? answer.createdAt : card.createdAt;
    const selectedIds = cardChoiceSelectedIds(answer.content, card.cardOptions);
    next[index] = {
      ...card,
      cardOptionsResolvedAt: createdAt,
      ...(selectedIds.length ? { cardOptionsSelectedIds: selectedIds } : {}),
    };

    if (touched.has(answerIndex)) continue;
    const title = cardChoiceTitle(answer.content, card.cardOptions);
    if (title !== null && title !== answer.content) {
      next[answerIndex] = { ...answer, content: title };
      touched.add(answerIndex);
    }
  }

  return next ?? messages;
}
