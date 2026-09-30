import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  approveTeamSubmission,
  fetchSkills,
  fetchTeamAssets,
  fetchTeamCatalog,
  installTeamAsset,
  probeTeamInstance,
  publishTeamAsset,
  removeTeamAssetSource,
  rejectTeamSubmission,
  saveTeamAssetSource,
  submitTeamAsset,
} from "@/lib/api";
import { notifySkillsChanged } from "@/lib/skill-events";
import type {
  TeamAssetsPayload,
  TeamCatalogAsset,
  TeamCatalogPayload,
  TeamInstanceInfo,
} from "@/lib/types";
import { useClient } from "@/providers/ClientProvider";

import { BrowseSection } from "./teamHub/BrowseSection";
import { InstanceDetail } from "./teamHub/InstanceDetail";
import { InstanceList, type InstanceTarget } from "./teamHub/InstanceList";
import { PublishSection, type PublishRequest } from "./teamHub/PublishSection";
import { ReviewSection } from "./teamHub/ReviewSection";
import { ShareSection, type SubmitRequest } from "./teamHub/ShareSection";
import { describeError } from "./teamHub/shared";

const SELF_ID = "__self__";

/**
 * Team hub.
 *
 * Two levels on purpose: browsing and sharing are meaningless without a
 * target instance, so they live *inside* a selected instance rather than
 * beside the instance list. This instance's own publishing and review live
 * under its own "self" entry, since they describe what we serve, not what
 * we consume.
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

  const failed = (reason: unknown) =>
    setError(
      describeError(
        reason,
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
  const installedCount = payload?.installed?.length ?? 0;

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
          publisher.published.skills.length + publisher.published.mcp.length,
        pendingCount: submissions.length,
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
  }, [publisher, sources, submissions.length, t]);

  const target = targets.find((row) => row.id === selected) ?? null;

  const tabs = useMemo(() => {
    if (!target) return [];
    return target.kind === "self"
      ? [
          {
            value: "publish",
            label: t("assets.teamHub.publish", { defaultValue: "Publish" }),
          },
          {
            value: "review",
            label: `${t("assets.teamHub.review", { defaultValue: "Review" })}${
              submissions.length ? ` (${submissions.length})` : ""
            }`,
          },
        ]
      : [
          { value: "browse", label: t("assets.teamHub.browse", { defaultValue: "Browse" }) },
          { value: "share", label: t("assets.teamHub.share", { defaultValue: "Share" }) },
        ];
  }, [target, submissions.length, t]);

  // Default to the first section whenever the selected instance changes.
  useEffect(() => {
    if (!target) {
      setSection("");
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

  const share = (input: SubmitRequest) => {
    if (target?.kind !== "remote") return;
    void run("submit", async () => {
      await submitTeamAsset(client, { source_id: target.id, ...input });
      setNotice(
        t("assets.teamHub.submitted", {
          defaultValue: "Submitted {{id}} to {{target}} for review.",
          id: input.asset_id,
          target: target.name,
        }),
      );
      return undefined;
    });
  };

  const publish = (input: PublishRequest) => {
    void run("publish", () => publishTeamAsset(client, input));
  };

  return (
    <div className="flex flex-col gap-5">
      {error ? (
        <p className="rounded-control border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
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
          {section === "browse" ? (
            <BrowseSection
              catalog={target.id === catalog?.source_id ? catalog : null}
              busy={busy}
              loading={loading || busy === "catalog"}
              onReload={() => void loadCatalog(target.id)}
              onInstall={install}
            />
          ) : null}
          {section === "share" ? (
            <ShareSection
              targetName={target.name}
              localSkillNames={localSkillNames}
              localMcpNames={localMcpNames}
              busy={busy}
              onSubmit={share}
            />
          ) : null}
          {section === "publish" ? (
            <PublishSection
              localSkillNames={localSkillNames}
              localMcpNames={localMcpNames}
              published={publisher?.published ?? { skills: [], mcp: [] }}
              busy={busy}
              onPublish={publish}
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
