import { useState } from "react";
import { ArrowRight, CheckCircle2, Loader2, Plus, Server, Trash2, Unlink } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TeamInstanceInfo } from "@/lib/types";

import { TeamEmptyState } from "./shared";

export interface InstanceTarget {
  kind: "self" | "remote";
  id: string;
  name: string;
  baseUrl: string;
  description: string;
  publishedCount?: number;
  pendingCount?: number;
}

export function InstanceList({
  targets,
  busy,
  probing,
  probeResult,
  onOpen,
  onBind,
  onProbe,
  onRemove,
}: {
  targets: InstanceTarget[];
  busy: string;
  probing: boolean;
  probeResult: TeamInstanceInfo | null;
  onOpen: (id: string) => void;
  onBind: (baseUrl: string) => void;
  onProbe: (baseUrl: string) => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [url, setUrl] = useState("");
  const canSubmit = url.trim().length > 0 && !probing && busy === "";

  return (
    <div className="flex flex-col gap-5">
      {targets.length ? (
        <ul className="grid gap-2 sm:grid-cols-2">
          {targets.map((target) => (
            <li key={`${target.kind}:${target.id}`}>
              <button
                type="button"
                onClick={() => onOpen(target.id)}
                className="group flex w-full flex-col gap-2 rounded-panel border border-border/55 bg-settings-surface px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/30"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    {target.kind === "self" ? (
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-[10px] font-semibold text-primary">
                        ME
                      </span>
                    ) : (
                      <Server className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    )}
                    <span className="truncate text-sm font-medium text-foreground">
                      {target.name}
                    </span>
                  </div>
                  <ArrowRight
                    className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                    aria-hidden
                  />
                </div>
                {target.description ? (
                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    {target.description}
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center gap-1.5">
                  {target.kind === "self" ? (
                    <span className="rounded-full bg-muted/70 px-2 py-0.5 text-[10px] text-muted-foreground">
                      {t("assets.teamHub.selfBadge", { defaultValue: "This instance" })}
                    </span>
                  ) : null}
                  {target.publishedCount !== undefined ? (
                    <span className="rounded-full bg-muted/70 px-2 py-0.5 text-[10px] text-muted-foreground">
                      {t("assets.teamHub.publishedBadge", {
                        defaultValue: "{{count}} published",
                        count: target.publishedCount,
                      })}
                    </span>
                  ) : null}
                  {target.pendingCount ? (
                    <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
                      {t("assets.teamHub.pendingBadge", {
                        defaultValue: "{{count}} to review",
                        count: target.pendingCount,
                      })}
                    </span>
                  ) : null}
                </div>
                {target.kind === "remote" ? (
                  <p className="truncate font-mono text-[10px] text-muted-foreground/80">
                    {target.baseUrl}
                  </p>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <TeamEmptyState
          message={t("assets.teamHub.noInstances", {
            defaultValue:
              "No team instance yet. Bind one by pasting its asset server address below.",
          })}
        />
      )}

      <form
        className="rounded-panel border border-border/55 bg-settings-surface p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) return;
          onBind(url.trim());
          setUrl("");
        }}
      >
        <h3 className="text-sm font-semibold text-foreground">
          {t("assets.teamHub.addInstance", { defaultValue: "Bind a team instance" })}
        </h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {t("assets.teamHub.addInstanceHint", {
            defaultValue:
              "Paste the address of a team's asset server. Its name and id are read from the server, so you do not need to know them.",
          })}
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Input
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              if (probeResult) onProbe("");
            }}
            onBlur={() => {
              const trimmed = url.trim();
              if (trimmed && !probing) onProbe(trimmed);
            }}
            placeholder="http://team-a.internal:18791"
            inputMode="url"
            aria-label={t("assets.teamHub.instanceUrl", { defaultValue: "Team instance address" })}
          />
          <Button type="submit" size="sm" disabled={!canSubmit}>
            {probing ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Plus className="h-4 w-4" aria-hidden />
            )}
            {t("assets.teamHub.bind", { defaultValue: "Bind" })}
          </Button>
        </div>
        {probeResult ? (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">
              {t("assets.teamHub.probeOk", {
                defaultValue: "Found {{name}} ({{id}})",
                name: probeResult.name || probeResult.instance_id,
                id: probeResult.instance_id,
              })}
            </span>
          </p>
        ) : null}
      </form>

      {targets.some((target) => target.kind === "remote") ? (
        <div className="rounded-panel border border-border/55 bg-settings-surface p-4">
          <h3 className="text-sm font-semibold text-foreground">
            {t("assets.teamHub.manageBindings", { defaultValue: "Manage bindings" })}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("assets.teamHub.manageHint", {
              defaultValue: "Unbinding keeps assets you already installed from that team.",
            })}
          </p>
          <ul className="mt-3 flex flex-col gap-1.5">
            {targets
              .filter((target) => target.kind === "remote")
              .map((target) => (
                <li
                  key={`row:${target.id}`}
                  className="flex items-center justify-between gap-2 rounded-control border border-border/55 bg-muted/20 px-3 py-1.5"
                >
                  <span className="min-w-0 truncate text-xs text-foreground">{target.name}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy !== ""}
                    onClick={() => onRemove(target.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    <span className="sr-only">
                      {t("assets.teamHub.unbind", { defaultValue: "Unbind" })}
                    </span>
                  </Button>
                </li>
              ))}
          </ul>
        </div>
      ) : null}

      <p className="flex items-start gap-1.5 text-[11px] leading-4 text-muted-foreground/80">
        <Unlink className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
        {t("assets.teamHub.localOnlyNote", {
          defaultValue:
            "Binding and asset changes are only accepted from a browser on this machine.",
        })}
      </p>
    </div>
  );
}
