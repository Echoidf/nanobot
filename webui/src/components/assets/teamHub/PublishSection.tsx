import { useState } from "react";
import { UploadCloud } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TeamAssetKind, TeamPublishedAsset } from "@/lib/types";

import { AssetCombobox } from "./AssetCombobox";

export interface PublishRequest {
  kind: TeamAssetKind;
  asset_id: string;
  version: string;
  description?: string;
}

export function PublishSection({
  localSkillNames,
  localMcpNames,
  published,
  busy,
  onPublish,
}: {
  localSkillNames: string[];
  localMcpNames: string[];
  published: { skills: TeamPublishedAsset[]; mcp: TeamPublishedAsset[] };
  busy: string;
  onPublish: (input: PublishRequest) => void;
}) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<TeamAssetKind>("skill");
  const [assetId, setAssetId] = useState("");
  const [version, setVersion] = useState("");
  const [description, setDescription] = useState("");

  const options = kind === "skill" ? localSkillNames : localMcpNames;
  const taken = new Set(
    (kind === "skill" ? published.skills : published.mcp).map((row) => `${row.id}@${row.version}`),
  );
  const duplicate = assetId.trim() && version.trim() && taken.has(`${assetId.trim()}@${version.trim()}`);
  const ready = assetId.trim() && version.trim() && !duplicate;

  const pick = (next: TeamAssetKind) => {
    setKind(next);
    setAssetId("");
  };

  return (
    <div className="flex flex-col gap-4">
      <form
        className="grid gap-3 rounded-panel border border-border/55 bg-settings-surface p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!ready) return;
          onPublish({
            kind,
            asset_id: assetId.trim(),
            version: version.trim(),
            description: description.trim(),
          });
          setVersion("");
          setDescription("");
        }}
      >
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            {t("assets.teamHub.publishHere", { defaultValue: "Publish a local asset" })}
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {t("assets.teamHub.publishHint", {
              defaultValue:
                "Everyone bound to this instance can then browse and install that exact version. MCP credentials are never published.",
            })}
          </p>
        </div>

        <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
          {t("assets.teamHub.assetType", { defaultValue: "Asset type" })}
          <div className="flex gap-1.5">
            {(["skill", "mcp"] as const).map((option) => (
              <Button
                key={option}
                type="button"
                size="sm"
                variant={kind === option ? "default" : "outline"}
                aria-pressed={kind === option}
                onClick={() => pick(option)}
              >
                {option === "skill"
                  ? t("assets.skills", { defaultValue: "Skills" })
                  : t("assets.mcp", { defaultValue: "MCP tools" })}
              </Button>
            ))}
          </div>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
            {t("assets.teamHub.localAsset", { defaultValue: "Local asset" })}
            <AssetCombobox
              value={assetId}
              options={options}
              onChange={setAssetId}
              kindLabel={t("assets.teamHub.assetType", { defaultValue: "Asset type" })}
              placeholder={t("assets.teamHub.pickAsset", { defaultValue: "Choose an asset…" })}
              searchPlaceholder={t("assets.teamHub.searchAsset", { defaultValue: "Search assets" })}
              emptyLabel={t("assets.teamHub.nothingLocal", { defaultValue: "Nothing available yet." })}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
            {t("assets.teamHub.version", { defaultValue: "Fixed version" })}
            <Input
              value={version}
              onChange={(event) => setVersion(event.target.value)}
              placeholder="1.0.0"
            />
          </label>
        </div>

        <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
          {t("assets.teamHub.description", { defaultValue: "Description (optional)" })}
          <Input value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>

        {duplicate ? (
          <p className="text-xs text-destructive">
            {t("assets.teamHub.duplicate", { defaultValue: "That version is already published." })}
          </p>
        ) : null}

        <div>
          <Button type="submit" size="sm" disabled={!ready || busy !== ""}>
            <UploadCloud className="h-4 w-4" aria-hidden />
            {t("assets.teamHub.publishNow", { defaultValue: "Publish" })}
          </Button>
        </div>
      </form>

      <div className="rounded-panel border border-border/55 bg-settings-surface p-4">
        <h3 className="text-sm font-semibold text-foreground">
          {t("assets.teamHub.publishedList", { defaultValue: "Published here" })}
        </h3>
        <ul className="mt-2 flex flex-col gap-1">
          {[...published.skills, ...published.mcp].map((row) => (
            <li key={`${row.kind}:${row.id}@${row.version}`} className="flex items-center gap-2 text-xs">
              <span className="rounded-full bg-muted/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {row.kind}
              </span>
              <span className="truncate text-foreground">{row.id}</span>
              <span className="font-mono text-muted-foreground">v{row.version}</span>
            </li>
          ))}
          {!published.skills.length && !published.mcp.length ? (
            <li className="text-xs text-muted-foreground">
              {t("assets.teamHub.nothingPublished", { defaultValue: "Nothing published yet." })}
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
