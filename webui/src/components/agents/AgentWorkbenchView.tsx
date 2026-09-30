import { useEffect, useMemo, useState, type WheelEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  Bot, Check, ChevronDown, Plus, RefreshCw, Save, Search, Trash2, X,
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
import type { AgentProfilePayload, AgentSkillPayload, SharedInstancePayload } from "@/lib/types";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface AgentWorkbenchViewProps {
  agents: AgentProfilePayload[];
  onRefresh: () => void;
  onSave: (action: "create" | "update" | "delete", profile: AgentProfileUpdate) => Promise<void>;
  modelPresets: Array<{ name: string }>;
  skillCatalog: AgentSkillPayload[];
  sharedInstances?: SharedInstancePayload[];
  sharedWarnings?: string[];
  /** When set, open the edit dialog for this agent id (e.g. from a contacts panel). */
  editingAgentId?: string | null;
  onEditingOpened?: () => void;
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


/**
 * Bundled agent avatar cards served from `webui/public/agent`. Each artwork is a
 * 313x418 card with its own name baked in, so the file name doubles as the
 * accessible name; `default.png` is the only one without a Chinese file name.
 */
const ICON_OPTION_FILES = [
  "default.png",
  "通用助手.png",
  "编程开发.png",
  "写作创作.png",
  "数据分析.png",
  "图像设计.png",
  "语音助手.png",
  "翻译.png",
  "客服支持.png",
  "安全风控.png",
];

const ICON_OPTION_LABELS: Record<string, string> = { "default.png": "系统默认" };

function iconOptionSrc(file: string): string {
  return `/agent/${file}`;
}

function iconOptionLabel(file: string): string {
  return ICON_OPTION_LABELS[file] ?? file.replace(/\.png$/, "");
}

/** Prefer the backend's message, but never render an empty error banner. */
function saveFailureMessage(reason: unknown, fallback: string): string {
  const message = reason instanceof Error ? reason.message.trim() : "";
  return message || fallback;
}

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
  onRefresh,
  onSave,
  modelPresets,
  skillCatalog,
  sharedInstances = [],
  sharedWarnings = [],
  editingAgentId = null,
  onEditingOpened,
}: AgentWorkbenchViewProps) {
  const { t } = useTranslation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<AgentDialogMode>("create");
  const [draft, setDraft] = useState<AgentDraft>(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const openCreate = () => {
    setDraft(emptyDraft());
    setDialogMode("create");
    setSaveError("");
    setDialogOpen(true);
  };

  const openEdit = (agent: AgentProfilePayload) => {
    setDraft(draftFromAgent(agent));
    setDialogMode("edit");
    setSaveError("");
    setDialogOpen(true);
  };

  useEffect(() => {
    if (!editingAgentId) return;
    const agent = agents.find((item) => item.id === editingAgentId);
    if (!agent) return;
    openEdit(agent);
    onEditingOpened?.();
  }, [editingAgentId, agents, onEditingOpened]);

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
    setSaveError("");
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
    } catch (reason) {
      // The mutation is a WebSocket round-trip that can fail for reasons the
      // form cannot express (unwritable config, rejected profile). Swallowing
      // it left the dialog open with no feedback at all.
      setSaveError(saveFailureMessage(reason, t("agents.dialog.saveFailed", {
        defaultValue: "Could not save the agent profile.",
      })));
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
    } catch (reason) {
      setSaveError(saveFailureMessage(reason, t("agents.dialog.deleteFailed", {
        defaultValue: "Could not delete the agent profile.",
      })));
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
               {t("agents.workbench.eyebrow", { defaultValue: "Agent 工作台" })}
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
              {t("agents.workbench.title", { defaultValue: "Agent 联系人" })}
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              {t("agents.workbench.subtitle", { defaultValue: "选择团队共享或个人定制的 Agent，查看能力组成并开始任务。" })}
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

      <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-xl flex-col items-center px-4 py-14 text-center sm:py-20">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Bot className="h-8 w-8" aria-hidden />
              </span>
              <h2 className="mt-4 text-lg font-semibold text-foreground">
                {t("agents.workbench.title", { defaultValue: "Agent 联系人" })}
              </h2>
              <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">
                {t("agents.workbench.hint", { defaultValue: "在左侧选择联系人即可开始对话，点右侧图标查看 Agent 详情。" })}
              </p>
              {!agents.length ? (
                <div className="mt-6 w-full">
                  <EmptyList label={t("agents.noProfile", { defaultValue: "No agent profile is available." })} />
                </div>
              ) : null}
            </div>
        {sharedInstances.length || sharedWarnings.length ? (
          <div className="mx-auto w-full max-w-3xl px-4 pb-10 sm:px-8">
            <div className="rounded-panel border border-border/55 bg-settings-surface p-5 sm:p-6">
            <h3 className="text-sm font-semibold text-foreground">
              {t("agents.shared.title", { defaultValue: "Shared instances" })}
            </h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {t("agents.shared.hint", { defaultValue: "Inherit skills, MCP servers and agents from a team instance. Open the shared URL in a new tab for a fresh isolated session." })}
            </p>
            {sharedWarnings.length ? (
              <div className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-xs leading-5 text-amber-800 dark:text-amber-200">
                {sharedWarnings.map((warning) => <div key={warning}>{warning}</div>)}
              </div>
            ) : null}
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {sharedInstances.map((instance) => (
                <div key={instance.id} className="rounded-control border border-border/55 bg-muted/20 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-foreground">{instance.name || instance.id}</span>
                    {instance.hasBaseUrl ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="shrink-0 rounded-control"
                        onClick={() => window.open(instance.baseUrl, "_blank", "noopener,noreferrer")}
                      >
                        {t("agents.shared.open", { defaultValue: "Open" })}
                      </Button>
                    ) : null}
                  </div>
                  {instance.description ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{instance.description}</p> : null}
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">{instance.id}</p>
                </div>
              ))}
            </div>
            </div>
          </div>
        ) : null}
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
                <div className="sm:col-span-2"><div className="text-xs font-medium text-muted-foreground">{t("agents.fields.icon", { defaultValue: "Icon" })}</div><div className="mt-1 flex flex-wrap gap-2">{ICON_OPTION_FILES.map((file) => { const src = iconOptionSrc(file); return <button key={file} type="button" aria-label={iconOptionLabel(file)} aria-pressed={draft.icon === src} onClick={() => setDraft({ ...draft, icon: src })} className={cn("h-[4.5rem] w-[3.375rem] overflow-hidden rounded-control border transition-colors", draft.icon === src ? "border-primary/40 bg-primary/10 ring-2 ring-primary/15" : "border-border/60 hover:bg-muted/55")}><img src={src} alt="" aria-hidden className="h-full w-full object-cover" /></button>; })}</div></div>
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

          {saveError ? (
            <div
              role="alert"
              className="rounded-control bg-destructive/10 px-3 py-2.5 text-[13px] leading-5 text-destructive"
            >
              {saveError}
            </div>
          ) : null}

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
