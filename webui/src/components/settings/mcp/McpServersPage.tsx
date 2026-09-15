import { useMemo, useState } from "react";
import {
  ExternalLink,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Server,
  Trash2,
  Wrench,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  DismissibleStatusMessage,
  RestartRequiredNotice,
  SETTINGS_SEARCH_INPUT_CLASS,
} from "@/components/settings/shared/SettingsControls";
import { McpServerModal, type McpServerModalMode } from "@/components/settings/mcp/McpServerModal";
import { ToggleButton } from "@/components/settings/ToggleButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { mcpConnectionState } from "@/lib/mcp-server-form";
import type { McpPresetInfo } from "@/lib/types";
import { cn } from "@/lib/utils";

interface McpServersPageProps {
  presets: McpPresetInfo[];
  loading: boolean;
  /** ``action:name`` key of the row currently busy; one row at a time. */
  actionKey: string | null;
  error: string | null;
  message: string | null;
  requiresRestart: boolean;
  onRestart?: () => void;
  isRestarting?: boolean;
  onRefresh?: () => void;
  onDismissStatus: () => void;
  onBackToChat?: () => void;
  onToggleServer: (preset: McpPresetInfo, enabled: boolean) => void;
  onSaveServer: (values: Record<string, string>) => Promise<boolean>;
  onTestServer: (name: string) => void;
  onRemoveServer: (name: string) => void;
  onReconnectServer: (name: string) => void;
}

/**
 * MCP Server management page: card list plus one centered modal shared by
 * create, edit, and detail.
 *
 * Rows come from the same gateway payload the Apps page uses; this page only
 * lists servers the runtime can actually start (custom entries, installed
 * presets, and Agent Plugin bridges), and keeps Agent Plugins read-only because
 * their enable flag lives in the plugin manifest, not in ``tools.mcpServers``.
 */
export function McpServersPage({
  presets,
  loading,
  actionKey,
  error,
  message,
  requiresRestart,
  onRestart,
  isRestarting,
  onRefresh,
  onDismissStatus,
  onBackToChat,
  onToggleServer,
  onSaveServer,
  onTestServer,
  onRemoveServer,
  onReconnectServer,
}: McpServersPageProps) {
  const { t } = useTranslation();
  const tx = (key: string, fallback: string, values?: Record<string, unknown>) =>
    t(key, { defaultValue: fallback, ...(values ?? {}) });
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<{
    mode: McpServerModalMode;
    preset: McpPresetInfo | null;
  } | null>(null);
  const [modalErrorVisible, setModalErrorVisible] = useState(false);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return presets
      .filter((preset) => preset.source === "custom" || preset.installed)
      .filter((preset) =>
        !needle
          || preset.name.toLowerCase().includes(needle)
          || preset.display_name.toLowerCase().includes(needle)
          || preset.description.toLowerCase().includes(needle)
          || String(preset.transport).toLowerCase().includes(needle),
      )
      .sort((left, right) => {
        const leftFailed = mcpConnectionState(left).tone === "danger" ? 0 : 1;
        const rightFailed = mcpConnectionState(right).tone === "danger" ? 0 : 1;
        return leftFailed - rightFailed || left.name.localeCompare(right.name);
      });
  }, [presets, query]);

  const statusMessage = error || message;
  const saving = Boolean(actionKey?.startsWith("save:"));

  const openModal = (next: { mode: McpServerModalMode; preset: McpPresetInfo | null }) => {
    setModalErrorVisible(false);
    setModal(next);
  };

  const submitModal = async (values: Record<string, string>) => {
    setModalErrorVisible(true);
    const ok = await onSaveServer(values);
    if (ok) setModal(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">
            {tx("settings.mcpServers.title", "MCP servers")}
          </h2>
          <p className="mt-0.5 text-[12.5px] leading-5 text-muted-foreground">
            {tx(
              "settings.mcpServers.subtitle",
              "Choose which MCP servers the agent may start, and watch their live connection state.",
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onRefresh ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onRefresh}
              disabled={loading}
              className="h-9 rounded-full px-3 text-[12.5px] font-semibold"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} aria-hidden />
              <span className="ml-1.5 hidden sm:inline">{tx("settings.actions.refresh", "Refresh")}</span>
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            onClick={() => openModal({ mode: "create", preset: null })}
            className="h-9 rounded-full px-4 text-[12.5px] font-semibold"
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {tx("settings.mcpServers.addServer", "Add MCP server")}
          </Button>
        </div>
      </div>

      <div className="relative">
        <Search
          className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={tx("settings.mcpServers.searchPlaceholder", "Search MCP servers")}
          aria-label={tx("settings.mcpServers.searchPlaceholder", "Search MCP servers")}
          className={cn("h-11 border-border/55 pl-11 text-[14px]", SETTINGS_SEARCH_INPUT_CLASS)}
        />
      </div>

      {requiresRestart ? (
        <RestartRequiredNotice
          message={tx(
            "settings.mcpServers.restartRequired",
            "Restart the gateway to apply MCP server changes.",
          )}
          onRestart={onRestart}
          isRestarting={isRestarting}
        />
      ) : null}

      {statusMessage && !modal ? (
        <DismissibleStatusMessage
          message={statusMessage}
          isError={Boolean(error)}
          onDismiss={onDismissStatus}
        />
      ) : null}

      {loading && !rows.length ? (
        <div className="flex h-36 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          {tx("settings.mcpServers.loading", "Loading MCP servers...")}
        </div>
      ) : rows.length ? (
        <ul className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {rows.map((preset) => (
            <McpServerCard
              key={preset.name}
              preset={preset}
              actionKey={actionKey}
              onToggle={(enabled) => onToggleServer(preset, enabled)}
              onEdit={() => openModal({ mode: "edit", preset })}
              onDetail={() => openModal({ mode: "detail", preset })}
              onTest={() => onTestServer(preset.name)}
              onRemove={() => onRemoveServer(preset.name)}
              onReconnect={() => onReconnectServer(preset.name)}
            />
          ))}
        </ul>
      ) : (
        <div className="rounded-panel border border-dashed border-border/55 bg-settings-surface px-6 py-12 text-center">
          <p className="text-[13px] text-muted-foreground">
            {query.trim()
              ? tx("settings.mcpServers.emptySearch", "No MCP servers match this search.")
              : tx("settings.mcpServers.empty", "No MCP servers configured yet.")}
          </p>
          {query.trim() ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setQuery("")}
              className="mt-4 h-8 rounded-full px-3 text-[12px] font-semibold"
            >
              {tx("settings.mcpServers.clearSearch", "Clear search")}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={() => openModal({ mode: "create", preset: null })}
              className="mt-4 h-8 rounded-full px-3 text-[12px] font-semibold"
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              {tx("settings.mcpServers.addServer", "Add MCP server")}
            </Button>
          )}
        </div>
      )}

      {modal ? (
        <McpServerModal
          mode={modal.mode}
          preset={modal.preset}
          saving={saving}
          error={modalErrorVisible ? error : null}
          onOpenChange={(open) => {
            if (!open) setModal(null);
          }}
          onSave={(values) => void submitModal(values)}
        />
      ) : null}

      {onBackToChat ? (
        <button
          type="button"
          onClick={onBackToChat}
          className="touch-target text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground lg:hidden"
        >
          {tx("settings.backToChat", "Back to chat")}
        </button>
      ) : null}
    </div>
  );
}

function McpServerCard({
  preset,
  actionKey,
  onToggle,
  onEdit,
  onDetail,
  onTest,
  onRemove,
  onReconnect,
}: {
  preset: McpPresetInfo;
  actionKey: string | null;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDetail: () => void;
  onTest: () => void;
  onRemove: () => void;
  onReconnect: () => void;
}) {
  const { t } = useTranslation();
  const tx = (key: string, fallback: string, values?: Record<string, unknown>) =>
    t(key, { defaultValue: fallback, ...(values ?? {}) });
  const enabled = preset.server_enabled !== false;
  const state = mcpConnectionState(preset);
  const toggleBusy = actionKey === `${enabled ? "disable" : "enable"}:${preset.name}`;
  const testBusy = actionKey === `test:${preset.name}`;
  const removeBusy = actionKey === `remove:${preset.name}`;
  const reconnectBusy = actionKey === `reconnect:${preset.name}`;
  const plugin = preset.source === "agent-plugin";
  const failed = state.tone === "danger" && enabled;
  const toolCount = preset.tool_names?.length ?? preset.tool_count ?? 0;

  return (
    <li
      data-testid={`mcp-server-card-${preset.name}`}
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-panel border bg-settings-surface px-4 py-4",
        failed ? "border-destructive/30" : "border-border/55",
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-control bg-muted text-muted-foreground">
          <Server className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <button
              type="button"
              onClick={onDetail}
              className="min-w-0 truncate text-left text-[14px] font-semibold leading-5 text-foreground hover:underline"
            >
              {preset.name}
            </button>
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 font-mono text-[10.5px] text-muted-foreground">
              {preset.auth === "oauth" ? "oauth" : preset.transport}
            </span>
          </div>
          <p className="mt-1 line-clamp-2 text-[12.5px] leading-5 text-muted-foreground">
            {preset.description || preset.connection_summary || tx("settings.mcpServers.noDescription", "No description.")}
          </p>
        </div>
        {plugin ? null : (
          <ToggleButton
            checked={enabled}
            disabled={toggleBusy || Boolean(actionKey)}
            onChange={onToggle}
            label={tx("settings.mcpServers.toggleAria", "Enable {{name}}", { name: preset.name })}
          />
        )}
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <ConnectionBadge
          tone={state.tone}
          label={tx(`settings.mcpServers.status.${state.key}`, state.key)}
        />
        {toolCount ? (
          <span className="text-[11.5px] text-muted-foreground/80">
            {tx("settings.mcp.toolsFound", "{{count}} tools", { count: toolCount })}
          </span>
        ) : null}
        {preset.docs_url ? (
          <a
            href={preset.docs_url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="h-3 w-3" aria-hidden />
            {tx("settings.mcp.openDocs", "Open docs")}
          </a>
        ) : null}

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {failed && !plugin ? (
            <CardAction
              label={tx("settings.mcpServers.reconnect", "Reconnect")}
              busy={reconnectBusy}
              disabled={Boolean(actionKey)}
              onClick={onReconnect}
              icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />}
            />
          ) : null}
          {enabled && !plugin ? (
            <CardAction
              label={tx("settings.mcp.test", "Test")}
              busy={testBusy}
              disabled={Boolean(actionKey)}
              onClick={onTest}
              icon={<Wrench className="h-3.5 w-3.5" aria-hidden />}
            />
          ) : null}
          {plugin ? null : (
            <CardAction
              label={tx("settings.actions.edit", "Edit")}
              disabled={Boolean(actionKey)}
              onClick={onEdit}
              icon={<Pencil className="h-3.5 w-3.5" aria-hidden />}
            />
          )}
          {plugin ? null : (
            <CardAction
              label={tx("settings.mcp.remove", "Remove")}
              busy={removeBusy}
              disabled={Boolean(actionKey)}
              tone="danger"
              onClick={onRemove}
              icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />}
            />
          )}
        </div>
      </div>
    </li>
  );
}

function CardAction({
  label,
  icon,
  busy,
  disabled,
  tone = "default",
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  busy?: boolean;
  disabled?: boolean;
  tone?: "default" | "danger";
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      aria-label={label}
      title={label}
      disabled={disabled || busy}
      onClick={onClick}
      className={cn(
        "h-8 gap-1.5 rounded-full px-2.5 text-[12px] font-medium text-muted-foreground",
        tone === "danger"
          ? "hover:bg-destructive/10 hover:text-destructive"
          : "hover:bg-muted hover:text-foreground",
      )}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : icon}
      <span className="hidden sm:inline">{label}</span>
    </Button>
  );
}

function ConnectionBadge({
  tone,
  label,
}: {
  tone: "success" | "warning" | "danger" | "neutral";
  label: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium",
        tone === "success" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        tone === "warning" && "bg-amber-500/10 text-amber-700 dark:text-amber-300",
        tone === "danger" && "bg-destructive/10 text-destructive",
        tone === "neutral" && "bg-muted text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          tone === "success" && "bg-emerald-500",
          tone === "warning" && "bg-amber-500",
          tone === "danger" && "bg-destructive",
          tone === "neutral" && "bg-muted-foreground/50",
        )}
        aria-hidden
      />
      {label}
    </span>
  );
}
