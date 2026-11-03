import { Download, Loader2, Plug, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import type { TeamAssetKind, TeamPublishedAsset } from "@/lib/types";

import { TeamEmptyState } from "./shared";

export interface SnapshotAction {
  kind: TeamAssetKind;
  id: string;
  version: string;
}

/**
 * Fixed-version snapshots served by this instance: approved submissions
 * from other members (installable here with one click) plus legacy local
 * publishes kept for old consumers. Takedown removes the version for
 * everyone; copies already installed elsewhere are untouched.
 */
export function SnapshotsSection({
  snapshots,
  busy,
  onInstall,
  onUnpublish,
}: {
  snapshots: { skills: TeamPublishedAsset[]; mcp: TeamPublishedAsset[] };
  busy: string;
  onInstall: (asset: SnapshotAction) => void;
  onUnpublish: (asset: SnapshotAction) => void;
}) {
  const { t } = useTranslation();
  const rows = [...snapshots.skills, ...snapshots.mcp];

  if (!rows.length) {
    return (
      <TeamEmptyState
        message={t("assets.teamHub.nothingApproved", {
          defaultValue:
            "Nothing approved yet. Submissions from other members appear here after review.",
        })}
      />
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {rows.map((asset) => {
        const key = `${asset.kind}:${asset.id}@${asset.version}`;
        const action = { kind: asset.kind, id: asset.id, version: asset.version };
        return (
          <li
            key={key}
            className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-border/55 bg-settings-surface px-3 py-2.5"
          >
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                {asset.kind === "mcp" ? (
                  <Plug className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                ) : null}
                <span className="truncate">{asset.id}</span>
                <span className="shrink-0 font-mono text-[11px] font-normal text-muted-foreground">
                  v{asset.version}
                </span>
              </p>
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                {asset.description ||
                  t("assets.teamHub.noDescription", { defaultValue: "No description" })}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                {asset.origin === "remote"
                  ? t("assets.teamHub.originRemote", { defaultValue: "Remote" })
                  : t("assets.teamHub.originLocal", { defaultValue: "Local" })}
              </span>
              {asset.origin === "remote" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy !== ""}
                  onClick={() => onInstall(action)}
                  title={t("assets.teamHub.installHere", {
                    defaultValue: "Install this version on this instance",
                  })}
                >
                  {busy === `install-local:${key}` ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Download className="h-4 w-4" aria-hidden />
                  )}
                  {t("assets.teamHub.installHereShort", { defaultValue: "Install here" })}
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy !== ""}
                onClick={() => onUnpublish(action)}
                title={t("assets.teamHub.unpublish", {
                  defaultValue: "Take down this version for everyone",
                })}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                <span className="sr-only">
                  {t("assets.teamHub.unpublish", {
                    defaultValue: "Take down this version for everyone",
                  })}
                </span>
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
