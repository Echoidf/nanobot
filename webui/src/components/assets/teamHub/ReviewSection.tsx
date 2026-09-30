import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TeamAssetsPayload } from "@/lib/types";

import { TeamEmptyState } from "./shared";

export function ReviewSection({
  submissions,
  busy,
  onApprove,
  onReject,
}: {
  submissions: TeamAssetsPayload["submissions"];
  busy: string;
  onApprove: (submissionId: string, version: string) => void;
  onReject: (submissionId: string) => void;
}) {
  const { t } = useTranslation();
  const [versions, setVersions] = useState<Record<string, string>>({});

  if (!submissions.length) {
    return (
      <TeamEmptyState
        message={t("assets.teamHub.noPending", {
          defaultValue: "No pending submissions. Team members can submit assets to this instance.",
        })}
      />
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {submissions.map((submission) => (
        <li
          key={submission.submission_id}
          className="flex flex-col gap-3 rounded-control border border-border/55 bg-settings-surface px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
              {submission.asset_id}
              <span className="font-mono text-[11px] font-normal text-muted-foreground">
                {submission.asset_type} v{submission.version}
              </span>
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
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Input
              value={versions[submission.submission_id] ?? submission.version}
              onChange={(event) =>
                setVersions((current) => ({
                  ...current,
                  [submission.submission_id]: event.target.value,
                }))
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
          </div>
        </li>
      ))}
    </ul>
  );
}
