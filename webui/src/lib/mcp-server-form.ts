import type { McpPresetInfo, McpServerForm } from "@/lib/types";

export type McpTransport = "stdio" | "streamableHttp" | "sse";

/** Modal-shaped MCP server form: line-oriented fields, millisecond timeout. */
export interface McpServerDraft {
  name: string;
  transport: McpTransport;
  /** Endpoint property carried through unchanged; the modal has no auth picker. */
  auth: "" | "oauth";
  command: string;
  url: string;
  cwd: string;
  /** One argument per line, exactly what the modal edits. */
  args: string;
  /** One ``KEY=VALUE`` pair per line, exactly what the modal edits. */
  env: string;
  headers: string;
  /** Milliseconds; the gateway stores seconds and clamps to its own bounds. */
  timeoutMs: string;
  description: string;
  docsUrl: string;
}

export const MCP_TIMEOUT_DEFAULT_MS = 60_000;
export const MCP_TIMEOUT_MIN_MS = 5_000;
export const MCP_TIMEOUT_MAX_MS = 600_000;
/** The gateway echoes this back for values it refused to reveal. */
export const MCP_REDACTED_SENTINEL = "••••••••";

export const EMPTY_MCP_SERVER_DRAFT: McpServerDraft = {
  name: "",
  transport: "stdio",
  auth: "",
  command: "",
  url: "",
  cwd: "",
  args: "",
  env: "",
  headers: "",
  timeoutMs: String(MCP_TIMEOUT_DEFAULT_MS),
  description: "",
  docsUrl: "",
};

/** Backend placeholder description for custom servers without a user note. */
const MCP_CUSTOM_DEFAULT_DESCRIPTION = "Custom MCP server from nanobot config.";

const TRANSPORTS = new Set<McpTransport>(["stdio", "streamableHttp", "sse"]);

function normalizeTransport(value: string | undefined): McpTransport {
  return value && TRANSPORTS.has(value as McpTransport)
    ? (value as McpTransport)
    : "stdio";
}

/** Split a line-oriented textarea into trimmed, non-empty entries. */
export function splitMcpLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

/** Join stored values back into the line-oriented editor shape. */
export function joinMcpLines(values: string[] | undefined): string {
  return (values ?? []).join("\n");
}

export function joinMcpEnv(entries: Record<string, string> | undefined): string {
  return Object.entries(entries ?? {}).map(([key, value]) => `${key}=${value}`).join("\n");
}

/** Build an editable draft from a configured server row (secrets stay masked). */
export function mcpDraftFromPreset(preset: McpPresetInfo): McpServerDraft {
  const form: McpServerForm | null | undefined = preset.form;
  if (!form) {
    return {
      ...EMPTY_MCP_SERVER_DRAFT,
      name: preset.name,
      transport: normalizeTransport(preset.transport),
      auth: preset.auth === "oauth" ? "oauth" : "",
      url: preset.transport === "stdio" ? "" : preset.connection_summary,
      description: preset.description === MCP_CUSTOM_DEFAULT_DESCRIPTION ? "" : preset.description,
      docsUrl: preset.docs_url,
    };
  }
  return {
    name: form.name || preset.name,
    transport: normalizeTransport(form.transport),
    auth: form.auth === "oauth" ? "oauth" : "",
    command: form.command,
    url: form.url,
    cwd: form.cwd,
    args: joinMcpLines(form.args),
    env: joinMcpEnv(form.env),
    headers: joinMcpEnv(form.headers),
    timeoutMs: String(form.tool_timeout > 0 ? form.tool_timeout * 1000 : MCP_TIMEOUT_DEFAULT_MS),
    description: form.description,
    docsUrl: form.docs_url,
  };
}

/** Field-level validation for the save button and inline hints. */
export function validateMcpDraft(draft: McpServerDraft): Partial<Record<keyof McpServerDraft, string>> {
  const errors: Partial<Record<keyof McpServerDraft, string>> = {};
  const name = draft.name.trim();
  if (!name) errors.name = "required";
  else if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(name)) errors.name = "invalidName";
  if (draft.transport === "stdio") {
    if (!draft.command.trim()) errors.command = "required";
  } else if (!draft.url.trim()) {
    errors.url = "required";
  }
  const timeout = Number(draft.timeoutMs);
  if (!draft.timeoutMs.trim() || !Number.isFinite(timeout) || timeout <= 0) {
    errors.timeoutMs = "invalidTimeout";
  }
  for (const entry of splitMcpLines(draft.env)) {
    if (!entry.includes("=")) {
      errors.env = "invalidEnv";
      break;
    }
  }
  for (const entry of splitMcpLines(draft.headers)) {
    if (!entry.includes("=")) {
      errors.headers = "invalidEnv";
      break;
    }
  }
  return errors;
}

export function isMcpDraftValid(draft: McpServerDraft): boolean {
  return Object.keys(validateMcpDraft(draft)).length === 0;
}

/** Serialize the draft into the flat string payload the gateway action expects. */
export function mcpDraftToPayload(draft: McpServerDraft, enabled: boolean): Record<string, string> {
  const remote = draft.transport !== "stdio";
  return {
    name: draft.name.trim(),
    transport: draft.transport,
    command: remote ? "" : draft.command.trim(),
    url: remote ? draft.url.trim() : "",
    cwd: remote ? "" : draft.cwd.trim(),
    // OAuth is an endpoint property the modal never edits; echo it back so a
    // save cannot silently downgrade a signed-in server to anonymous HTTP.
    auth: remote && draft.auth === "oauth" ? "oauth" : "",
    args: joinMcpLines(splitMcpLines(draft.args)),
    env: joinMcpLines(splitMcpLines(draft.env)),
    headers: remote ? joinMcpLines(splitMcpLines(draft.headers)) : "",
    timeout_ms: String(Math.round(Number(draft.timeoutMs))),
    description: draft.description.trim(),
    docs_url: draft.docsUrl.trim(),
    enabled: enabled ? "true" : "false",
  };
}

/**
 * Resolve the row's live connection state for the list badge.
 *
 * ``runtime_status`` is the gateway's last connection attempt, so it wins over
 * the static configuration verdict whenever it is present.
 */
export function mcpConnectionState(preset: McpPresetInfo): {
  tone: "success" | "warning" | "danger" | "neutral";
  key: string;
} {
  if (preset.status === "disabled" || preset.server_enabled === false) {
    return { tone: "neutral", key: "disabled" };
  }
  switch (preset.runtime_status) {
    case "connected":
      return { tone: "success", key: "connected" };
    case "connecting":
      return { tone: "warning", key: "connecting" };
    case "failed":
      return { tone: "danger", key: "failed" };
    default:
      break;
  }
  if (preset.status === "authorization_required") return { tone: "warning", key: "needsAuth" };
  if (preset.status === "missing_dependency") return { tone: "danger", key: "missingDependency" };
  if (preset.status === "missing_credentials") return { tone: "warning", key: "needsKey" };
  if (preset.status === "configured") return { tone: "neutral", key: "idle" };
  return { tone: "neutral", key: "notConnected" };
}

/** Rows the MCP Server page manages: everything the runtime can start. */
export function isManagedMcpRow(preset: McpPresetInfo): boolean {
  return preset.source === "custom" || preset.source === "preset" || preset.installed;
}
