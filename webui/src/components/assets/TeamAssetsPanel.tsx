import { useCallback, useEffect, useMemo, useState } from "react";
import { Send } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  approveTeamSubmission,
  deleteTeamSubmission,
  fetchSkills,
  fetchTeamAssets,
  fetchTeamCatalog,
  installPublishedToLocal,
  installTeamAsset,
  probeTeamInstance,
  refreshTeamSubmitted,
  removeTeamAssetSource,
  rejectTeamSubmission,
  saveTeamAssetSource,
  submitTeamAsset,
  unpublishTeamAsset,
} from "@/lib/api";
import { notifySkillsChanged } from "@/lib/skill-events";
import type {
  TeamAssetsPayload,
  TeamCatalogAsset,
  TeamCatalogPayload,
  TeamInstanceInfo,
} from "@/lib/types";
import { useClient } from "@/providers/ClientProvider";
import { Button } from "@/components/ui/button";

import { BrowseSection } from "./teamHub/BrowseSection";
import { InstanceDetail } from "./teamHub/InstanceDetail";
import { InstanceList, type InstanceTarget } from "./teamHub/InstanceList";
import { LocalAssetsSection } from "./teamHub/LocalAssetsSection";
import { ReviewSection } from "./teamHub/ReviewSection";
import { SnapshotsSection, type SnapshotAction } from "./teamHub/SnapshotsSection";
import { SubmitDialog, type SubmitRequest } from "./teamHub/SubmitDialog";
import { SubmittedSection } from "./teamHub/SubmittedSection";
import { describeTeamError } from "./teamHub/shared";

const SELF_ID = "__self__";

/**
 * Team hub.
 *
 * Two levels on purpose: browsing and sharing are meaningless without a
 * target instance, so they live *inside* a selected instance rather than
 * beside the instance list. This instance's own local assets, approved
 * snapshots and review history live under its own "self" entry. There is
 * no publish step: local assets are visible to bound members as-is, and
 * remote assets become visible once a reviewer approves them.
 */
export function TeamAssetsPanel({
  localSkillNames,
  localMcpNames,
  onRestart,
}: {
  localSkillNames: string[];
  localMcpNames: string[];
  onRestart: () => void;
}) {
  const { client, getToken } = useClient();
  const { t } = useTranslation();

  const [payload, setPayload] = useState<TeamAssetsPayload | null>(null);
  const [catalog, setCatalog] = useState<TeamCatalogPayload | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [section, setSection] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<TeamInstanceInfo | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  const failed = (reason: unknown) =>
    setError(
      describeTeamError(
        reason,
        t,
        t("assets.teamHub.failed", { defaultValue: "The team asset request failed." }),
      ),
    );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setPayload(await fetchTeamAssets(getToken()));
    } catch (reason) {
      failed(reason);
    } finally {
      setLoading(false);
    }
  }, [getToken, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Serialize one mutation, keeping the shared busy key and status lines. */
  const run = useCallback(
    async (key: string, action: () => Promise<TeamAssetsPayload | undefined>) => {
      setBusy(key);
      setError("");
      setNotice("");
      try {
        const next = await action();
        if (next) setPayload(next);
      } catch (reason) {
        failed(reason);
      } finally {
        setBusy("");
      }
    },
    [t],
  );

  const publisher = payload?.publisher;
  const sources = payload?.sources ?? [];
  const submissions = payload?.submissions ?? [];
  const submitted = payload?.submitted ?? [];
  const installedCount = payload?.installed?.length ?? 0;
  const pendingCount = submissions.filter((item) => item.status === "pending").length;
  const snapshotCount =
    (publisher?.snapshots.skills.length ?? 0) + (publisher?.snapshots.mcp.length ?? 0);

  const targets = useMemo<InstanceTarget[]>(() => {
    const rows: InstanceTarget[] = [];
    if (publisher?.enabled) {
      rows.push({
        kind: "self",
        id: SELF_ID,
        name:
          publisher.name ||
          publisher.instance_id ||
          t("assets.teamHub.thisInstance", { defaultValue: "This instance" }),
        baseUrl: `http://${publisher.host}:${publisher.port}`,
        description: publisher.description,
        publishedCount:
          (publisher.snapshots.skills.length ?? 0) +
          (publisher.snapshots.mcp.length ?? 0),
        pendingCount,
      });
    }
    for (const source of sources) {
      rows.push({
        kind: "remote",
        id: source.id,
        name: source.name || source.id,
        baseUrl: source.base_url,
        description: "",
      });
    }
    return rows;
  }, [publisher, sources, pendingCount, t]);

  const target = targets.find((row) => row.id === selected) ?? null;

  const tabs = useMemo(() => {
    if (!target) return [];
    return target.kind === "self"
      ? [
          {
            value: "local",
            label: t("assets.teamHub.localAssets", { defaultValue: "Local assets" }),
          },
          {
            value: "approved",
            label: t("assets.teamHub.approved", {
              defaultValue: "Approved ({{count}})",
              count: snapshotCount,
            }),
          },
          {
            value: "review",
            label: t("assets.teamHub.review", { defaultValue: "Review" }) +
              (pendingCount ? ` (${pendingCount})` : ""),
          },
        ]
      : [];
  }, [target, snapshotCount, pendingCount, t]);

  // Default to the first section whenever the selected instance changes.
  useEffect(() => {
    if (!target) {
      setSection("");
      return;
    }
    if (target.kind === "remote") {
      setSection("browse");
      return;
    }
    setSection((current) =>
      tabs.some((tab) => tab.value === current) ? current : (tabs[0]?.value ?? ""),
    );
  }, [target, tabs]);

  const loadCatalog = useCallback(
    async (sourceId: string) => {
      if (!sourceId) return;
      setBusy("catalog");
      setError("");
      try {
        setCatalog(await fetchTeamCatalog(getToken(), sourceId));
      } catch (reason) {
        setCatalog(null);
        failed(reason);
      } finally {
        setBusy("");
      }
    },
    [getToken, t],
  );

  useEffect(() => {
    if (target?.kind === "remote" && section === "browse" && catalog?.source_id !== target.id) {
      void loadCatalog(target.id);
    }
  }, [target, section, catalog, loadCatalog]);

  const probe = useCallback(
    async (baseUrl: string) => {
      if (!baseUrl) {
        setProbeResult(null);
        return;
      }
      setProbing(true);
      try {
        setProbeResult(await probeTeamInstance(client, baseUrl));
        setError("");
      } catch {
        setProbeResult(null);
      } finally {
        setProbing(false);
      }
    },
    [client],
  );

  const bind = (baseUrl: string) => {
    void run("bind", async () => {
      const next = await saveTeamAssetSource(client, { base_url: baseUrl });
      setProbeResult(null);
      setNotice(
        t("assets.teamHub.boundOk", {
          defaultValue: "Bound {{id}}.",
          id: probeResult?.instance_id ?? baseUrl,
        }),
      );
      return next;
    });
  };

  const install = (asset: TeamCatalogAsset) => {
    if (target?.kind !== "remote") return;
    void run(`${asset.kind}:${asset.id}`, async () => {
      const next = await installTeamAsset(client, {
        source_id: target.id,
        kind: asset.kind,
        asset_id: asset.id,
        version: asset.version,
        content_hash: asset.content_hash,
      });
      notifySkillsChanged(await fetchSkills(getToken()));
      setNotice(
        t("assets.teamHub.installed", {
          defaultValue: "Installed {{id}} at {{version}}.",
          id: asset.id,
          version: asset.version,
        }),
      );
      if (asset.kind === "mcp") onRestart();
      setCatalog(await fetchTeamCatalog(getToken(), target.id));
      return next;
    });
  };

  const installHere = (asset: SnapshotAction) => {
    void run(`install-local:${asset.kind}:${asset.id}@${asset.version}`, async () => {
      const next = await installPublishedToLocal(client, {
        kind: asset.kind,
        asset_id: asset.id,
        version: asset.version,
      });
      notifySkillsChanged(await fetchSkills(getToken()));
      setNotice(
        t("assets.teamHub.installedHere", {
          defaultValue: "Installed {{id}} at {{version}} on this instance.",
          id: asset.id,
          version: asset.version,
        }),
      );
      if (asset.kind === "mcp") onRestart();
      return next;
    });
  };

  const unpublish = (asset: SnapshotAction) => {
    void run("unpublish", async () => {
      const next = await unpublishTeamAsset(client, {
        kind: asset.kind,
        asset_id: asset.id,
        version: asset.version,
      });
      setNotice(
        t("assets.teamHub.unpublished", {
          defaultValue: "Took down {{id}} at {{version}} for everyone.",
          id: asset.id,
          version: asset.version,
        }),
      );
      return next;
    });
  };

  const share = (input: SubmitRequest) => {
    if (target?.kind !== "remote") return;
    void run("submit", async () => {
      const next = await submitTeamAsset(client, { source_id: target.id, ...input });
      setNotice(
        t("assets.teamHub.submitted", {
          defaultValue: "Submitted {{id}} to {{target}} for review.",
          id: input.asset_id,
          target: target.name,
        }),
      );
      return next;
    });
  };

  const refreshSubmitted = () => {
    void run("refresh-status", () => refreshTeamSubmitted(client));
  };

  return (
    <div className="flex flex-col gap-5">
      {error ? (
        <p className="rounded-control border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-control border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
          {notice}
        </p>
      ) : null}

      {target ? (
        <InstanceDetail
          target={target}
          tabs={tabs}
          active={section}
          onSelectTab={setSection}
          onBack={() => setSelected(null)}
        >
          {target.kind === "remote" ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {t("assets.teamHub.remoteHint", {
                    defaultValue:
                      "Local assets of this instance are listed automatically; approved remote assets appear with a Remote badge.",
                  })}
                </p>
                <Button type="button" size="sm" onClick={() => setShareOpen(true)}>
                  <Send className="h-4 w-4" aria-hidden />
                  {t("assets.teamHub.shareAction", { defaultValue: "Share an asset" })}
                </Button>
              </div>
              <BrowseSection
                catalog={target.id === catalog?.source_id ? catalog : null}
                busy={busy}
                loading={loading || busy === "catalog"}
                onReload={() => void loadCatalog(target.id)}
                onInstall={install}
              />
              <SubmittedSection
                records={submitted.filter((row) => row.target_id === target.id)}
                busy={busy}
                onRefresh={refreshSubmitted}
              />
              <SubmitDialog
                open={shareOpen}
                onOpenChange={setShareOpen}
                targetName={target.name}
                localSkillNames={localSkillNames}
                localMcpNames={localMcpNames}
                busy={busy}
                onSubmit={share}
              />
            </div>
          ) : null}
          {section === "local" ? (
            <LocalAssetsSection
              assets={publisher?.local ?? { skills: [], mcp: [] }}
            />
          ) : null}
          {section === "approved" ? (
            <SnapshotsSection
              snapshots={publisher?.snapshots ?? { skills: [], mcp: [] }}
              busy={busy}
              onInstall={installHere}
              onUnpublish={unpublish}
            />
          ) : null}
          {section === "review" ? (
            <ReviewSection
              submissions={submissions}
              busy={busy}
              onApprove={(submissionId, version) =>
                void run("review", () =>
                  approveTeamSubmission(client, { submission_id: submissionId, version }),
                )
              }
              onReject={(submissionId) =>
                void run("review", () =>
                  rejectTeamSubmission(client, { submission_id: submissionId }),
                )
              }
              onDelete={(submissionId) =>
                void run("review", () => deleteTeamSubmission(client, submissionId))
              }
            />
          ) : null}
        </InstanceDetail>
      ) : (
        <InstanceList
          targets={targets}
          busy={busy}
          probing={probing}
          probeResult={probeResult}
          onOpen={(id) => {
            setSelected(id);
            setCatalog(null);
          }}
          onBind={bind}
          onProbe={(url) => void probe(url)}
          onRemove={(id) => void run("unbind", () => removeTeamAssetSource(client, id))}
        />
      )}

      {!target && installedCount > 0 ? (
        <p className="text-[11px] text-muted-foreground/80">
          {t("assets.teamHub.installedCount", {
            defaultValue: "{{count}} team assets installed on this instance.",
            count: installedCount,
          })}
        </p>
      ) : null}
    </div>
  );
}
