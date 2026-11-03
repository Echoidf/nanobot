import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TeamAssetsPayload, TeamSubmission } from "@/lib/types";

import { TeamEmptyState, formatTime } from "./shared";

function SubmissionRow({
  submission,
  busy,
  versions,
  onVersionChange,
  onApprove,
  onReject,
  onDelete,
}: {
  submission: TeamSubmission;
  busy: string;
  versions: Record<string, string>;
  onVersionChange: (submissionId: string, version: string) => void;
  onApprove: (submissionId: string, version: string) => void;
  onReject: (submissionId: string) => void;
  onDelete: (submissionId: string) => void;
}) {
  const { t } = useTranslation();
  const pending = submission.status === "pending";

  return (
    <li className="flex flex-col gap-3 rounded-control border border-border/55 bg-settings-surface px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
          {submission.asset_id}
          <span className="font-mono text-[11px] font-normal text-muted-foreground">
            {submission.asset_type} v{submission.version}
          </span>
          <StatusBadge status={submission.status} />
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("assets.teamHub.by", { defaultValue: "From {{who}}", who: submission.submitter })}
          {submission.note ? ` · ${submission.note}` : ""}
        </p>
        {submission.preview ? (
          <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
            {submission.preview}
          </p>
        ) : null}
        {!pending && (submission.reviewer || submission.reviewed_at) ? (
          <p className="mt-0.5 text-[11px] text-muted-foreground/80">
            {t("assets.teamHub.reviewedBy", {
              defaultValue: "Reviewed by {{who}}{{when}}",
              who: submission.reviewer || "—",
              when: submission.reviewed_at ? ` · ${formatTime(submission.reviewed_at)}` : "",
            })}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {pending ? (
          <>
            <Input
              value={versions[submission.submission_id] ?? submission.version}
              onChange={(event) =>
                onVersionChange(submission.submission_id, event.target.value)
              }
              className="h-9 w-28"
              aria-label={t("assets.teamHub.publishVersion", { defaultValue: "Publish as version" })}
            />
            <Button
              type="button"
              size="sm"
              disabled={busy !== ""}
              onClick={() =>
                onApprove(
                  submission.submission_id,
                  versions[submission.submission_id] ?? submission.version,
                )
              }
            >
              {t("assets.teamHub.approve", { defaultValue: "Approve" })}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy !== ""}
              onClick={() => onReject(submission.submission_id)}
            >
              {t("assets.teamHub.reject", { defaultValue: "Reject" })}
            </Button>
          </>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy !== ""}
            onClick={() => onDelete(submission.submission_id)}
          >
            {t("assets.teamHub.deleteRecord", { defaultValue: "Delete record" })}
          </Button>
        )}
      </div>
    </li>
  );
}

function StatusBadge({ status }: { status: TeamSubmission["status"] }) {
  const { t } = useTranslation();
  if (status === "approved") {
    return (
      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
        {t("assets.teamHub.statusApproved", { defaultValue: "Approved" })}
      </span>
    );
  }
  if (status === "rejected") {
    return (
      <span className="rounded-full bg-muted/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
        {t("assets.teamHub.statusRejected", { defaultValue: "Rejected" })}
      </span>
    );
  }
  return (
    <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
      {t("assets.teamHub.statusPending", { defaultValue: "Pending" })}
    </span>
  );
}

export function ReviewSection({
  submissions,
  busy,
  onApprove,
  onReject,
  onDelete,
}: {
  submissions: TeamAssetsPayload["submissions"];
  busy: string;
  onApprove: (submissionId: string, version: string) => void;
  onReject: (submissionId: string) => void;
  onDelete: (submissionId: string) => void;
}) {
  const { t } = useTranslation();
  const [versions, setVersions] = useState<Record<string, string>>({});

  if (!submissions.length) {
    return (
      <TeamEmptyState
        message={t("assets.teamHub.noPending", {
          defaultValue: "No submissions yet. Team members can submit assets to this instance.",
        })}
      />
    );
  }

  const pending = submissions.filter((item) => item.status === "pending");
  const reviewed = submissions.filter((item) => item.status !== "pending");
  const setVersion = (submissionId: string, version: string) =>
    setVersions((current) => ({ ...current, [submissionId]: version }));

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <h4 className="text-xs font-semibold text-foreground">
          {t("assets.teamHub.pendingTitle", {
            defaultValue: "Pending ({{count}})",
            count: pending.length,
          })}
        </h4>
        {pending.length ? (
          <ul className="flex flex-col gap-2">
            {pending.map((submission) => (
              <SubmissionRow
                key={submission.submission_id}
                submission={submission}
                busy={busy}
                versions={versions}
                onVersionChange={setVersion}
                onApprove={onApprove}
                onReject={onReject}
                onDelete={onDelete}
              />
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t("assets.teamHub.noPendingShort", { defaultValue: "Nothing waiting for review." })}
          </p>
        )}
      </section>
      {reviewed.length ? (
        <section className="flex flex-col gap-2">
          <h4 className="text-xs font-semibold text-foreground">
            {t("assets.teamHub.historyTitle", {
              defaultValue: "History ({{count}})",
              count: reviewed.length,
            })}
          </h4>
          <ul className="flex flex-col gap-2">
            {reviewed.map((submission) => (
              <SubmissionRow
                key={submission.submission_id}
                submission={submission}
                busy={busy}
                versions={versions}
                onVersionChange={setVersion}
                onApprove={onApprove}
                onReject={onReject}
                onDelete={onDelete}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
