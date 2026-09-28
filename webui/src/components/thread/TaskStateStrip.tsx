import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import type { TaskStateWsPayload } from "@/lib/types";
import { cn } from "@/lib/utils";

const TASK_STATUS_LABELS: Record<string, string> = {
  pending: "待处理",
  running: "进行中",
  completed: "已完成",
  cancelled: "已取消",
  blocked: "阻塞",
  failed: "失败",
};

const ACTIVE_STATUS = new Set(["pending", "running"]);

function statusTone(status: string): string {
  switch (status) {
    case "completed":
      return "text-emerald-600 dark:text-emerald-400";
    case "cancelled":
      return "text-muted-foreground line-through";
    case "blocked":
    case "failed":
      return "text-destructive";
    default:
      return "text-muted-foreground";
  }
}

function statusGlyph(status: string): string {
  switch (status) {
    case "completed":
      return "✓";
    case "cancelled":
      return "×";
    case "blocked":
      return "!";
    case "failed":
      return "✕";
    case "running":
      return "●";
    default:
      return "○";
  }
}

interface TaskStateStripProps {
  taskState?: TaskStateWsPayload;
}

export function TaskStateStrip({ taskState }: TaskStateStripProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  if (!taskState || !taskState.active || !taskState.tasks.length) {
    return null;
  }

  const openTasks = taskState.tasks.filter((task) => ACTIVE_STATUS.has(task.status));
  const current = taskState.tasks.find((task) => task.status === "running") ?? openTasks[0];
  const completed = taskState.tasks.filter((task) => task.status === "completed").length;
  const fraction = Math.round((completed / taskState.tasks.length) * 100);

  return (
    <div className="mx-2.5 mt-2.5 overflow-hidden rounded-lg border border-border/55 bg-card/60">
      <button
        type="button"
        data-testid="task-state-strip"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center text-[11px] font-medium",
            current?.status === "running" ? "text-primary" : "text-muted-foreground",
          )}
          aria-hidden
        >
          {current ? statusGlyph(current.status) : "○"}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[12.5px] font-medium text-foreground/90">
            {current ? current.title : t("thread.composer.taskStatePending")}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {t("thread.composer.taskStateProgress", {
              completed,
              total: taskState.tasks.length,
              percent: fraction,
            })}
          </span>
        </span>
        <span
          className="h-1 flex-1 max-w-[72px] overflow-hidden rounded-full bg-muted"
          aria-hidden
        >
          <span
            className="block h-full rounded-full bg-primary transition-[width] duration-300 ease-out motion-reduce:transition-none"
            style={{ width: `${fraction}%` }}
          />
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
            expanded && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {expanded ? (
        <ol
          data-testid="task-state-list"
          className="max-h-[46vh] overflow-y-auto border-t border-border/45 px-3 py-1.5 text-[12px]"
        >
          {taskState.tasks.map((task) => (
            <li
              key={task.id}
              data-testid={`task-state-item-${task.id}`}
              className="grid grid-cols-[1.125rem_minmax(0,1fr)] gap-2 py-1"
            >
              <span
                className={cn("pt-[2px] text-[11px]", statusTone(task.status))}
                aria-hidden
              >
                {statusGlyph(task.status)}
              </span>
              <div className="min-w-0">
                <div
                  className={cn(
                    "truncate font-medium",
                    task.status === "cancelled" ? "text-muted-foreground line-through" : "text-foreground/85",
                  )}
                  title={task.title}
                >
                  {task.title}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {TASK_STATUS_LABELS[task.status] ?? task.status}
                  {task.note ? <span className="text-muted-foreground/80"> · {task.note}</span> : null}
                </div>
                {task.evidence ? (
                  <div className="truncate text-[11px] text-muted-foreground/80">
                    {t("thread.composer.taskStateEvidence")}: {task.evidence}
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
