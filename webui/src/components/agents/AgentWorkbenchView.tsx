import { useMemo, useState, type WheelEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  Bot, Check, CheckCircle2, ChevronDown, CircleSlash, MessageSquarePlus,
  Pencil, Plus, RefreshCw, Save, Search, Trash2, Wrench, X,
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
import type { AgentProfileUpdate } from "@/lib/api";
import type { AgentProfilePayload, AgentSkillPayload } from "@/lib/types";
import { AgentIcon } from "@/lib/agent-icon";
import { agentDescription, DEFAULT_AGENT_ID } from "@/lib/agent-copy";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface AgentWorkbenchViewProps {
  agents: AgentProfilePayload[];
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
  onStartChat: () => void;
  onRefresh: () => void;
  onSave: (action: "create" | "update" | "delete", profile: AgentProfileUpdate) => Promise<void>;
  modelPresets: Array<{ name: string }>;
  skillCatalog: AgentSkillPayload[];
}

type AgentDialogMode = "create" | "edit";

type AgentDraft = {
  id: string;
  name: string;
  icon: string;
  description: string;
  status: "active" | "draft" | "disabled";
  model_preset: string;
  system_prompt: string;
  skills: string[];
};

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "agent";
}

function agentReady(agent: AgentProfilePayload): boolean {
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

function draftFromAgent(agent: AgentProfilePayload): AgentDraft {
  return {
    id: agent.id,
    name: agent.name,
    icon: agent.icon ?? "",
    description: agent.description,
    status: agent.status as AgentDraft["status"],
    model_preset: agent.model_preset ?? "",
    system_prompt: agent.system_prompt ?? "",
    skills: agent.skills,
  };
}

function emptyDraft(): AgentDraft {
  return {
    id: "",
    name: "",
    icon: "",
    description: "",
    status: "active",
    model_preset: "",
    system_prompt: "",
    skills: [],
  };
}


const ICON_OPTIONS = ["🤖", "🧠", "✦", "⚡", "🔧", "📚", "🎯", "🛡️", "🌐", "🧪", "💡", "🗂️"];

function MultiSelect({
  label, values, options, onChange, placeholder, searchPlaceholder,
}: {
  label: string; values: string[]; options: Array<{ name: string; description?: string }>;
  onChange: (values: string[]) => void; placeholder: string; searchPlaceholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = options.filter((item) => `${item.name} ${item.description ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  const toggle = (name: string) => onChange(values.includes(name) ? values.filter((item) => item !== name) : [...values, name]);

  /** Keep wheel scrolling owned by the popover list instead of the parent dialog. */
  const handleListWheel = (event: WheelEvent<HTMLDivElement>) => {
    const container = event.currentTarget;
    if (container.scrollHeight <= container.clientHeight || event.deltaY === 0) return;
    container.scrollTop += event.deltaY;
    event.preventDefault();
    event.stopPropagation();
  };

  return <div className="sm:col-span-1">
    <div className="text-xs font-medium text-muted-foreground">{label}</div>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button type="button" variant="outline" className="mt-1 h-auto min-h-10 w-full justify-between gap-2 px-3 py-2 font-normal">
        <span className="flex min-w-0 flex-wrap gap-1">{values.length ? values.map((value) => <span key={value} className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs">{value}<X className="h-3 w-3" /></span>) : <span className="text-muted-foreground">{placeholder}</span>}</span><ChevronDown className="h-4 w-4 shrink-0" />
      </Button></PopoverTrigger>
      <PopoverContent align="start" className="w-[min(24rem,calc(100vw-2rem))] p-2">
        <div className="flex items-center gap-2 border-b border-border px-2 pb-2"><Search className="h-4 w-4 text-muted-foreground" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} className="min-w-0 flex-1 bg-transparent py-1 text-sm outline-none" /></div>
        <div className="mt-2 max-h-56 overflow-y-auto overscroll-contain" onWheel={handleListWheel}>{filtered.length ? filtered.map((item) => <button key={item.name} type="button" onClick={() => toggle(item.name)} className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-muted"><span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border">{values.includes(item.name) ? <Check className="h-3 w-3" /> : null}</span><span className="min-w-0"><span className="block text-sm text-foreground">{item.name}</span>{item.description ? <span className="block text-xs text-muted-foreground">{item.description}</span> : null}</span></button>) : <div className="px-2 py-4 text-sm text-muted-foreground">{placeholder}</div>}</div>
      </PopoverContent>
    </Popover>
  </div>;
}

export function AgentWorkbenchView({
  agents,
  selectedAgentId,
  onSelectAgent,
  onStartChat,
  onRefresh,
  onSave,
  modelPresets,
  skillCatalog,
}: AgentWorkbenchViewProps) {
  const { t } = useTranslation();
  const selected = agents.find((agent) => agent.id === selectedAgentId) ?? agents[0] ?? null;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<AgentDialogMode>("create");
  const [draft, setDraft] = useState<AgentDraft>(emptyDraft());
  const [saving, setSaving] = useState(false);

  const openCreate = () => {
    setDraft(emptyDraft());
    setDialogMode("create");
    setDialogOpen(true);
  };

  const openEdit = (agent: AgentProfilePayload) => {
    setDraft(draftFromAgent(agent));
    setDialogMode("edit");
    setDialogOpen(true);
  };

  const closeDialog = () => {
    if (saving) return;
    setDialogOpen(false);
  };

  const selectedExists = useMemo(() => agents.some((agent) => agent.id === draft.id), [agents, draft.id]);

  const save = async () => {
    if (!draft.name.trim()) return;
    const profileId = dialogMode === "create" ? slugify(draft.name) : draft.id.trim();
    if (!profileId) return;
    setSaving(true);
    try {
      await onSave(dialogMode === "create" ? "create" : "update", {
        id: profileId,
        name: draft.name.trim(),
        icon: draft.icon.trim() || null,
        description: draft.description.trim(),
        status: draft.status,
        model_preset: draft.model_preset.trim() || null,
        system_prompt: draft.system_prompt.trim() || null,
        skills: draft.skills,
        tools: [],
      });
      setDialogOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!selectedExists) return;
    setSaving(true);
    try {
      await onSave("delete", {
        id: draft.id.trim(),
        name: draft.name.trim(),
        icon: draft.icon.trim() || null,
        description: draft.description.trim(),
        status: draft.status,
        model_preset: draft.model_preset.trim() || null,
        system_prompt: draft.system_prompt.trim() || null,
        skills: draft.skills,
        tools: [],
      });
      setDialogOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-settings-canvas">
      <header className="shrink-0 border-b border-border/55 bg-settings-canvas px-5 py-4 sm:px-8">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Bot className="h-4 w-4" />
              {t("agents.workbench.eyebrow", { defaultValue: "Agent Workbench" })}
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
              {t("agents.workbench.title", { defaultValue: "Agents" })}
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              {t("agents.workbench.subtitle", { defaultValue: "Choose an agent profile, inspect its prompt bindings and capabilities, then start a chat with that profile." })}
            </p>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={openCreate} className="gap-2 rounded-control">
              <Plus className="h-4 w-4" />
              {t("agents.actions.create", { defaultValue: "Create agent" })}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onRefresh} className="gap-2 rounded-control">
              <RefreshCw className="h-4 w-4" />
              {t("agents.workbench.refresh", { defaultValue: "Refresh" })}
            </Button>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
        <div className="mx-auto grid w-full max-w-7xl gap-5 lg:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)]">
          <aside className="min-w-0 rounded-panel border border-border/55 bg-settings-surface p-2">
            <div className="px-2 pb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {t("agents.workbench.listTitle", { defaultValue: "Agent List" })}
            </div>
            <div className="space-y-1">
              {agents.length ? agents.map((agent) => {
                const active = selected?.id === agent.id;
                const ready = agentReady(agent);
                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => onSelectAgent(agent.id)}
                    className={cn(
                      "flex w-full min-w-0 items-start gap-3 rounded-lg px-3 py-3 text-left transition-colors",
                      active ? "bg-muted/65 ring-1 ring-border/70" : "hover:bg-muted/35",
                    )}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-base text-primary">
                      <AgentIcon icon={agent.icon} imageClassName="h-6 w-6 rounded-md" fallbackClassName="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-semibold text-foreground">{agent.name}</span>
                        <span className={cn("h-2 w-2 shrink-0 rounded-full", ready ? "bg-emerald-500" : "bg-amber-500")} />
                      </span>
                      <span className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground">
                        {agentDescription(agent, t)}
                      </span>
                    </span>
                  </button>
                );
              }) : <EmptyList label={t("agents.workbench.empty", { defaultValue: "No agents are configured." })} />}
            </div>
          </aside>

          <main className="min-w-0 rounded-panel border border-border/55 bg-settings-surface">
            {selected ? (
              <div className="flex min-h-full flex-col">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/55 p-5 sm:p-6">
                  <div className="flex min-w-0 items-start gap-4">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-panel border border-primary/15 bg-primary/10 text-2xl text-primary">
                      <AgentIcon icon={selected.icon} imageClassName="h-9 w-9 rounded-lg" fallbackClassName="h-6 w-6" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-xl font-semibold text-foreground">{selected.name}</h2>
                        <CapabilityPill label={statusLabel(selected, t)} ok={agentReady(selected)} />
                      </div>
                      <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                        {agentDescription(selected, t)}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                        <span>
                          <span className="font-medium">{t("agents.profile.agentId", { defaultValue: "Agent ID" })}:</span>{" "}
                          <code className="rounded bg-muted px-1 py-0.5 font-mono">{selected.id}</code>
                        </span>
                        <span>
                          <span className="font-medium">{t("agents.profile.modelPreset", { defaultValue: "Model Preset" })}:</span>{" "}
                          {selected.model_preset || t("agents.fields.default", { defaultValue: "Default" })}
                        </span>
                      </div>
                    </div>
                  </div>
                  {selected.id !== DEFAULT_AGENT_ID ? (
                    <Button type="button" variant="outline" onClick={() => openEdit(selected)} className="gap-2 shrink-0 rounded-control">
                      <Pencil className="h-4 w-4" />
                      {t("agents.actions.edit", { defaultValue: "Edit" })}
                    </Button>
                  ) : null}
                  <Button type="button" onClick={onStartChat} disabled={!agentReady(selected)} className="gap-2 shrink-0 rounded-control">
                    <MessageSquarePlus className="h-4 w-4" />
                    {t("agents.newChat", { defaultValue: "New Chat With Agent" })}
                  </Button>
                </div>

                <div className="space-y-6 p-5 sm:p-6">
                  <section>
                    <h3 className="text-sm font-semibold text-foreground">{t("agents.skills.title", { defaultValue: "Skills" })}</h3>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {selected.skills.length ? selected.skills.map((skill) => (
                        <span key={skill} className="rounded-control border border-border/45 bg-muted/55 px-2.5 py-1 text-xs font-medium text-foreground">
                          {skill}
                        </span>
                      )) : <EmptyList label={t("agents.skills.empty", { defaultValue: "This agent does not bind extra skills." })} />}
                    </div>
                    {(selected.missing_skills.length || selected.disabled_skills.length) ? (
                      <div className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-xs leading-5 text-amber-800 dark:text-amber-200">
                        {selected.missing_skills.length ? <div>{t("agents.skills.missing", { names: selected.missing_skills.join(", "), defaultValue: "Missing skills: {{names}}" })}</div> : null}
                        {selected.disabled_skills.length ? <div>{t("agents.skills.disabled", { names: selected.disabled_skills.join(", "), defaultValue: "Disabled skills: {{names}}" })}</div> : null}
                      </div>
                    ) : null}
                  </section>

                  <section>
                    <h3 className="text-sm font-semibold text-foreground">{t("agents.tools.title", { defaultValue: "Tools" })}</h3>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {selected.tools.length ? selected.tools.map((tool) => (
                        <div key={tool.name} className="rounded-control border border-border/55 bg-muted/20 p-3">
                          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                            <Wrench className="h-4 w-4 text-muted-foreground" />
                            <span className="truncate">{tool.name}</span>
                          </div>
                          {tool.description ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{tool.description}</p> : null}
                        </div>
                      )) : <EmptyList label={t("agents.tools.empty", { defaultValue: "This agent does not bind extra tools." })} />}
                    </div>
                    {selected.missing_tools.length ? (
                      <div className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-xs leading-5 text-amber-800 dark:text-amber-200">
                        {t("agents.tools.missing", { names: selected.missing_tools.join(", "), defaultValue: "Missing tools: {{names}}" })}
                      </div>
                    ) : null}
                  </section>
                </div>
              </div>
            ) : (
              <div className="p-6">
                <EmptyList label={t("agents.noProfile", { defaultValue: "No agent profile is available." })} />
              </div>
            )}
          </main>
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={(next) => { if (!next) closeDialog(); }}>
        <DialogContent className="max-h-[min(80vh,46rem)] max-w-2xl overflow-y-auto">
          <DialogHeader className="text-left">
            <DialogTitle>
              {dialogMode === "create"
                ? t("agents.dialog.createTitle", { defaultValue: "Create agent" })
                : t("agents.dialog.editTitle", { defaultValue: "Edit agent" })}
            </DialogTitle>
            <DialogDescription>
              {dialogMode === "create"
                ? t("agents.dialog.createDescription", { defaultValue: "Fill in the agent profile and save it." })
                : t("agents.dialog.editDescription", { defaultValue: "Update the agent profile and save the changes." })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            <section className="space-y-3">
              <div><h3 className="text-sm font-semibold text-foreground">{t("agents.sections.basic", { defaultValue: "Basic information" })}</h3><p className="text-xs text-muted-foreground">{t("agents.sections.basicHint", { defaultValue: "Give this agent a clear identity." })}</p></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-medium text-muted-foreground">{t("agents.fields.name", { defaultValue: "Name" })}<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="mt-1 block h-10 w-full rounded-control border border-border/60 bg-background px-3 text-sm text-foreground" /></label>
                <div className="sm:col-span-2"><div className="text-xs font-medium text-muted-foreground">{t("agents.fields.icon", { defaultValue: "Icon" })}</div><div className="mt-1 flex flex-wrap gap-2">{ICON_OPTIONS.map((icon) => <button key={icon} type="button" aria-label={icon} onClick={() => setDraft({ ...draft, icon })} className={cn("flex h-9 w-9 items-center justify-center rounded-control border text-lg", draft.icon === icon ? "border-primary/40 bg-primary/10 ring-2 ring-primary/15" : "border-border/60 hover:bg-muted/55")}>{icon}</button>)}</div></div>
                <label className="text-xs font-medium text-muted-foreground sm:col-span-2">{t("agents.fields.description", { defaultValue: "Description" })}<input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className="mt-1 block h-10 w-full rounded-control border border-border/60 bg-background px-3 text-sm text-foreground" /></label>
              </div>
            </section>
            <section className="grid gap-3 sm:grid-cols-2"><h3 className="sm:col-span-2 text-sm font-semibold text-foreground">{t("agents.sections.runtime", { defaultValue: "Status and model" })}</h3>
              <label className="text-xs font-medium text-muted-foreground">{t("agents.fields.status", { defaultValue: "Status" })}<select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as AgentDraft["status"] })} className="mt-1 block h-10 w-full rounded-control border border-border/60 bg-background px-3 text-sm text-foreground"><option value="active">{t("agents.status.ready", { defaultValue: "Ready" })}</option><option value="draft">{t("agents.status.needsAttention", { defaultValue: "Needs attention" })}</option><option value="disabled">{t("agents.status.disabled", { defaultValue: "Disabled" })}</option></select></label>
              <label className="text-xs font-medium text-muted-foreground">{t("agents.fields.modelPreset", { defaultValue: "Model preset" })}<select value={draft.model_preset} onChange={(e) => setDraft({ ...draft, model_preset: e.target.value })} className="mt-1 block h-10 w-full rounded-control border border-border/60 bg-background px-3 text-sm text-foreground"><option value="">{t("agents.fields.default", { defaultValue: "Default" })}</option>{modelPresets.map((preset) => <option key={preset.name} value={preset.name}>{preset.name}</option>)}</select></label>
            </section>
            <section><h3 className="text-sm font-semibold text-foreground">{t("agents.sections.prompt", { defaultValue: "Prompt" })}</h3><textarea value={draft.system_prompt} onChange={(e) => setDraft({ ...draft, system_prompt: e.target.value })} rows={5} className="mt-2 block w-full rounded-control border border-border/60 bg-background px-3 py-2.5 text-sm text-foreground" /></section>
            <section className="grid gap-3 sm:grid-cols-2"><h3 className="sm:col-span-2 text-sm font-semibold text-foreground">{t("agents.sections.capabilities", { defaultValue: "Capabilities" })}</h3>
              <MultiSelect label={t("agents.fields.skills", { defaultValue: "Skills" })} values={draft.skills} options={skillCatalog} onChange={(skills) => setDraft({ ...draft, skills })} placeholder={t("agents.fields.selectSkills", { defaultValue: "Select skills" })} searchPlaceholder={t("agents.fields.searchSkills", { defaultValue: "Search skills..." })} />
            </section>
          </div>

          <DialogFooter>
            {dialogMode === "edit" ? (
              <Button type="button" variant="destructive" onClick={() => void remove()} disabled={saving} className="gap-2">
                <Trash2 className="h-4 w-4" />
                {t("agents.actions.delete", { defaultValue: "Delete" })}
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={closeDialog} disabled={saving}>
              {t("agents.actions.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button type="button" onClick={() => void save()} disabled={saving || !draft.name.trim() || (dialogMode === "edit" && !draft.id.trim())} className="gap-2">
              <Save className="h-4 w-4" />
              {t("agents.actions.save", { defaultValue: "Save" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
