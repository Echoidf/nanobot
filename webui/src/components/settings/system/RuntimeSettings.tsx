import { useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, Loader2, PauseCircle, PlayCircle, RotateCcw, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { AgentSettingsDraft } from "@/components/settings/models/ModelsSettings";
import {
  NumberInput,
  ReadOnlyRow,
  SettingsGroup,
  SettingsRow,
  SettingsSectionTitle,
  StatusPill,
} from "@/components/settings/shared/SettingsControls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { fetchRuntimeTools } from "@/lib/api";
import { isLoopbackHost } from "@/lib/network";
import { getRuntimeHost, isNativeRuntime } from "@/lib/runtime";
import type { ApiServicePayload, NanodeskFeatureInfo, RuntimeToolsPayload, SettingsPayload } from "@/lib/types";

export function RuntimeSettings({
  token,
  form,
  settings,
  onRestart,
  isRestarting,
  requiresRestartPending,
  apiService,
  apiServiceLoading,
  apiServiceAction,
  apiServiceError,
  langfuseFeature,
  capabilitiesLoading,
  capabilityAction,
  capabilityError,
  onApiServiceAction,
  onInstallCapability,
}: {
  token: string;
  form: AgentSettingsDraft;
  settings: SettingsPayload;
  onRestart?: () => void;
  isRestarting?: boolean;
  requiresRestartPending: boolean;
  apiService: ApiServicePayload | null;
  apiServiceLoading: boolean;
  apiServiceAction: "start" | "stop" | null;
  apiServiceError: string | null;
  langfuseFeature?: NanodeskFeatureInfo;
  capabilitiesLoading: boolean;
  capabilityAction: string | null;
  capabilityError: string | null;
  onApiServiceAction: (
    action: "start" | "stop",
    values?: { host: string; port: number; timeout: number; apiKey?: string },
  ) => void;
  onInstallCapability: (name: string) => void;
}) {
  const { t } = useTranslation();
  const tx = (key: string, fallback: string) => t(key, { defaultValue: fallback });
  const runtimeSurface = settings.surface ?? settings.runtime_surface;
  const runtimeHost = getRuntimeHost(runtimeSurface, settings.runtime_capabilities);
  const openLogs = runtimeHost.openLogs;
  const exportDiagnostics = runtimeHost.exportDiagnostics;
  const isNativeHost = isNativeRuntime(runtimeSurface);
  const restartActionLabel = isNativeHost
    ? tx("app.system.restartEngine", "Restart engine")
    : t("app.system.restart");
  const restartingActionLabel = isNativeHost
    ? tx("app.system.restartingEngine", "Restarting engine...")
    : t("app.system.restarting");
  const [diagnosticsPath, setDiagnosticsPath] = useState<string | null>(null);
  const [hostActionMessage, setHostActionMessage] = useState<{
    target: "logs" | "diagnostics";
    message: string;
  } | null>(null);
  const [hostActionBusy, setHostActionBusy] =
    useState<"logs" | "diagnostics" | null>(null);
  const apiDefaults = apiService ?? {
    installed: false,
    running: false,
    managed: false,
    host: settings.api?.host ?? "127.0.0.1",
    port: settings.api?.port ?? 8900,
    timeout: settings.api?.timeout ?? 120,
    api_key_hint: settings.api?.api_key_hint,
    endpoint: `http://127.0.0.1:${settings.api?.port ?? 8900}/v1`,
    command: "nanodesk serve",
  };
  const [apiHost, setApiHost] = useState(apiDefaults.host);
  const [apiPort, setApiPort] = useState(apiDefaults.port);
  const [apiKey, setApiKey] = useState("");
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [runtimeTools, setRuntimeTools] = useState<RuntimeToolsPayload | null>(null);
  const [runtimeToolsLoading, setRuntimeToolsLoading] = useState(true);
  const [runtimeToolsError, setRuntimeToolsError] = useState<string | null>(null);
  useEffect(() => {
    if (!apiService) return;
    setApiHost(apiService.host);
    setApiPort(apiService.port);
    setApiKey("");
    setApiKeyVisible(false);
  }, [apiService]);
  useEffect(() => {
    let cancelled = false;
    setRuntimeToolsLoading(true);
    setRuntimeToolsError(null);
    void fetchRuntimeTools(token)
      .then((payload) => {
        if (cancelled) return;
        setRuntimeTools(payload);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setRuntimeToolsError(
          error instanceof Error
            ? error.message
            : "Failed to load runtime tools.",
        );
      })
      .finally(() => {
        if (!cancelled) setRuntimeToolsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);
  const toolGroups = useMemo(() => {
    const tools = runtimeTools?.tools ?? [];
    return {
      builtin: tools.filter((tool) => tool.source === "builtin"),
      mcp: tools.filter((tool) => tool.source === "mcp"),
      runtime: tools.filter((tool) => tool.source === "runtime"),
    };
  }, [runtimeTools]);
  const apiNetworkAccess = !isLoopbackHost(apiHost);
  const apiMissingNetworkKey = apiNetworkAccess && !apiKey.trim() && !apiDefaults.api_key_hint;
  const engineState = isRestarting
    ? tx("settings.values.restartingEngine", "Restarting")
    : settings.apply_state?.status === "pending"
      ? tx("settings.values.pending", "Pending")
      : tx("settings.values.ready", "Ready");
  const runHostAction = async (
    target: "logs" | "diagnostics",
    action: (() => Promise<string | void>) | undefined,
    successMessage: (result: string | void) => string,
    failureMessage: string,
  ) => {
    if (!action) {
      setHostActionMessage({
        target,
        message: tx(
          "settings.status.hostApiUnavailable",
          "Host actions are only available inside the native app.",
        ),
      });
      return;
    }
    setHostActionBusy(target);
    setHostActionMessage(null);
    try {
      const result = await action();
      setHostActionMessage({ target, message: successMessage(result) });
    } catch {
      setHostActionMessage({ target, message: failureMessage });
    } finally {
      setHostActionBusy(null);
    }
  };
  return (
    <div className="space-y-7">
      {isNativeHost ? (
        <section>
          <SettingsSectionTitle>{tx("settings.sections.nativeHost", "Native host")}</SettingsSectionTitle>
          <SettingsGroup>
            <ReadOnlyRow title={tx("settings.rows.engine", "Engine")} value={engineState} />
            {settings.runtime_capabilities?.can_open_logs ? (
              <SettingsRow
                title={tx("settings.rows.logs", "Logs")}
                description={
                  hostActionMessage?.target === "logs" ? hostActionMessage.message : undefined
                }
              >
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void runHostAction(
                      "logs",
                      openLogs,
                      () => tx("settings.status.logsOpened", "Opened logs folder."),
                      tx("settings.status.logsOpenFailed", "Could not open logs folder."),
                    )
                  }
                  disabled={hostActionBusy !== null}
                  className="rounded-full"
                >
                  {hostActionBusy === "logs"
                    ? tx("settings.actions.opening", "Opening...")
                    : tx("settings.actions.open", "Open")}
                </Button>
              </SettingsRow>
            ) : null}
            {settings.runtime_capabilities?.can_export_diagnostics ? (
              <SettingsRow
                title={tx("settings.rows.diagnostics", "Diagnostics")}
                description={
                  hostActionMessage?.target === "diagnostics"
                    ? hostActionMessage.message
                    : diagnosticsPath || undefined
                }
              >
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void runHostAction(
                      "diagnostics",
                      exportDiagnostics ? async () => {
                        const path = await exportDiagnostics();
                        setDiagnosticsPath(path);
                        return path;
                      } : undefined,
                      (path) =>
                        t("settings.status.diagnosticsExported", {
                          path: String(path ?? ""),
                          defaultValue: "Diagnostics exported to {{path}}.",
                        }),
                      tx("settings.status.diagnosticsExportFailed", "Could not export diagnostics."),
                    )
                  }
                  disabled={hostActionBusy !== null}
                  className="rounded-full"
                >
                  {hostActionBusy === "diagnostics"
                    ? tx("settings.actions.exporting", "Exporting...")
                    : tx("settings.actions.export", "Export")}
                </Button>
              </SettingsRow>
            ) : null}
          </SettingsGroup>
        </section>
      ) : null}

      <section>
        <SettingsSectionTitle>{tx("settings.api.title", "API server")}</SettingsSectionTitle>
        <SettingsGroup>
          <SettingsRow
            title={tx("settings.api.openaiCompatible", "OpenAI-compatible API")}
            description={
              apiServiceError
                ? apiServiceError
                : apiDefaults.running
                  ? apiDefaults.endpoint
                  : undefined
            }
          >
            <div className="flex items-center justify-end gap-2">
              <StatusPill tone={apiDefaults.running ? "success" : "neutral"}>
                {apiServiceLoading
                  ? tx("settings.values.checking", "Checking")
                  : apiDefaults.running
                    ? tx("settings.values.running", "Running")
                    : tx("settings.values.off", "Off")}
              </StatusPill>
              <Button
                size="sm"
                variant="outline"
                disabled={apiServiceLoading || apiServiceAction !== null || apiMissingNetworkKey}
                onClick={() =>
                  onApiServiceAction(
                    apiDefaults.running ? "stop" : "start",
                    apiDefaults.running
                      ? undefined
                      : {
                          host: apiHost,
                          port: apiPort,
                          timeout: apiDefaults.timeout,
                          apiKey: apiKey.trim() || undefined,
                        },
                  )
                }
                className="rounded-full"
              >
                {apiServiceAction ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : apiDefaults.running ? (
                  <PauseCircle className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                ) : (
                  <PlayCircle className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                )}
                {apiServiceAction === "start"
                  ? tx("settings.api.starting", "Starting...")
                  : apiServiceAction === "stop"
                    ? tx("settings.api.stopping", "Stopping...")
                    : apiDefaults.running
                      ? tx("settings.api.stop", "Stop")
                      : tx("settings.api.start", "Start API server")}
              </Button>
            </div>
          </SettingsRow>
          {!apiDefaults.running ? (
            <>
              <SettingsRow
                title={tx("settings.api.access", "Access")}
                description={
                  apiNetworkAccess
                    ? tx("settings.api.networkHelp", "Other devices can connect; an API key is required.")
                    : tx("settings.api.localHelp", "Only this device can connect.")
                }
              >
                <SegmentedControl
                  value={apiNetworkAccess ? "network" : "local"}
                  options={[
                    { value: "local", label: tx("settings.api.thisDevice", "This device") },
                    { value: "network", label: tx("settings.api.localNetwork", "Local network") },
                  ]}
                  onChange={(value) => setApiHost(value === "network" ? "0.0.0.0" : "127.0.0.1")}
                />
              </SettingsRow>
              <SettingsRow title={tx("settings.api.port", "Port")}>
                <NumberInput value={apiPort} min={1} max={65535} onChange={setApiPort} />
              </SettingsRow>
              {apiNetworkAccess ? (
                <SettingsRow
                  title={tx("settings.api.apiKey", "API key")}
                  description={
                    apiMissingNetworkKey
                      ? tx("settings.api.apiKeyRequired", "Required before exposing the API to your network.")
                      : tx("settings.api.apiKeyHelp", "Clients send this as a Bearer token.")
                  }
                >
                  <div className="relative w-[280px] max-w-full">
                    <Input
                      type={apiKeyVisible ? "text" : "password"}
                      value={apiKey}
                      onChange={(event) => setApiKey(event.target.value)}
                      placeholder={apiDefaults.api_key_hint ?? tx("settings.api.apiKeyPlaceholder", "Enter an API key")}
                      className="h-9 rounded-full pr-10 text-[13px]"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setApiKeyVisible((visible) => !visible)}
                      aria-label={apiKeyVisible ? tx("settings.byok.hideApiKey", "Hide API key") : tx("settings.byok.showApiKey", "Show API key")}
                      className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 rounded-full"
                    >
                      {apiKeyVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </SettingsRow>
              ) : null}
            </>
          ) : null}
        </SettingsGroup>
      </section>

      <section>
        <SettingsSectionTitle>{tx("settings.observability.title", "Observability")}</SettingsSectionTitle>
        <SettingsGroup>
          <SettingsRow
            title="Langfuse"
            description={
              settings.observability?.configured
                ? undefined
                : tx(
                    "settings.observability.environment",
                    "Set LANGFUSE_SECRET_KEY and LANGFUSE_PUBLIC_KEY, then restart nanodesk.",
                  )
            }
          >
            {capabilitiesLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
            ) : langfuseFeature?.installed ? (
              <StatusPill tone={settings.observability?.configured ? "success" : "neutral"}>
                {settings.observability?.configured
                  ? tx("settings.values.ready", "Ready")
                  : tx("settings.values.needsSetup", "Needs setup")}
              </StatusPill>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={capabilityAction === "enable:langfuse"}
                onClick={() => onInstallCapability("langfuse")}
                className="rounded-full"
              >
                {capabilityAction === "enable:langfuse" ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : null}
                {capabilityAction === "enable:langfuse"
                  ? tx("settings.capabilities.installing", "Installing support...")
                  : tx("settings.observability.enable", "Enable tracing support")}
              </Button>
            )}
          </SettingsRow>
        </SettingsGroup>
        {capabilityError ? <p className="mt-2 text-[12px] text-destructive">{capabilityError}</p> : null}
      </section>

      <section>
        <SettingsSectionTitle>{tx("settings.sections.tools", "Runtime tools")}</SettingsSectionTitle>
        <SettingsGroup>
          <SettingsRow
            title={tx("settings.runtime.toolsAvailable", "Available tools")}
            description={
              runtimeTools?.restrict_to_workspace === true
                ? tx("settings.runtime.toolsWorkspaceRestricted", "Filesystem and command tools are currently restricted to the default workspace.")
                : tx("settings.runtime.toolsHelp", "This is the live tool catalog currently registered in the runtime.")
            }
          >
            {runtimeToolsLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
            ) : (
              <StatusPill tone="neutral">
                {runtimeTools?.counts?.total ?? 0}
              </StatusPill>
            )}
          </SettingsRow>
          {runtimeToolsError ? (
            <div className="px-4 pb-4 text-[12px] text-destructive">{runtimeToolsError}</div>
          ) : null}
          {!runtimeToolsLoading ? (
            <div className="space-y-4 px-4 pb-4">
              {([
                ["builtin", tx("settings.runtime.builtinTools", "Built-in")],
                ["mcp", tx("settings.runtime.mcpTools", "MCP")],
                ["runtime", tx("settings.runtime.runtimeTools", "Runtime")],
              ] as const).map(([group, label]) => {
                const tools = toolGroups[group];
                if (!tools.length) return null;
                return (
                  <div key={group} className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[12px] font-medium text-foreground">{label}</p>
                      <span className="text-[11px] text-muted-foreground">{tools.length}</span>
                    </div>
                    <div className="overflow-hidden rounded-lg border border-border/70">
                      {tools.map((tool) => (
                        <div key={tool.name} className="border-t border-border/60 px-3 py-3 first:border-t-0">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 space-y-1">
                              <div className="flex items-center gap-2">
                                <Wrench className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                                <p className="truncate text-[13px] font-medium text-foreground">{tool.name}</p>
                              </div>
                              <p className="text-[12px] leading-5 text-muted-foreground">
                                {tool.description || tx("settings.runtime.noToolDescription", "No description.")}
                              </p>
                              {tool.parameters.length ? (
                                <p className="text-[11px] leading-5 text-muted-foreground">
                                  {tool.parameters.map((parameter) => (
                                    `${parameter.name}: ${parameter.type}${parameter.required ? "" : "?"}`
                                  )).join(", ")}
                                </p>
                              ) : null}
                            </div>
                            <span className="shrink-0 text-[11px] text-muted-foreground">
                              {tool.parameter_count} {tool.parameter_count === 1 ? tx("settings.runtime.parameter", "parameter") : tx("settings.runtime.parameters", "parameters")}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
              {runtimeTools && (runtimeTools.counts?.total ?? 0) === 0 ? (
                <p className="text-[12px] text-muted-foreground">
                  {tx("settings.runtime.noTools", "No runtime tools are currently registered.")}
                </p>
              ) : null}
            </div>
          ) : null}
        </SettingsGroup>
      </section>

      <section>
        <SettingsSectionTitle>{t("settings.sections.system")}</SettingsSectionTitle>
        <SettingsGroup>
          {!isNativeHost ? (
            <ReadOnlyRow
              title={tx("settings.rows.gateway", "Gateway")}
              value={`${settings.runtime.gateway_host}:${settings.runtime.gateway_port}`}
            />
          ) : null}
          <ReadOnlyRow title={t("settings.rows.configPath")} value={settings.runtime.config_path} />
          <ReadOnlyRow title={tx("settings.rows.workspacePath", "Default workspace")} value={settings.runtime.workspace_path} />
          <ReadOnlyRow title={tx("settings.rows.timezone", "Timezone")} value={form.timezone} />
          {onRestart ? (
            <SettingsRow
              title={t("settings.rows.restart")}
              description={
                requiresRestartPending
                  ? tx("settings.status.savedRestartApply", "Saved. Restart when ready.")
                  : undefined
              }
            >
              <Button
                size="sm"
                variant="outline"
                onClick={onRestart}
                disabled={isRestarting}
                className="rounded-full"
              >
                {isRestarting ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                )}
                {isRestarting ? restartingActionLabel : restartActionLabel}
              </Button>
            </SettingsRow>
          ) : null}
        </SettingsGroup>
      </section>
    </div>
  );
}
