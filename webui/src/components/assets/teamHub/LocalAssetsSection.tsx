import { Plug } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { TeamLiveAsset } from "@/lib/types";

import { TeamEmptyState } from "./shared";

function shortVersion(version: string): string {
  return version.length > 14 ? `${version.slice(0, 10)}…` : version;
}

/**
 * Live local assets of this instance. They are visible to every bound
 * member without publishing; this list is informational and has no
 * actions by design.
 */
export function LocalAssetsSection({
  assets,
}: {
  assets: { skills: TeamLiveAsset[]; mcp: TeamLiveAsset[] };
}) {
  const { t } = useTranslation();
  const rows = [...assets.skills, ...assets.mcp];

  if (!rows.length) {
    return (
      <TeamEmptyState
        message={t("assets.teamHub.nothingLocalShared", {
          defaultValue:
            "This instance has no skills or MCP servers to share yet.",
        })}
      />
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {rows.map((asset) => (
        <li
          key={`${asset.kind}:${asset.id}`}
          className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-border/55 bg-settings-surface px-3 py-2.5"
        >
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
              {asset.kind === "mcp" ? (
                <Plug className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              ) : null}
              <span className="truncate">{asset.id}</span>
              <span className="shrink-0 font-mono text-[11px] font-normal text-muted-foreground">
                {shortVersion(asset.version)}
              </span>
            </p>
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              {asset.description ||
                t("assets.teamHub.noDescription", { defaultValue: "No description" })}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
              {t("assets.teamHub.originLocal", { defaultValue: "Local" })}
            </span>
            {!asset.enabled ? (
              <span className="rounded-full bg-muted/70 px-2 py-0.5 text-[10px] text-muted-foreground">
                {t("assets.teamHub.disabledBadge", { defaultValue: "Disabled" })}
              </span>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
