import {
  compactActivityPath,
  redactActivityText,
} from "@/components/thread/activity/activity-text";

/**
 * Failure codes the chat stream can name explicitly. MCP transport errors reach
 * the UI as free text (``ToolResult.error`` strings), so classification happens
 * here instead of silently degrading every failure to "failed".
 */
export type McpFailureCode =
  | "Timeout"
  | "Connection refused"
  | "Connection closed"
  | "Session terminated"
  | "Cancelled"
  | "Protocol error"
  | "Server error"
  | "Error";

export interface McpFailure {
  code: McpFailureCode;
  detail: string;
}

const FAILURE_RULES: Array<{ code: McpFailureCode; test: RegExp }> = [
  { code: "Timeout", test: /\btimed?\s*out\b|timeout/i },
  { code: "Connection refused", test: /connection refused|econnrefused/i },
  { code: "Connection closed", test: /closedresource|brokenresource|broken pipe|connection reset|connection aborted|endofstream/i },
  { code: "Session terminated", test: /session terminated|connection closed/i },
  { code: "Cancelled", test: /was cancelled|cancelled by/i },
  { code: "Protocol error", test: /parse error|invalid json|unexpected token|jsonrpc|content-length|malformed content/i },
];

/** Map a raw MCP failure string onto a stable, user-facing failure code. */
export function classifyMcpFailure(error: unknown): McpFailure {
  const text = normalizeErrorText(error);
  if (!text) return { code: "Error", detail: "The MCP tool call failed." };
  const rule = FAILURE_RULES.find((candidate) => candidate.test.test(text));
  return { code: rule?.code ?? (isServerReportedFailure(text) ? "Server error" : "Error"), detail: text };
}

/**
 * Render tool arguments or a tool result for the stream. Secrets and absolute
 * home paths are scrubbed the same way every other activity row does, and the
 * payload is truncated because it is replayed into model context.
 */
export function safeMcpPayload(value: unknown, maxLength = 2000): string {
  if (value === null || value === undefined) return "";
  const raw = typeof value === "string" ? value : jsonish(value);
  const scrubbed = compactActivityPath(redactActivityText(raw)).replace(/\s*\n\s*/g, "\n").trim();
  if (scrubbed.length <= maxLength) return scrubbed;
  return `${scrubbed.slice(0, maxLength).trimEnd()}\n… ${scrubbed.length - maxLength} more characters`;
}

function isServerReportedFailure(text: string): boolean {
  return /^error\b/i.test(text) || /iserror/i.test(text);
}

function jsonish(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function normalizeErrorText(error: unknown): string {
  if (typeof error === "string") return error.trim();
  if (!error || typeof error !== "object") return "";
  try {
    return JSON.stringify(error);
  } catch {
    return "";
  }
}
