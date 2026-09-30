import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2, CircleSlash, Info, MessageSquarePlus,
  Pencil, Search, SquarePen, Wrench,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AgentProfilePayload } from "@/lib/types";
import { AgentIcon } from "@/lib/agent-icon";
import { agentDescription, DEFAULT_AGENT_ID } from "@/lib/agent-copy";
import { cn } from "@/lib/utils";

export interface AgentContactsPanelProps {
  agents: AgentProfilePayload[];
  teamAgentIds?: string[];
  defaultAgentId?: string;
  selectedAgentId: string | null;
  /** Update the selected agent (e.g. draft selection, route). */
  onSelectAgent: (agentId: string) => void;
  /** Start a chat with an explicit agent id. */
  onOpenChat: (agentId: string) => void;
  /** Start a brand-new session with an agent (workspace follows its last session). */
  onNewChat?: (agentId: string) => void;
  /** Open the create/edit dialog for an agent. Omit to hide the edit action. */
  onEditAgent?: (agent: AgentProfilePayload) => void;
  className?: string;
}

export function agentReady(agent: AgentProfilePayload): boolean {
  return agent.status !== "disabled" && agent.capabilities_ok;
}

function statusLabel(
  agent: AgentProfilePayload,
  t: (key: string, options?: { defaultValue?: string }) => string,
): string {
  if (agent.status === "disabled") return t("agents.status.disabled", { defaultValue: "Disabled" });
  if (!agent.capabilities_ok) return t("agents.status.needsAttention", { defaultValue: "Needs attention" });
  return t("agents.status.ready", { defaultValue: "Ready" });
}

function CapabilityPill({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        ok
          ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
      )}
    >
      {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CircleSlash className="h-3.5 w-3.5" />}
      {label}
    </span>
  );
}

function EmptyList({ label }: { label: string }) {
  return <div className="rounded-lg border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">{label}</div>;
}

export function AgentContactsPanel({
  agents,
  teamAgentIds = [],
  defaultAgentId = "default",
  selectedAgentId,
  onSelectAgent,
  onOpenChat,
  onNewChat,
  onEditAgent,
  className,
}: AgentContactsPanelProps) {
  const { t } = useTranslation();
  const searchId = useId();
  const [agentQuery, setAgentQuery] = useState("");
  const [detailAgentId, setDetailAgentId] = useState<string | null>(null);

  const teamIds = useMemo(() => new Set(teamAgentIds), [teamAgentIds]);
  const visibleAgents = useMemo(() => {
    const query = agentQuery.trim().toLowerCase();
    return agents.filter((agent) => !query || `${agent.name} ${agent.description}`.toLowerCase().includes(query));
  }, [agentQuery, agents]);
  const agentGroups = useMemo(() => ([
    { id: "team", label: t("agents.groups.team", { defaultValue: "团队智能体" }), agents: visibleAgents.filter((agent) => teamIds.has(agent.id)) },
    { id: "personal", label: t("agents.groups.personal", { defaultValue: "我的智能体" }), agents: visibleAgents.filter((agent) => !teamIds.has(agent.id) && agent.id !== defaultAgentId) },
    { id: "builtin", label: t("agents.groups.builtin", { defaultValue: "内置助手" }), agents: visibleAgents.filter((agent) => agent.id === defaultAgentId) },
  ].filter((group) => group.agents.length)), [defaultAgentId, t, teamIds, visibleAgents]);

  const detailAgent = detailAgentId ? agents.find((agent) => agent.id === detailAgentId) ?? null : null;

  const handleRowClick = (agent: AgentProfilePayload) => {
    onSelectAgent(agent.id);
    if (agentReady(agent)) {
      onOpenChat(agent.id);
    } else {
      setDetailAgentId(agent.id);
    }
  };

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="shrink-0 border-b border-border/55 px-3 py-3">
        <label className="sr-only" htmlFor={searchId}>{t("agents.search", { defaultValue: "搜索 Agent" })}</label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input id={searchId} value={agentQuery} onChange={(event) => setAgentQuery(event.target.value)} placeholder={t("agents.search", { defaultValue: "搜索 Agent" })} className="h-9 w-full rounded-control border border-border/55 bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2">
        {agentGroups.length ? agentGroups.map((group) => (
          <section key={group.id} aria-label={group.label}>
            <div className="flex items-center justify-between px-2 pb-1.5 pt-1">
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground">{group.label}</h3>
              <span className="text-[11px] tabular-nums text-muted-foreground">{group.agents.length}</span>
            </div>
            <div className="space-y-0.5">
              {group.agents.map((agent) => {
                const active = selectedAgentId === agent.id;
                const ready = agentReady(agent);
                return (
                  <div
                    key={agent.id}
                    className={cn(
                      "flex items-center gap-0.5 rounded-lg transition-colors",
                      active ? "bg-primary/8 ring-1 ring-primary/20" : "hover:bg-muted/45",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => handleRowClick(agent)}
                      aria-label={`${agent.name} — ${statusLabel(agent, t)}`}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="flex h-8 w-6 shrink-0 items-center justify-center overflow-hidden rounded-control bg-primary/10 text-sm text-primary">
                        <AgentIcon icon={agent.icon} imageClassName="h-8 w-6 object-cover" fallbackClassName="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{agent.name}</span>
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", ready ? "bg-emerald-500" : "bg-amber-500")} aria-hidden />
                      <span className={cn("shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium", group.id === "team" ? "bg-sky-500/10 text-sky-700 dark:text-sky-300" : "bg-muted text-muted-foreground")}>
                        {group.id === "team" ? t("agents.groups.teamBadge", { defaultValue: "团队" }) : group.id === "builtin" ? t("agents.groups.builtinBadge", { defaultValue: "内置" }) : t("agents.groups.personalBadge", { defaultValue: "个人" })}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDetailAgentId(agent.id)}
                      aria-label={t("agents.detail.open", { name: agent.name, defaultValue: "查看 {{name}} 的详情" })}
                      title={t("agents.detail.open", { name: agent.name, defaultValue: "查看 {{name}} 的详情" })}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Info className="h-3.5 w-3.5" aria-hidden />
                    </button>
                    {onNewChat ? (
                      <button
                        type="button"
                        onClick={() => onNewChat(agent.id)}
                        aria-label={t("agents.newChatFor", { name: agent.name, defaultValue: "与{{name}}开始新对话" })}
                        title={t("agents.newChatFor", { name: agent.name, defaultValue: "与{{name}}开始新对话" })}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <SquarePen className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        )) : <EmptyList label={t("agents.workbench.empty", { defaultValue: "暂无匹配的 Agent。" })} />}
      </div>

      <Dialog open={detailAgent !== null} onOpenChange={(next) => { if (!next) setDetailAgentId(null); }}>
        <DialogContent className="max-h-[min(80vh,40rem)] max-w-lg overflow-y-auto">
          {detailAgent ? (
            <>
              <DialogHeader className="text-left">
                <div className="flex items-start gap-3">
                  <span className="flex h-12 w-9 shrink-0 items-center justify-center overflow-hidden rounded-control bg-primary/10 text-xl text-primary">
                    <AgentIcon icon={detailAgent.icon} imageClassName="h-12 w-9 object-cover" fallbackClassName="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <DialogTitle className="truncate">{detailAgent.name}</DialogTitle>
                    <DialogDescription className="mt-1">
                      {t("agents.profile.agentId", { defaultValue: "Agent ID" })} · {detailAgent.id}
                    </DialogDescription>
                    <span className="mt-2 inline-block">
                      <CapabilityPill label={statusLabel(detailAgent, t)} ok={agentReady(detailAgent)} />
                    </span>
                  </span>
                </div>
              </DialogHeader>

              <div className="space-y-5">
                <p className="text-sm leading-6 text-muted-foreground">
                  {agentDescription(detailAgent, t)}
                </p>
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    <span className="font-medium">{t("agents.fields.modelPreset", { defaultValue: "Model preset" })}:</span>{" "}
                    {detailAgent.model_preset || t("agents.fields.default", { defaultValue: "Default" })}
                  </span>
                </div>

                <section>
                  <h3 className="text-sm font-semibold text-foreground">{t("agents.skills.title", { defaultValue: "Skills" })}</h3>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {detailAgent.skills.length ? detailAgent.skills.map((skill) => (
                      <span key={skill} className="rounded-control border border-border/45 bg-muted/55 px-2 py-0.5 text-xs font-medium text-foreground">
                        {skill}
                      </span>
                    )) : <span className="text-xs text-muted-foreground">{t("agents.skills.empty", { defaultValue: "This agent does not bind extra skills." })}</span>}
                  </div>
                  {(detailAgent.missing_skills.length || detailAgent.disabled_skills.length) ? (
                    <div className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/10 p-2.5 text-xs leading-5 text-amber-800 dark:text-amber-200">
                      {detailAgent.missing_skills.length ? <div>{t("agents.skills.missing", { names: detailAgent.missing_skills.join(", "), defaultValue: "Missing skills: {{names}}" })}</div> : null}
                      {detailAgent.disabled_skills.length ? <div>{t("agents.skills.disabled", { names: detailAgent.disabled_skills.join(", "), defaultValue: "Disabled skills: {{names}}" })}</div> : null}
                    </div>
                  ) : null}
                </section>

                <section>
                  <h3 className="text-sm font-semibold text-foreground">{t("agents.tools.title", { defaultValue: "Tools" })}</h3>
                  <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                    {detailAgent.tools.length ? detailAgent.tools.map((tool) => (
                      <div key={tool.name} className="rounded-control border border-border/55 bg-muted/20 px-2.5 py-2">
                        <div className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
                          <Wrench className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{tool.name}</span>
                        </div>
                        {tool.description ? <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground">{tool.description}</p> : null}
                      </div>
                    )) : <span className="text-xs text-muted-foreground">{t("agents.tools.empty", { defaultValue: "This agent does not bind extra tools." })}</span>}
                  </div>
                  {detailAgent.missing_tools.length ? (
                    <div className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/10 p-2.5 text-xs leading-5 text-amber-800 dark:text-amber-200">
                      {t("agents.tools.missing", { names: detailAgent.missing_tools.join(", "), defaultValue: "Missing tools: {{names}}" })}
                    </div>
                  ) : null}
                </section>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDetailAgentId(null)}>
                  {t("agents.actions.cancel", { defaultValue: "Cancel" })}
                </Button>
                {onEditAgent && detailAgent.id !== DEFAULT_AGENT_ID ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => { const agent = detailAgent; setDetailAgentId(null); onEditAgent(agent); }}
                    className="gap-2"
                  >
                    <Pencil className="h-4 w-4" />
                    {t("agents.actions.edit", { defaultValue: "Edit" })}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  onClick={() => { const id = detailAgent.id; setDetailAgentId(null); onOpenChat(id); }}
                  disabled={!agentReady(detailAgent)}
                  className="gap-2"
                >
                  <MessageSquarePlus className="h-4 w-4" />
                  {t("agents.newChat", { defaultValue: "New Chat With Agent" })}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
