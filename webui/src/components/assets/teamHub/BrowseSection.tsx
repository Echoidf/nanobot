import { useMemo } from "react";
import { Loader2, Plug, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import type { TeamCatalogAsset, TeamCatalogPayload } from "@/lib/types";

import { TeamEmptyState, TeamPending } from "./shared";

export function BrowseSection({
  catalog,
  busy,
  loading,
  onReload,
  onInstall,
}: {
  catalog: TeamCatalogPayload | null;
  busy: string;
  loading: boolean;
  onReload: () => void;
  onInstall: (asset: TeamCatalogAsset) => void;
}) {
  const { t } = useTranslation();
  const rows = useMemo(
    () => [...(catalog?.skills ?? []), ...(catalog?.mcp ?? [])],
    [catalog],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={busy !== ""} onClick={onReload}>
          <RefreshCw className="h-4 w-4" aria-hidden />
          {t("assets.teamHub.reload", { defaultValue: "Reload" })}
        </Button>
        {catalog?.instance?.description ? (
          <p className="min-w-0 truncate text-xs text-muted-foreground">
            {catalog.instance.description}
          </p>
        ) : null}
      </div>

      {busy === "catalog" || loading ? (
        <TeamPending label={t("assets.teamHub.loading", { defaultValue: "Loading catalog…" })} />
      ) : null}

      {!loading && busy !== "catalog" && rows.length === 0 ? (
        <TeamEmptyState
          message={t("assets.teamHub.emptyCatalog", {
            defaultValue: "This team instance has not published any assets yet.",
          })}
        />
      ) : null}

      <ul className="flex flex-col gap-2">
        {rows.map((asset) => {
          const key = `${asset.kind}:${asset.id}`;
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
                  {asset.id}
                  <span className="font-mono text-[11px] font-normal text-muted-foreground">
                    v{asset.version}
                  </span>
                </p>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                  {asset.description ||
                    t("assets.teamHub.noDescription", { defaultValue: "No description" })}
                </p>
                {asset.installed ? (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {asset.upgradable
                      ? t("assets.teamHub.upgradable", {
                          defaultValue: "Installed v{{version}} — update available.",
                          version: asset.installed_version,
                        })
                      : t("assets.teamHub.installedVersion", {
                          defaultValue: "Installed v{{version}}.",
                          version: asset.installed_version,
                        })}
                  </p>
                ) : null}
              </div>
              <Button
                type="button"
                size="sm"
                variant={asset.installed && !asset.upgradable ? "outline" : "default"}
                disabled={busy !== ""}
                onClick={() => onInstall(asset)}
              >
                {busy === key ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                {asset.upgradable
                  ? t("assets.teamHub.update", { defaultValue: "Update" })
                  : asset.installed
                    ? t("assets.teamHub.reinstall", { defaultValue: "Reinstall" })
                    : t("assets.teamHub.install", { defaultValue: "Install" })}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
