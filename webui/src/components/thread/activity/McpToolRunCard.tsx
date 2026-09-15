import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Server,
} from "lucide-react";

import { mcpPresetInitials } from "@/components/CliAppMentionText";
import {
  classifyMcpFailure,
  safeMcpPayload,
} from "@/components/thread/activity/mcp-tool-run-model";
import { useLogoFallback } from "@/hooks/useLogoFallback";
import { logoFallbackUrls } from "@/lib/provider-brand";
import type { McpPresetInfo } from "@/lib/types";
import { cn } from "@/lib/utils";

export type McpRunStatus = "running" | "done" | "error";

export interface McpToolRun {
  key: string;
  presetName: string;
  displayName: string;
  toolName: string;
  args: unknown;
  result?: unknown;
  status: McpRunStatus;
  error?: string;
  startedAt?: number;
}

interface McpToolRunCardProps {
  run: McpToolRun;
  active: boolean;
  preset?: McpPresetInfo;
  label: string;
}

/**
 * MCP tool call card for the chat stream.
 *
 * Deliberately distinct from plain text streaming: it always names the current
 * phase, keeps request/response payloads behind an explicit expand so the
 * timeline stays scannable, and renders failures as a red panel that names the
 * reason (Timeout, Connection refused, server error) instead of failing
 * silently. Payloads are scrubbed of credentials before they touch the DOM.
 */
export function McpToolRunCard({ run, active, preset, label }: McpToolRunCardProps) {
  const [expanded, setExpanded] = useState(false);
  const failed = run.status === "error";
  const running = run.status === "running" && active;
  const elapsedSeconds = useElapsedSeconds(run, active);
  const rows = [
    { key: "tool", label: "Tool", value: run.toolName },
    { key: "server", label: "Server", value: preset?.display_name || run.displayName },
    ...(preset?.transport
      ? [{ key: "transport", label: "Transport", value: String(preset.transport) }]
      : []),
  ];
  const argumentsPayload = safeMcpPayload(run.args);
  const resultPayload = failed ? "" : safeMcpPayload(run.result);
  const failure = failed ? classifyMcpFailure(run.error) : null;
  const statusText = running
    ? (elapsedSeconds ? `Running ${elapsedSeconds}s` : "Running")
    : failed
      ? failure?.code ?? "Failed"
      : "Done";

  return (
    <div
      data-testid={`mcp-tool-run-${run.presetName.toLowerCase()}`}
      className={cn(
        "rounded-control border bg-muted/25",
        failed ? "border-destructive/35 bg-destructive/[0.06]" : "border-border/45",
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5 px-2 py-1.5">
        <McpRunMarker run={run} active={active} preset={preset} />
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md text-left text-[13px] leading-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <span
            className={cn(
              "min-w-0 flex-1 truncate font-medium",
              failed ? "text-destructive" : "text-foreground/85",
            )}
            title={label}
          >
            {label}
          </span>
          <span
            data-testid="mcp-tool-run-status"
            className={cn(
              "shrink-0 text-[11px] font-semibold",
              failed ? "text-destructive" : "text-muted-foreground/75",
            )}
          >
            {statusText}
          </span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted-foreground/70 transition-transform",
              expanded && "rotate-180",
            )}
            aria-hidden
          />
        </button>
      </div>

      {failure ? (
        <div
          role="alert"
          className="mx-2 mb-2 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-[12.5px] leading-5 text-destructive"
        >
          <span className="font-semibold">{failure.code}</span>
          {failure.detail ? (
            <span className="mt-0.5 block break-words font-mono text-[11.5px] text-destructive">
              {safeMcpPayload(failure.detail)}
            </span>
          ) : null}
        </div>
      ) : null}

      {expanded ? (
        <div className="border-t border-border/40 px-2.5 py-2">
          <dl className="grid gap-x-3 gap-y-1 text-[12px] sm:grid-cols-[auto_minmax(0,1fr)]">
            {rows.map((row) => (
              <div key={row.key} className="contents">
                <dt className="text-muted-foreground/75">{row.label}</dt>
                <dd className="min-w-0 break-words font-mono text-[11.5px] text-foreground/85">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
          {argumentsPayload ? <PayloadBlock title="Request" payload={argumentsPayload} /> : null}
          {resultPayload ? <PayloadBlock title="Response" payload={resultPayload} /> : null}
          {running && !argumentsPayload ? (
            <p className="mt-2 text-[11.5px] text-muted-foreground">
              Waiting for the MCP server to return a result.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PayloadBlock({ title, payload }: { title: string; payload: string }) {
  return (
    <div className="mt-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/75">
        {title}
      </p>
      <pre className="scrollbar-thin scrollbar-track-transparent mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/70 p-2 font-mono text-[11.5px] leading-5 text-foreground/80">
        {payload}
      </pre>
    </div>
  );
}

function McpRunMarker({
  run,
  active,
  preset,
}: {
  run: McpToolRun;
  active: boolean;
  preset?: McpPresetInfo;
}) {
  if (run.status === "error") {
    return <AlertCircle className="h-4 w-4 shrink-0 text-destructive" aria-hidden />;
  }
  if (run.status === "done" || !active) {
    return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500/80" aria-hidden />;
  }
  return <McpServerSpinner run={run} preset={preset} />;
}

function McpServerSpinner({ run, preset }: { run: McpToolRun; preset?: McpPresetInfo }) {
  const color = preset?.brand_color || "#6D5DF6";
  const logoUrls = logoFallbackUrls(preset?.logo_url);
  const { logoUrl, onLogoError, onLogoLoad } = useLogoFallback(logoUrls);

  return (
    <span
      data-testid={`activity-mcp-logo-${run.presetName || preset?.name || "server"}`}
      className="grid h-4 w-4 shrink-0 animate-pulse place-items-center overflow-hidden rounded-mark border text-[6.5px] font-semibold text-white"
      style={{
        borderColor: alphaColor(color, 22),
        backgroundColor: logoUrl ? "hsl(var(--background))" : color,
        boxShadow: `0 0 0 3px ${alphaColor(color, 9)}`,
      }}
      aria-hidden
    >
      {logoUrl ? (
        <img
          src={logoUrl}
          alt=""
          decoding="async"
          loading="lazy"
          className="h-[78%] w-[78%] object-contain"
          onLoad={onLogoLoad}
          onError={onLogoError}
        />
      ) : preset ? (
        mcpPresetInitials(preset).slice(0, 2)
      ) : (
        <Server className="h-3 w-3" />
      )}
    </span>
  );
}

/** Wall-clock seconds for a still-running call, so a hung tool is visible. */
function useElapsedSeconds(run: McpToolRun, active: boolean): number {
  const [, tick] = useState(0);
  const running = run.status === "running" && active;
  useEffect(() => {
    if (!running || run.startedAt === undefined) return;
    const timer = window.setInterval(() => tick((value) => value + 1), 1_000);
    return () => window.clearInterval(timer);
  }, [run.startedAt, running]);
  if (!running || !run.startedAt) return 0;
  return Math.max(0, Math.round((Date.now() - run.startedAt) / 1000));
}

function alphaColor(color: string, percent: number): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) {
    const alpha = Math.round((percent / 100) * 255)
      .toString(16)
      .padStart(2, "0");
    return `${color}${alpha}`;
  }
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}
