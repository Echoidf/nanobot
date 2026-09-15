import { describe, expect, it } from "vitest";

import {
  EMPTY_MCP_SERVER_DRAFT,
  isMcpDraftValid,
  joinMcpEnv,
  mcpConnectionState,
  mcpDraftFromPreset,
  mcpDraftToPayload,
  splitMcpLines,
  validateMcpDraft,
  type McpServerDraft,
} from "@/lib/mcp-server-form";
import type { McpPresetInfo } from "@/lib/types";

function preset(overrides: Partial<McpPresetInfo> = {}): McpPresetInfo {
  return {
    name: "postgres-lzh",
    display_name: "postgres-lzh",
    category: "custom",
    description: "Local analytics DB",
    docs_url: "",
    transport: "stdio",
    requires: "",
    note: "",
    install_supported: true,
    installed: true,
    configured: true,
    available: true,
    status: "configured",
    required_fields: [],
    connection_summary: "npx -y @modelcontextprotocol/server-postgres",
    source: "custom",
    ...overrides,
  };
}

describe("mcp server draft mapping", () => {
  it("maps a stored form into line-oriented editor fields", () => {
    const draft = mcpDraftFromPreset(preset({
      form: {
        name: "postgres-lzh",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-postgres", "postgresql://localhost:5432/app"],
        cwd: "/srv/mcp",
        url: "",
        env: { API_KEY: "••••••••", TZ: "UTC" },
        headers: {},
        enabled_tools: ["*"],
        tool_timeout: 60,
        enabled: true,
        description: "Local analytics DB",
        docs_url: "https://example.invalid/docs",
      },
    }));

    expect(draft.args.split("\n")).toEqual([
      "-y",
      "@modelcontextprotocol/server-postgres",
      "postgresql://localhost:5432/app",
    ]);
    expect(draft.env).toBe("API_KEY=••••••••\nTZ=UTC");
    expect(draft.command).toBe("npx");
    expect(draft.cwd).toBe("/srv/mcp");
    expect(draft.timeoutMs).toBe("60000");
    expect(draft.docsUrl).toBe("https://example.invalid/docs");
  });

  it("keeps the redaction sentinel visible so saving does not lose the secret", () => {
    const draft = mcpDraftFromPreset(preset({
      form: {
        name: "postgres-lzh",
        transport: "stdio",
        command: "npx",
        args: ["--api-key", "••••••••"],
        cwd: "",
        url: "",
        env: {},
        headers: {},
        enabled_tools: ["*"],
        tool_timeout: 30,
        enabled: true,
        description: "",
        docs_url: "",
      },
    }));
    const payload = mcpDraftToPayload(draft, true);

    expect(payload.args).toContain("••••••••");
    expect(payload.env).toBe("");
  });

  it("serializes a remote server without stdio-only fields", () => {
    const draft: McpServerDraft = {
      ...EMPTY_MCP_SERVER_DRAFT,
      name: "remote-docs",
      transport: "streamableHttp",
      url: "https://mcp.example.com/mcp",
      headers: "Authorization=Bearer abc",
      timeoutMs: "45000",
    };

    expect(mcpDraftToPayload(draft, true)).toMatchObject({
      name: "remote-docs",
      transport: "streamableHttp",
      url: "https://mcp.example.com/mcp",
      command: "",
      cwd: "",
      args: "",
      headers: "Authorization=Bearer abc",
      timeout_ms: "45000",
      enabled: "true",
    });
  });

  it("drops blank and comment lines but keeps the argument order", () => {
    expect(splitMcpLines("  -y \n\n# note\n@scope/pkg\n")).toEqual(["-y", "@scope/pkg"]);
    expect(joinMcpEnv({ A: "1", B: "two" })).toBe("A=1\nB=two");
  });
});

describe("mcp draft validation", () => {
  it("requires a name, a command for stdio, and a url for remote transports", () => {
    expect(validateMcpDraft(EMPTY_MCP_SERVER_DRAFT)).toHaveProperty("name");
    expect(validateMcpDraft({ ...EMPTY_MCP_SERVER_DRAFT, name: "docs" })).toHaveProperty("command");
    expect(validateMcpDraft({ ...EMPTY_MCP_SERVER_DRAFT, name: "docs", command: "npx" })).toEqual({});
    expect(
      validateMcpDraft({ ...EMPTY_MCP_SERVER_DRAFT, name: "docs", transport: "sse" }),
    ).toHaveProperty("url");
    expect(validateMcpDraft({ ...EMPTY_MCP_SERVER_DRAFT, name: "bad name!", command: "npx" }))
      .toHaveProperty("name", "invalidName");
  });

  it("rejects env lines that are not KEY=VALUE", () => {
    const draft = { ...EMPTY_MCP_SERVER_DRAFT, name: "docs", command: "npx", env: "TOKEN" };

    expect(validateMcpDraft(draft)).toHaveProperty("env", "invalidEnv");
    expect(isMcpDraftValid(draft)).toBe(false);
  });

  it("requires a positive millisecond timeout", () => {
    const draft = { ...EMPTY_MCP_SERVER_DRAFT, name: "docs", command: "npx", timeoutMs: "0" };

    expect(validateMcpDraft(draft)).toHaveProperty("timeoutMs", "invalidTimeout");
    expect(isMcpDraftValid({ ...draft, timeoutMs: "60000" })).toBe(true);
  });
});

describe("mcp connection state", () => {
  it("prefers the live runtime status over the stored configuration", () => {
    expect(mcpConnectionState(preset({ runtime_status: "connected" }))).toEqual({
      tone: "success",
      key: "connected",
    });
    expect(mcpConnectionState(preset({ runtime_status: "failed" }))).toEqual({
      tone: "danger",
      key: "failed",
    });
  });

  it("reports a turned-off server as neutral even when it once connected", () => {
    expect(
      mcpConnectionState(preset({ server_enabled: false, status: "disabled", runtime_status: "failed" })),
    ).toEqual({ tone: "neutral", key: "disabled" });
  });

  it("surfaces missing dependencies and pending authorization as attention states", () => {
    expect(mcpConnectionState(preset({ status: "missing_dependency" }))).toEqual({
      tone: "danger",
      key: "missingDependency",
    });
    expect(mcpConnectionState(preset({ status: "authorization_required" }))).toEqual({
      tone: "warning",
      key: "needsAuth",
    });
  });
});
