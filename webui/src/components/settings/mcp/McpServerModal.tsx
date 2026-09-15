import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Loader2, Server, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ToggleButton } from "@/components/settings/ToggleButton";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  EMPTY_MCP_SERVER_DRAFT,
  isMcpDraftValid,
  mcpDraftFromPreset,
  mcpDraftToPayload,
  validateMcpDraft,
  MCP_TIMEOUT_MAX_MS,
  MCP_TIMEOUT_MIN_MS,
  type McpServerDraft,
  type McpTransport,
} from "@/lib/mcp-server-form";
import type { McpPresetInfo } from "@/lib/types";
import { cn } from "@/lib/utils";

export type McpServerModalMode = "create" | "edit" | "detail";

interface McpServerModalProps {
  mode: McpServerModalMode;
  preset: McpPresetInfo | null;
  saving: boolean;
  /** Last transport-level error from the gateway, shown inline instead of silently dropping. */
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onSave: (values: Record<string, string>, enabled: boolean) => void;
}

/**
 * Single centered modal for creating, editing, and inspecting an MCP server.
 *
 * Field order and grouping follow the management spec: identity and transport
 * first, then the connection command block, then free-form metadata. Secrets
 * arrive from the gateway already masked; re-saving an untouched mask is a
 * no-op server-side, so opening a server for inspection can never leak or wipe
 * a credential.
 */
export function McpServerModal({
  mode,
  preset,
  saving,
  error,
  onOpenChange,
  onSave,
}: McpServerModalProps) {
  const { t } = useTranslation();
  const tx = (key: string, fallback: string, values?: Record<string, unknown>) =>
    t(key, { defaultValue: fallback, ...(values ?? {}) });
  const readOnly = mode === "detail";
  const [draft, setDraft] = useState<McpServerDraft>(() =>
    preset ? mcpDraftFromPreset(preset) : EMPTY_MCP_SERVER_DRAFT,
  );
  const [enabled, setEnabled] = useState(preset ? preset.server_enabled !== false : true);
  // Editing a stored server only needs one changed field before Save unlocks;
  // a brand-new server is always considered in progress.
  const [touched, setTouched] = useState(mode === "create");

  useEffect(() => {
    setDraft(preset ? mcpDraftFromPreset(preset) : EMPTY_MCP_SERVER_DRAFT);
    setEnabled(preset ? preset.server_enabled !== false : true);
    setTouched(!preset);
  }, [preset]);

  const errors = useMemo(() => validateMcpDraft(draft), [draft]);
  const canSave = isMcpDraftValid(draft);
  const remote = draft.transport !== "stdio";
  const update = <K extends keyof McpServerDraft>(key: K, value: McpServerDraft[K]) => {
    setTouched(true);
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const submit = () => {
    if (readOnly || !canSave) return;
    onSave(mcpDraftToPayload(draft, enabled), enabled);
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[min(42rem,calc(100dvh-2rem))] w-[calc(100vw-2rem)] max-w-[46rem] flex-col gap-0 overflow-hidden p-0"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-border/45 px-5 py-3.5 sm:px-6">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-control bg-muted text-muted-foreground">
            <Server className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-[17px] leading-6 tracking-[-0.01em]">
              {mode === "create"
                ? tx("settings.mcpServers.createTitle", "Add MCP server")
                : mode === "edit"
                  ? tx("settings.mcpServers.editTitle", "Edit MCP server")
                  : tx("settings.mcpServers.detailTitle", "MCP server details")}
            </DialogTitle>
            <DialogDescription className="truncate text-[12px] text-muted-foreground">
              {preset
                ? tx("settings.mcpServers.modalSubtitleExisting", "{{name}} · {{transport}}", {
                    name: preset.name,
                    transport: draft.transport,
                  })
                : tx(
                    "settings.mcpServers.modalSubtitleNew",
                    "Connect a stdio, HTTP, or SSE MCP server.",
                  )}
            </DialogDescription>
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={tx("common.close", "Close")}
            onClick={() => onOpenChange(false)}
            className="-mr-2 h-9 w-9 shrink-0 rounded-full text-muted-foreground"
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </header>

        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 py-5 scrollbar-thin scrollbar-track-transparent sm:px-6">
            <ModalSection
              title={tx("settings.mcpServers.basicSection", "Basic")}
              fields={
                <>
                  <Field
                    label={tx("settings.mcpServers.serverNameLabel", "Server Name")}
                    hint={tx(
                      "settings.mcpServers.serverNameHint",
                      "Used as the tool namespace; keep it short and ASCII.",
                    )}
                    error={touched && errors.name ? tx("settings.mcpServers.nameInvalid", "Use letters, digits, dash or underscore.") : undefined}
                  >
                    <Input
                      value={draft.name}
                      onChange={(event) => update("name", event.target.value)}
                      placeholder={tx(
                        "settings.mcpServers.serverNamePlaceholder",
                        "Short tool namespace for this server",
                      )}
                      autoComplete="off"
                      spellCheck={false}
                      disabled={readOnly || mode === "edit"}
                      className="h-9 bg-background/80 font-mono text-[12.5px]"
                    />
                  </Field>
                  <FieldSet
                    label={tx("settings.mcpServers.transportLabel", "Transport")}
                    hint={tx(
                      "settings.mcpServers.transportHint",
                      "stdio spawns a local process; HTTP and SSE connect remotely.",
                    )}
                  >
                    <div
                      role="radiogroup"
                      aria-label={tx("settings.mcpServers.transportLabel", "Transport")}
                      className="flex h-9 items-center gap-1 rounded-control bg-muted/65 p-1"
                    >
                      {(["stdio", "streamableHttp", "sse"] satisfies McpTransport[]).map((value) => (
                        <button
                          key={value}
                          type="button"
                          role="radio"
                          aria-checked={draft.transport === value}
                          disabled={readOnly}
                          onClick={() => update("transport", value)}
                          className={cn(
                            "flex-1 whitespace-nowrap rounded-full px-2 py-1 text-[12px] font-medium transition-colors",
                            draft.transport === value
                              ? "bg-background text-foreground"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {value === "streamableHttp" ? "HTTP" : value}
                        </button>
                      ))}
                    </div>
                  </FieldSet>
                  <Field
                    label={tx("settings.mcpServers.timeoutLabel", "Timeout (ms)")}
                    hint={tx(
                      "settings.mcpServers.timeoutHint",
                      "Per tool call. Range {{min}}–{{max}}.",
                      { min: MCP_TIMEOUT_MIN_MS, max: MCP_TIMEOUT_MAX_MS },
                    )}
                    error={touched && errors.timeoutMs ? tx("settings.mcpServers.timeoutInvalid", "Enter a positive number.") : undefined}
                  >
                    <Input
                      value={draft.timeoutMs}
                      onChange={(event) => update("timeoutMs", event.target.value)}
                      inputMode="numeric"
                      disabled={readOnly}
                      className="h-9 bg-background/80 font-mono text-[12.5px]"
                    />
                  </Field>
                </>
              }
            />

            <ModalSection
              title={tx("settings.mcpServers.connectionSection", "Connection")}
              fields={
                <>
                  {remote ? (
                    <Field
                      label={tx("settings.mcpServers.urlLabel", "URL")}
                      hint={tx("settings.mcpServers.urlHint", "Remote MCP endpoint.")}
                      error={touched && errors.url ? tx("settings.mcpServers.required", "Required.") : undefined}
                    >
                      <Input
                        value={draft.url}
                        onChange={(event) => update("url", event.target.value)}
                        placeholder={tx("settings.mcpServers.urlPlaceholder", "Full endpoint URL")}
                        autoComplete="off"
                        spellCheck={false}
                        disabled={readOnly}
                        className="h-9 bg-background/80 font-mono text-[12.5px]"
                      />
                    </Field>
                  ) : (
                    <Field
                      label={tx("settings.mcp.command", "Command")}
                      hint={tx("settings.mcpServers.commandHint", "Executable to spawn, e.g. npx.")}
                      error={touched && errors.command ? tx("settings.mcpServers.required", "Required.") : undefined}
                    >
                      <Input
                        value={draft.command}
                        onChange={(event) => update("command", event.target.value)}
                        placeholder={tx("settings.mcpServers.commandPlaceholder", "Program the gateway starts")}
                        autoComplete="off"
                        spellCheck={false}
                        disabled={readOnly}
                        className="h-9 bg-background/80 font-mono text-[12.5px]"
                      />
                    </Field>
                  )}
                  {!remote ? (
                    <Field
                      label={tx("settings.mcpServers.cwdLabel", "CWD (optional)")}
                      hint={tx("settings.mcpServers.cwdHint", "Defaults to the app process.")}
                    >
                      <Input
                        value={draft.cwd}
                        onChange={(event) => update("cwd", event.target.value)}
                        placeholder={tx("settings.mcpServers.cwdPlaceholder", "Inherit the application process")}
                        autoComplete="off"
                        spellCheck={false}
                        disabled={readOnly}
                        className="h-9 bg-background/80 font-mono text-[12.5px]"
                      />
                    </Field>
                  ) : null}
                  {!remote ? (
                    <Field
                      label={tx("settings.mcpServers.argsLabel", "Args (one per line)")}
                      hint={tx(
                        "settings.mcpServers.argsHint",
                        "Each line becomes one argument, so connection strings stay intact.",
                      )}
                    >
                      <Textarea
                        value={draft.args}
                        onChange={(event) => update("args", event.target.value)}
                        placeholder={tx(
                          "settings.mcpServers.argsPlaceholder",
                          "One argument per line",
                        )}
                        rows={4}
                        spellCheck={false}
                        disabled={readOnly}
                        className="min-h-[92px] resize-y bg-background/80 font-mono text-[12px]"
                      />
                    </Field>
                  ) : null}
                  <Field
                    label={tx("settings.mcpServers.envLabel", "Env (KEY=VALUE per line, optional)")}
                    hint={tx(
                      "settings.mcpServers.envHint",
                      "Secret values are shown masked and are kept when left unchanged.",
                    )}
                    error={touched && errors.env ? tx("settings.mcpServers.envInvalid", "Each line must be KEY=VALUE.") : undefined}
                  >
                    <Textarea
                      value={draft.env}
                      onChange={(event) => update("env", event.target.value)}
                      placeholder={tx(
                        "settings.mcpServers.envPlaceholder",
                        "One KEY=VALUE per line",
                      )}
                      rows={3}
                      spellCheck={false}
                      disabled={readOnly}
                      className="min-h-[72px] resize-y bg-background/80 font-mono text-[12px]"
                    />
                  </Field>
                  {remote ? (
                    <Field
                      label={tx("settings.mcpServers.headersLabel", "Headers (KEY=VALUE per line, optional)")}
                      hint={tx("settings.mcpServers.headersHint", "Request headers for authenticated endpoints.")}
                      error={touched && errors.headers ? tx("settings.mcpServers.envInvalid", "Each line must be KEY=VALUE.") : undefined}
                    >
                      <Textarea
                        value={draft.headers}
                        onChange={(event) => update("headers", event.target.value)}
                        placeholder={tx(
                          "settings.mcpServers.headersPlaceholder",
                          "One KEY=VALUE per line",
                        )}
                        rows={2}
                        spellCheck={false}
                        disabled={readOnly}
                        className="min-h-[56px] resize-y bg-background/80 font-mono text-[12px]"
                      />
                    </Field>
                  ) : null}
                </>
              }
            />

            <ModalSection
              title={tx("settings.mcpServers.metaSection", "Notes")}
              fields={
                <>
                  <Field label={tx("settings.mcpServers.descriptionLabel", "Description (optional)")}>
                    <Textarea
                      value={draft.description}
                      onChange={(event) => update("description", event.target.value)}
                      rows={2}
                      disabled={readOnly}
                      className="min-h-[56px] resize-y bg-background/80 text-[12.5px]"
                    />
                  </Field>
                  <Field label={tx("settings.mcpServers.docsLabel", "Docs link (optional)")}>
                    <div className="flex items-center gap-1.5">
                      <Input
                        value={draft.docsUrl}
                        onChange={(event) => update("docsUrl", event.target.value)}
                        placeholder={tx("settings.mcpServers.docsPlaceholder", "Link to this server's documentation")}
                        autoComplete="off"
                        spellCheck={false}
                        disabled={readOnly}
                        className="h-9 bg-background/80 font-mono text-[12.5px]"
                      />
                      {draft.docsUrl ? (
                        <a
                          href={draft.docsUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          aria-label={tx("settings.mcp.openDocs", "Open docs")}
                          className="grid h-9 w-9 shrink-0 place-items-center rounded-control text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                        </a>
                      ) : null}
                    </div>
                  </Field>
                  {mode !== "create" ? (
                    <div className="flex items-center justify-between gap-3 rounded-control bg-muted/35 px-3 py-2.5">
                      <span className="min-w-0 text-[12.5px] text-muted-foreground">
                        {tx(
                          "settings.mcpServers.enabledHint",
                          "Turn off to keep the configuration without starting the server.",
                        )}
                      </span>
                      <ToggleButton
                        checked={enabled}
                        disabled={readOnly || saving}
                        onChange={(next) => {
                          setTouched(true);
                          setEnabled(next);
                        }}
                        label={tx("settings.mcpServers.enabledAria", "Server enabled")}
                      />
                    </div>
                  ) : null}
                </>
              }
            />

            {error ? (
              <div
                role="alert"
                className="rounded-control border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-[12.5px] font-medium leading-5 text-destructive"
              >
                {error}
              </div>
            ) : null}
          </div>

          <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border/45 px-5 py-3.5 sm:px-6">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="h-9 rounded-full px-4 text-[12.5px] font-semibold"
            >
              {tx("settings.actions.cancel", "Cancel")}
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={readOnly || !canSave || saving || !touched}
              className="h-9 rounded-full px-4 text-[12.5px] font-semibold"
            >
              {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
              {tx("settings.actions.save", "Save")}
            </Button>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ModalSection({ title, fields }: { title: string; fields: React.ReactNode }) {
  return (
    <section aria-label={title} className="space-y-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/75">
        {title}
      </h3>
      <div className="space-y-3">{fields}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-[12px] font-medium text-foreground/85">{label}</span>
      {children}
      <FieldFootnote hint={hint} error={error} />
    </label>
  );
}

/** Same layout as ``Field`` for controls that are not a single labelled input. */
function FieldSet({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="block min-w-0">
      <span className="mb-1.5 block text-[12px] font-medium text-foreground/85">{label}</span>
      {children}
      <FieldFootnote hint={hint} />
    </div>
  );
}

function FieldFootnote({ hint, error }: { hint?: string; error?: string }) {
  if (error) {
    return <span className="mt-1 block text-[11.5px] text-destructive">{error}</span>;
  }
  if (hint) {
    return <span className="mt-1 block text-[11.5px] leading-5 text-muted-foreground">{hint}</span>;
  }
  return null;
}
