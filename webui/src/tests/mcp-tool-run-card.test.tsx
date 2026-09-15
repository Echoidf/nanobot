import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AgentActivityCluster } from "@/components/thread/AgentActivityCluster";
import type { McpPresetInfo } from "@/lib/types";

const POSTGRES_MCP: McpPresetInfo = {
  name: "postgres-lzh",
  display_name: "Postgres lzh",
  category: "database",
  description: "Query the analytics database",
  docs_url: "",
  transport: "stdio",
  requires: "",
  note: "",
  install_supported: true,
  installed: true,
  configured: true,
  available: true,
  status: "configured",
  runtime_status: "connected",
  required_fields: [],
  connection_summary: "npx -y @modelcontextprotocol/server-postgres",
};

function mcpMessage(phase: "start" | "end" | "error", extra: Record<string, unknown> = {}) {
  const event = {
    version: 1,
    phase,
    call_id: "call-1",
    name: "mcp_postgres-lzh_query",
    arguments: { sql: "select * from orders limit 5" },
    ...extra,
  };
  const line = `mcp_postgres-lzh_query({"sql":"select * from orders limit 5"})`;
  return {
    id: `t-${phase}`,
    role: "tool" as const,
    kind: "trace" as const,
    content: line,
    traces: [line],
    toolEvents: [event],
    createdAt: 1,
  };
}

describe("MCP tool run rows in the activity stream", () => {
  it("shows the running card before the result arrives", () => {
    render(
      <AgentActivityCluster
        messages={[mcpMessage("start")]}
        isTurnStreaming
        hasBodyBelow={false}
        mcpPresets={[POSTGRES_MCP]}
      />,
    );

    const card = screen.getByTestId("mcp-tool-run-postgres-lzh");
    expect(card).toBeInTheDocument();
    expect(screen.getByTestId("mcp-tool-run-status")).toHaveTextContent("Running");
    expect(screen.queryByText(/select \* from orders/)).not.toBeInTheDocument();
  });

  it("renders a red failure panel naming the concrete reason", () => {
    render(
      <AgentActivityCluster
        messages={[mcpMessage("error", {
          error: "(MCP tool call failed: ConnectionRefusedError: Connection refused)",
        })]}
        isTurnStreaming
        hasBodyBelow={false}
        mcpPresets={[POSTGRES_MCP]}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Connection refused");
    expect(alert).toHaveTextContent("ConnectionRefusedError");
    expect(screen.getByTestId("mcp-tool-run-status")).toHaveTextContent("Connection refused");
  });

  it("classifies a timeout as Timeout rather than a generic failure", () => {
    render(
      <AgentActivityCluster
        messages={[mcpMessage("error", {
          error: "(MCP tool call timed out after 60s)",
        })]}
        isTurnStreaming
        hasBodyBelow={false}
        mcpPresets={[POSTGRES_MCP]}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Timeout");
  });

  it("exposes request and response payloads only after expanding", () => {
    render(
      <AgentActivityCluster
        messages={[mcpMessage("end", { result: { rows: [{ id: 7 }] } })]}
        isTurnStreaming
        hasBodyBelow={false}
        mcpPresets={[POSTGRES_MCP]}
      />,
    );

    const toggle = screen.getByRole("button", { expanded: false });
    expect(screen.queryByText(/select \* from orders/)).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.getByText(/select \* from orders/)).toBeInTheDocument();
    expect(screen.getByText(/"id": 7/)).toBeInTheDocument();
  });

  it("never echoes credentials from tool arguments", () => {
    const message = {
      id: "t-secret",
      role: "tool" as const,
      kind: "trace" as const,
      content: 'mcp_postgres-lzh_run({"dsn":"postgres://admin:***@db:5432/app"})',
      traces: ['mcp_postgres-lzh_run({"dsn":"postgres://admin:***@db:5432/app"})'],
      toolEvents: [{
        version: 1,
        phase: "start",
        call_id: "call-secret",
        name: "mcp_postgres-lzh_run",
        arguments: { dsn: "postgres://admin:***@db:5432/app" },
      }],
      createdAt: 1,
    };
    const { container } = render(
      <AgentActivityCluster
        messages={[message]}
        isTurnStreaming
        hasBodyBelow={false}
        mcpPresets={[POSTGRES_MCP]}
      />,
    );

    expect(container.innerHTML).not.toContain("hunter2");
  });
});
