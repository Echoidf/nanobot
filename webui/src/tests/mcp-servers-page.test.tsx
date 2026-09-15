import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { McpServersPage } from "@/components/settings/mcp/McpServersPage";
import type { McpPresetInfo } from "@/lib/types";

function customServer(overrides: Partial<McpPresetInfo> = {}): McpPresetInfo {
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
    server_enabled: true,
    runtime_status: "connected",
    required_fields: [],
    connection_summary: "npx -y @modelcontextprotocol/server-postgres",
    source: "custom",
    form: {
      name: "postgres-lzh",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-postgres"],
      cwd: "",
      url: "",
      env: { API_KEY: "••••••••" },
      headers: {},
      enabled_tools: ["*"],
      tool_timeout: 60,
      enabled: true,
      description: "Local analytics DB",
      docs_url: "",
    },
    ...overrides,
  };
}

function renderPage(overrides: Partial<React.ComponentProps<typeof McpServersPage>> = {}) {
  const props = {
    presets: [customServer()],
    loading: false,
    actionKey: null,
    error: null,
    message: null,
    requiresRestart: false,
    onDismissStatus: vi.fn(),
    onToggleServer: vi.fn(),
    onSaveServer: vi.fn(async () => true),
    onTestServer: vi.fn(),
    onRemoveServer: vi.fn(),
    onReconnectServer: vi.fn(),
    ...overrides,
  };
  render(<McpServersPage {...props} />);
  return props;
}

describe("MCP servers page", () => {
  it("lists name, transport, and live connection state with a toggle", () => {
    renderPage();

    const card = screen.getByTestId("mcp-server-card-postgres-lzh");
    expect(card).toHaveTextContent("postgres-lzh");
    expect(card).toHaveTextContent("stdio");
    expect(card).toHaveTextContent("Connected");
    expect(screen.getByRole("switch", { name: "Enable postgres-lzh" })).toBeChecked();
  });

  it("marks a turned-off server as disabled and keeps the switch usable", () => {
    renderPage({
      presets: [customServer({ server_enabled: false, status: "disabled", runtime_status: undefined })],
    });

    expect(screen.getByTestId("mcp-server-card-postgres-lzh")).toHaveTextContent("Disabled");
    expect(screen.getByRole("switch", { name: "Enable postgres-lzh" })).not.toBeChecked();
  });

  it("shows a red connection-failed state and offers reconnect", () => {
    const props = renderPage({
      presets: [customServer({ runtime_status: "failed" })],
    });

    expect(screen.getByTestId("mcp-server-card-postgres-lzh")).toHaveTextContent("Connection failed");
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    expect(props.onReconnectServer).toHaveBeenCalledWith("postgres-lzh");
  });

  it("toggles a server through the switch", () => {
    const props = renderPage();

    fireEvent.click(screen.getByRole("switch", { name: "Enable postgres-lzh" }));
    expect(props.onToggleServer).toHaveBeenCalledWith(
      expect.objectContaining({ name: "postgres-lzh" }),
      false,
    );
  });

  it("surfaces a gateway error instead of failing silently", () => {
    renderPage({ error: "stdio MCP servers require a command" });

    expect(screen.getByText("stdio MCP servers require a command")).toBeInTheDocument();
  });

  it("creates a server through the modal with line-oriented args and ms timeout", async () => {
    const props = renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Add MCP server" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within1(dialog, "Server Name"), { target: { value: "docs" } });
    fireEvent.change(within1(dialog, "Command"), { target: { value: "npx" } });
    fireEvent.change(within1(dialog, "Args (one per line)"), {
      target: { value: "-y\ndocs-mcp\npostgres://localhost:5432/app" },
    });
    fireEvent.change(within1(dialog, "Env (KEY=VALUE per line, optional)"), {
      target: { value: "DOCS_TOKEN=abc" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(props.onSaveServer).toHaveBeenCalled());
    expect(props.onSaveServer).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "docs",
        transport: "stdio",
        command: "npx",
        args: "-y\ndocs-mcp\npostgres://localhost:5432/app",
        env: "DOCS_TOKEN=abc",
        timeout_ms: "60000",
        enabled: "true",
      }),
    );
  });

  it("opens an existing server pre-filled and keeps masked secrets untouched", async () => {
    const props = renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    expect(within1(dialog, "Server Name")).toHaveValue("postgres-lzh");
    expect(within1(dialog, "Env (KEY=VALUE per line, optional)")).toHaveValue("API_KEY=••••••••");
    expect(within1(dialog, "Timeout (ms)")).toHaveValue("60000");

    fireEvent.change(within1(dialog, "Description (optional)"), { target: { value: "Renamed notes" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(props.onSaveServer).toHaveBeenCalled());
    expect(props.onSaveServer.mock.calls[0]?.[0]).toMatchObject({
      name: "postgres-lzh",
      env: "API_KEY=••••••••",
      description: "Renamed notes",
    });
  });

  it("describes each field in the placeholder instead of showing an example value", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Add MCP server" }));
    const dialog = await screen.findByRole("dialog");

    expect(within1(dialog, "Server Name")).toHaveAttribute(
      "placeholder",
      "Short tool namespace for this server",
    );
    expect(within1(dialog, "Command")).toHaveAttribute(
      "placeholder",
      "Program the gateway starts",
    );
    expect(within1(dialog, "Args (one per line)")).toHaveAttribute(
      "placeholder",
      "One argument per line",
    );
    expect(within1(dialog, "Env (KEY=VALUE per line, optional)")).toHaveAttribute(
      "placeholder",
      "One KEY=VALUE per line",
    );
    // Example payloads pasted into a field would be submitted verbatim, so no
    // field may hint with a concrete command, package, or connection string.
    const placeholders = Array.from(dialog.querySelectorAll("[placeholder]"))
      .map((node) => node.getAttribute("placeholder") ?? "")
      .join(" ");
    expect(placeholders).not.toMatch(/npx|postgres-lzh|modelcontextprotocol|postgresql:\/\//i);
  });

  it("closes the modal from Cancel without saving", async () => {
    const props = renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Add MCP server" }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(props.onSaveServer).not.toHaveBeenCalled();
  });
});

/** Resolve a labelled control inside the dialog without global queries. */
function within1(container: HTMLElement, label: string): HTMLElement {
  const node = Array.from(container.querySelectorAll("input, textarea")).find((element) => {
    const text = element.closest("label")?.querySelector("span")?.textContent ?? "";
    return text.trim() === label;
  });
  if (!node) throw new Error(`no control labelled ${label}`);
  return node as HTMLElement;
}
