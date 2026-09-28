/**
 * Defense-in-depth filter for the text-format tool protocol.
 *
 * The provider layer (`_extract_text_tool_calls`) is authoritative: it parses
 * `<tool_call>…</tool_call>` blocks into structured calls and removes them
 * from the visible reply. This helper only hides whatever markup still
 * reaches the WebUI (older persisted transcripts, relay quirks, or a
 * truncated stream that never produced a closing tag) so raw protocol such as
 * `<tool_call><function=exec><parameter=command>…` is never rendered inside a
 * dialogue bubble.
 *
 * Fenced code blocks are left untouched so a legitimate code sample that
 * discusses the markup keeps working.
 */

const COMPLETE_TOOL_CALL_RE = /<tool_call\b[^>]*>[\s\S]*?<\/tool_call\s*>/gi;
const TRAILING_TOOL_CALL_RE = /<tool_call\b[^>]*>[\s\S]*$/i;
const FENCED_CODE_SPLIT_RE = /(```[\s\S]*?(?:```|$))/g;

function stripFromProse(segment: string): string {
  let next = segment.replace(COMPLETE_TOOL_CALL_RE, "");
  const trailing = TRAILING_TOOL_CALL_RE.exec(next);
  if (trailing) {
    const fragment = trailing[0].toLowerCase();
    if (fragment.includes("<function") || fragment.includes("<parameter")) {
      next = next.slice(0, trailing.index);
    }
  }
  return next;
}

/** Remove text-format tool-call markup from assistant markdown. */
export function stripToolCallMarkup(text: string): string {
  if (!text || text.toLowerCase().indexOf("<tool_call") === -1) return text;
  const parts = text.split(FENCED_CODE_SPLIT_RE);
  let changed = false;
  const cleaned = parts.map((part, index) => {
    // Odd segments are fenced code; keep them verbatim.
    if (index % 2 === 1) return part;
    const stripped = stripFromProse(part);
    if (stripped !== part) changed = true;
    return stripped;
  });
  if (!changed) return text;
  return cleaned.join("").replace(/\n{3,}/g, "\n\n").trim();
}
