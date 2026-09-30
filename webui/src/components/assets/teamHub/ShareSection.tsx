import { useState } from "react";
import { Send } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TeamAssetKind } from "@/lib/types";

import { AssetCombobox } from "./AssetCombobox";

export interface SubmitRequest {
  kind: TeamAssetKind;
  asset_id: string;
  version: string;
  submitter: string;
  note: string;
}

/**
 * Offer one local asset to the instance the user is currently inside.
 * The target is implicit, so there is no instance picker here by design.
 */
export function ShareSection({
  targetName,
  localSkillNames,
  localMcpNames,
  busy,
  onSubmit,
}: {
  targetName: string;
  localSkillNames: string[];
  localMcpNames: string[];
  busy: string;
  onSubmit: (input: SubmitRequest) => void;
}) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<TeamAssetKind>("skill");
  const [assetId, setAssetId] = useState("");
  const [version, setVersion] = useState("");
  const [submitter, setSubmitter] = useState("");
  const [note, setNote] = useState("");

  const options = kind === "skill" ? localSkillNames : localMcpNames;
  const ready = assetId.trim() && version.trim() && submitter.trim();

  const pick = (next: TeamAssetKind) => {
    setKind(next);
    setAssetId("");
  };

  return (
    <form
      className="grid gap-3 rounded-panel border border-border/55 bg-settings-surface p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;
        onSubmit({
          kind,
          asset_id: assetId.trim(),
          version: version.trim(),
          submitter: submitter.trim(),
          note: note.trim(),
        });
        setVersion("");
        setNote("");
      }}
    >
      <div>
        <h3 className="text-sm font-semibold text-foreground">
          {t("assets.teamHub.shareWith", {
            defaultValue: "Share an asset with {{name}}",
            name: targetName,
          })}
        </h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {t("assets.teamHub.shareHint", {
            defaultValue:
              "It lands in their review queue. Nothing is published until a reviewer approves it.",
          })}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
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
        <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
          {t("assets.teamHub.submitter", { defaultValue: "Your name" })}
          <Input
            value={submitter}
            onChange={(event) => setSubmitter(event.target.value)}
            placeholder={t("assets.teamHub.submitterPlaceholder", { defaultValue: "name@team" })}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
        {t("assets.teamHub.note", { defaultValue: "Note for reviewers (optional)" })}
        <Input value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <div>
        <Button type="submit" size="sm" disabled={!ready || busy !== ""}>
          <Send className="h-4 w-4" aria-hidden />
          {t("assets.teamHub.submitNow", { defaultValue: "Submit for review" })}
        </Button>
      </div>
    </form>
  );
}
