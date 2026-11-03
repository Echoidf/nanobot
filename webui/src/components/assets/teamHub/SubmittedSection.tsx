import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import type { TeamSubmitStatus, TeamSubmittedRecord } from "@/lib/types";

import { TeamEmptyState, formatTime } from "./shared";

function StatusBadge({ status }: { status: TeamSubmitStatus }) {
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
  if (status === "gone") {
    return (
      <span className="rounded-full bg-muted/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
        {t("assets.teamHub.statusGone", { defaultValue: "No longer on peer" })}
      </span>
    );
  }
  return (
    <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
      {t("assets.teamHub.statusPending", { defaultValue: "Pending" })}
    </span>
  );
}

/**
 * Assets this instance submitted to one remote team instance, with the
 * review state as of the last check. Status is refreshed on demand so
 * the peer is only queried when the user asks.
 */
export function SubmittedSection({
  records,
  busy,
  onRefresh,
}: {
  records: TeamSubmittedRecord[];
  busy: string;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold text-foreground">
          {t("assets.teamHub.mySubmissions", {
            defaultValue: "My submissions ({{count}})",
            count: records.length,
          })}
        </h4>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy !== "" || records.length === 0}
          onClick={onRefresh}
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
          {t("assets.teamHub.refreshStatus", { defaultValue: "Refresh status" })}
        </Button>
      </div>

      {records.length === 0 ? (
        <TeamEmptyState
          message={t("assets.teamHub.noSubmissions", {
            defaultValue: "You have not submitted anything to this instance yet.",
          })}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {records.map((record) => (
            <li
              key={record.submission_id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-border/55 bg-settings-surface px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                  <span className="truncate">{record.id}</span>
                  <span className="shrink-0 font-mono text-[11px] font-normal text-muted-foreground">
                    {record.kind} v{record.version}
                  </span>
                  <StatusBadge status={record.status} />
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("assets.teamHub.submittedAt", {
                    defaultValue: "By {{who}} · {{when}}",
                    who: record.submitter,
                    when: formatTime(record.submitted_at),
                  })}
                  {record.note ? ` · ${record.note}` : ""}
                </p>
                <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">
                  {record.submission_id}
                </p>
                {record.check_error ? (
                  <p className="mt-0.5 text-[11px] text-destructive">
                    {t("assets.teamHub.statusCheckError", {
                      defaultValue: "Status check failed: {{message}}",
                      message: record.check_error,
                    })}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
