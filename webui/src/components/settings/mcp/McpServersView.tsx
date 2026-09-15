import { ChevronLeft, Server } from "lucide-react";
import { useTranslation } from "react-i18next";

import { McpServersPage } from "@/components/settings/mcp/McpServersPage";
import { useMcpServers } from "@/hooks/useMcpServers";
import { cn } from "@/lib/utils";

interface McpServersViewProps {
  onBackToChat: () => void;
  onRestart?: () => void;
  isRestarting?: boolean;
  hostChromeInset?: boolean;
}

/**
 * Standalone MCP Server surface opened from the sidebar.
 *
 * The chrome (page title, back-to-chat, scroll column) mirrors the other
 * sidebar surfaces so the management page reads as part of the same shell,
 * while all MCP state lives in ``useMcpServers``.
 */
export function McpServersView({
  onBackToChat,
  onRestart,
  isRestarting = false,
  hostChromeInset = false,
}: McpServersViewProps) {
  const { t } = useTranslation();
  const servers = useMcpServers();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-settings-canvas">
      <div className="min-w-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        <div
          className={cn(
            "mx-auto w-full max-w-[1080px] animate-in fade-in-0 slide-in-from-bottom-1 px-4 py-7 duration-200 ease-out",
            "motion-reduce:animate-none sm:px-8 sm:py-9 lg:py-11",
            hostChromeInset && "pt-[4.25rem] sm:pt-[4.25rem] lg:pt-[4.75rem]",
          )}
        >
          <div className="mb-7">
            <button
              type="button"
              onClick={onBackToChat}
              className="touch-target mb-4 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
              {t("settings.backToChat")}
            </button>
            <h1 className="flex items-center gap-2 text-[24px] font-semibold leading-tight tracking-normal text-foreground sm:text-[28px]">
              <Server className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
              {t("sidebar.mcp", { defaultValue: "MCP Server" })}
            </h1>
          </div>

          <McpServersPage
            presets={servers.presets}
            loading={servers.loading}
            actionKey={servers.actionKey}
            error={servers.error}
            message={servers.message}
            requiresRestart={servers.requiresRestart}
            onRestart={onRestart}
            isRestarting={isRestarting}
            onRefresh={() => void servers.refresh()}
            onDismissStatus={servers.dismissStatus}
            onToggleServer={(preset, enabled) => void servers.toggleServer(preset, enabled)}
            onSaveServer={servers.saveServer}
            onTestServer={(name) => void servers.testServer(name)}
            onRemoveServer={(name) => void servers.removeServer(name)}
            onReconnectServer={(name) => void servers.reconnectServer(name)}
          />
        </div>
      </div>
    </div>
  );
}
