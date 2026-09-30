import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderGit2, MessageSquareText, Pencil, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  displayTitle,
  groupSessions,
  type ChatGroupLabels,
  type SessionGroup,
} from "@/lib/chat-groups";
import { deriveTemporaryChatTitle } from "@/lib/temporary-chat";
import type { ChatSummary, SidebarSortMode } from "@/lib/types";
import { cn } from "@/lib/utils";

const VISIBLE_SESSION_LIMIT = 5;

export interface AgentHistoryStripProps {
  sessions: ChatSummary[];
  temporarySessions?: ChatSummary[];
  activeKey: string | null;
  runningChatIds?: string[];
  updatedChatIds?: string[];
  pinnedKeys?: string[];
  archivedKeys?: string[];
  titleOverrides?: Record<string, string>;
  projectNameOverrides?: Record<string, string>;
  hiddenProjectKeys?: string[];
  sessionOrder?: string[];
  showArchived?: boolean;
  sort?: SidebarSortMode;
  defaultWorkspacePath?: string | null;
  onSelect: (key: string) => void;
  onCloseTemporaryChat?: (key: string) => void;
  onRequestRename?: (key: string, label: string) => void;
  onRequestDelete?: (key: string, label: string) => void;
  className?: string;
}

export function AgentHistoryStrip({
  sessions,
  temporarySessions = [],
  activeKey,
  runningChatIds = [],
  updatedChatIds = [],
  pinnedKeys = [],
  archivedKeys = [],
  titleOverrides = {},
  projectNameOverrides = {},
  hiddenProjectKeys = [],
  sessionOrder = [],
  showArchived = false,
  sort = "updated_desc",
  defaultWorkspacePath = null,
  onSelect,
  onCloseTemporaryChat,
  onRequestRename,
  onRequestDelete,
  className,
}: AgentHistoryStripProps) {
  const { t } = useTranslation();
  const [openProjectId, setOpenProjectId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const labels = useMemo<ChatGroupLabels>(() => ({
    pinned: t("chat.groups.pinned"),
    all: t("chat.groups.all"),
    today: t("chat.groups.today"),
    yesterday: t("chat.groups.yesterday"),
    earlier: t("chat.groups.earlier"),
    archived: t("chat.groups.archived"),
    projects: t("chat.groups.projects"),
    fallbackTitle: t("chat.newChat"),
  }), [t]);

  const groups = useMemo(
    () => groupSessions(sessions, labels, {
      pinnedKeys,
      archivedKeys,
      titleOverrides,
      projectNameOverrides,
      hiddenProjectKeys,
      sessionOrder,
      showArchived,
      sort,
      defaultWorkspacePath,
    }),
    [
      sessions, labels, pinnedKeys, archivedKeys, titleOverrides,
      projectNameOverrides, hiddenProjectKeys, sessionOrder,
      showArchived, sort, defaultWorkspacePath,
    ],
  );

  const runningIds = useMemo(() => new Set(runningChatIds), [runningChatIds]);
  const updatedIds = useMemo(() => new Set(updatedChatIds), [updatedChatIds]);
  const allGroups = useMemo<SessionGroup[]>(() => {
    if (!temporarySessions.length) return groups;
    return [
      {
        id: "temporary",
        label: t("temporaryChat.title"),
        sessions: temporarySessions,
      },
      ...groups,
    ];
  }, [groups, temporarySessions, t]);
  const openGroup = allGroups.find((group) => group.id === openProjectId) ?? null;

  if (!allGroups.length) return null;

  const openProject = (id: string) => {
    setOpenProjectId((current) => {
      if (current !== id) setExpanded(false);
      return id;
    });
  };
  const close = () => {
    setOpenProjectId(null);
    setExpanded(false);
  };

  const visibleSessions = openGroup
    ? (expanded ? openGroup.sessions : openGroup.sessions.slice(0, VISIBLE_SESSION_LIMIT))
    : [];
  const overflowCount = openGroup ? Math.max(0, openGroup.sessions.length - visibleSessions.length) : 0;

  const pickSession = (session: ChatSummary) => {
    close();
    onSelect(session.key);
  };

  return (
    <div
      className={cn("relative z-40 shrink-0 border-b border-border/55 bg-background", className)}
      onMouseLeave={close}
      onKeyDown={(event) => { if (event.key === "Escape") close(); }}
    >
      <div
        role="toolbar"
        aria-label={t("agents.history.projects", { defaultValue: "项目" })}
        className="flex items-center gap-1.5 overflow-x-auto px-3 py-2"
      >
        {allGroups.map((group) => {
          const open = group.id === openProjectId;
          return (
            <button
              key={group.id}
              type="button"
              aria-expanded={open}
              onMouseEnter={() => openProject(group.id)}
              onFocus={() => openProject(group.id)}
              onClick={() => (open ? close() : openProject(group.id))}
              className={cn(
                "flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                open
                  ? "border-primary/40 bg-primary/10 text-foreground"
                  : "border-border/60 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              <FolderGit2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="max-w-40 truncate">{group.label}</span>
              <span className="rounded-full bg-muted px-1.5 py-px text-[10px] tabular-nums text-muted-foreground">
                {group.sessions.length}
              </span>
            </button>
          );
        })}
      </div>

      {openGroup ? (
        <div
          data-testid="agent-history-panel"
          className="absolute inset-x-0 top-full z-40 border-b border-border/55 bg-background shadow-[0_16px_40px_rgba(15,23,42,0.16)]"
        >
          <div className="mx-auto w-full max-w-3xl px-3 py-2">
          <ul className={cn("space-y-0.5", expanded && "max-h-64 overflow-y-auto")}>
            {visibleSessions.map((session) => {
              const isTemporary = openGroup.id === "temporary";
              const title = isTemporary
                ? deriveTemporaryChatTitle(session.preview, t("temporaryChat.title"))
                : displayTitle(session, titleOverrides, t("chat.newChat"));
              const active = session.key === activeKey;
              const running = runningIds.has(session.chatId);
              const updated = !active && updatedIds.has(session.chatId);
              return (
                <li key={session.key}>
                  <div
                    className={cn(
                      "group flex items-center gap-1 rounded-lg transition-colors",
                      active ? "bg-primary/8 ring-1 ring-primary/20" : "hover:bg-muted/50",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => pickSession(session)}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <MessageSquareText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{title}</span>
                    </button>
                    {running || updated ? (
                      <span
                        role="img"
                        aria-label={running ? t("chat.activity.running") : t("chat.activity.updated")}
                        className="grid h-7 w-7 shrink-0 place-items-center"
                      >
                        <span className={cn(running
                          ? "h-3 w-3 animate-spin rounded-full border border-blue-500/25 border-t-blue-500 [animation-duration:1.4s] motion-reduce:animate-none dark:border-blue-400/25 dark:border-t-blue-400"
                          : "h-2 w-2 rounded-full bg-[#ff8a3d] shadow-[0_0_0_2px_rgba(255,138,61,0.16)]")} />
                      </span>
                    ) : null}
                    {!isTemporary && onRequestRename ? (
                      <button
                        type="button"
                        aria-label={`${title} — ${t("chat.rename")}`}
                        title={t("chat.rename")}
                        onClick={() => { close(); onRequestRename(session.key, title); }}
                        className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:inline-flex focus-visible:inline-flex"
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    ) : null}
                    {!isTemporary && onRequestDelete ? (
                      <button
                        type="button"
                        aria-label={`${title} — ${t("chat.delete")}`}
                        title={t("chat.delete")}
                        onClick={() => { close(); onRequestDelete(session.key, title); }}
                        className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:inline-flex focus-visible:inline-flex"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    ) : null}
                    {isTemporary && onCloseTemporaryChat ? (
                      <button
                        type="button"
                        aria-label={t("temporaryChat.closeAction", { title, defaultValue: "Close temporary chat: {{title}}" })}
                        title={t("temporaryChat.closeAction", { title, defaultValue: "Close temporary chat: {{title}}" })}
                        onClick={() => { close(); onCloseTemporaryChat(session.key); }}
                        className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:inline-flex focus-visible:inline-flex"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
          {openGroup.sessions.length > VISIBLE_SESSION_LIMIT ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setExpanded((value) => !value)}
              className="mt-1 h-8 w-full rounded-lg text-xs text-muted-foreground hover:text-foreground"
            >
              {expanded
                ? t("agents.history.less", { defaultValue: "收起" })
                : t("agents.history.more", { count: overflowCount, defaultValue: "展示更多" })}
            </Button>
          ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
