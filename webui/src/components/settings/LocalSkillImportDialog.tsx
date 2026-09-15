import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, FolderInput, Loader2, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { fetchLocalSkills, importLocalSkills } from "@/lib/api";
import { notifySkillsChanged } from "@/lib/skill-events";
import type { LocalSkillCandidate } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useClient } from "@/providers/ClientProvider";

const DEFAULT_LOCAL_SKILLS_PATH = "~/.agents/skills/";

export function LocalSkillImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { client, getToken } = useClient();
  const { t } = useTranslation();
  const [sourcePath, setSourcePath] = useState(DEFAULT_LOCAL_SKILLS_PATH);
  const [skills, setSkills] = useState<LocalSkillCandidate[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const scanVersion = useRef(0);
  const selectableNames = useMemo(
    () => skills.filter((skill) => !skill.already_imported).map((skill) => skill.name),
    [skills],
  );
  const allSelected = selectableNames.length > 0
    && selectableNames.every((name) => selected.includes(name));

  const loadSkills = useCallback(async (path: string) => {
    const version = scanVersion.current + 1;
    scanVersion.current = version;
    setLoading(true);
    setError("");
    setResult("");
    try {
      const payload = await fetchLocalSkills(getToken(), path.trim() || DEFAULT_LOCAL_SKILLS_PATH);
      if (scanVersion.current !== version) return;
      setSkills(payload.skills);
      setSelected([]);
    } catch (reason) {
      if (scanVersion.current !== version) return;
      setSkills([]);
      setSelected([]);
      setError(
        reason instanceof Error
          ? reason.message
          : t("settings.skills.localImportLoadFailed", {
              defaultValue: "Could not scan the gateway skills directory.",
            }),
      );
    } finally {
      if (scanVersion.current === version) setLoading(false);
    }
  }, [getToken, t]);

  useEffect(() => {
    if (!open) return;
    setSourcePath(DEFAULT_LOCAL_SKILLS_PATH);
    void loadSkills(DEFAULT_LOCAL_SKILLS_PATH);
  }, [loadSkills, open]);

  const toggleSkill = (name: string) => {
    setSelected((current) =>
      current.includes(name)
        ? current.filter((item) => item !== name)
        : [...current, name],
    );
  };

  const toggleAll = () => {
    setSelected(allSelected ? [] : selectableNames);
  };

  const importSelected = async () => {
    if (!selected.length) return;
    setImporting(true);
    setError("");
    setResult("");
    try {
      const payload = await importLocalSkills(
        client,
        sourcePath.trim() || DEFAULT_LOCAL_SKILLS_PATH,
        selected,
      );
      notifySkillsChanged(payload);
      const imported = new Set(payload.last_action.imported);
      setSkills((current) => current.map((skill) =>
        imported.has(skill.name) ? { ...skill, already_imported: true } : skill
      ));
      setSelected([]);
      setResult(
        t("settings.skills.localImportResult", {
          imported: payload.last_action.imported.length,
          skipped: payload.last_action.skipped.length,
          defaultValue: "Imported {{imported}} skills. Skipped {{skipped}}.",
        }),
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : t("settings.skills.localImportFailed", {
              defaultValue: "Could not import the selected skills.",
            }),
      );
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(80vh,46rem)] max-w-xl overflow-hidden p-0">
        <DialogHeader className="px-6 pb-0 pt-6">
          <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-control bg-muted text-foreground">
            <FolderInput className="h-5 w-5" aria-hidden />
          </div>
          <DialogTitle>
            {t("settings.skills.localImportTitle", { defaultValue: "Import local skills" })}
          </DialogTitle>
          <DialogDescription>
            {t("settings.skills.localImportDescription", {
              defaultValue:
                "Select existing skills on the gateway machine to link into this workspace. Source files are not copied.",
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-4 overflow-y-auto px-6 py-1">
          <div className="space-y-1.5">
            <label htmlFor="local-skills-path" className="text-[12px] font-medium text-foreground">
              {t("settings.skills.localImportPath", {
                defaultValue: "Skills directory (gateway path)",
              })}
            </label>
            <div className="flex gap-2">
              <Input
                id="local-skills-path"
                value={sourcePath}
                onChange={(event) => setSourcePath(event.target.value)}
                disabled={loading || importing}
                className="font-mono text-[12px]"
              />
              <Button
                type="button"
                variant="outline"
                disabled={loading || importing}
                onClick={() => void loadSkills(sourcePath)}
                aria-label={t("settings.skills.localImportScan", {
                  defaultValue: "Scan skills directory",
                })}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <RefreshCw className="h-4 w-4" aria-hidden />
                )}
              </Button>
            </div>
          </div>

          {error ? (
            <div className="rounded-control bg-destructive/10 px-3 py-2.5 text-[13px] text-destructive">
              {error}
            </div>
          ) : null}
          {result ? (
            <div className="flex items-center gap-2 rounded-control bg-emerald-500/10 px-3 py-2.5 text-[13px] text-emerald-700 dark:text-emerald-300">
              <Check className="h-4 w-4" aria-hidden />
              {result}
            </div>
          ) : null}

          {!loading && !error ? (
            skills.length ? (
              <div className="overflow-hidden rounded-floating border border-border/50">
                <button
                  type="button"
                  onClick={toggleAll}
                  disabled={!selectableNames.length || importing}
                  className="flex w-full items-center justify-between border-b border-border/45 px-3 py-2.5 text-left text-[12px] font-medium hover:bg-muted/50 disabled:cursor-default disabled:opacity-60"
                >
                  <span>
                    {t("settings.skills.localImportSelectAll", { defaultValue: "Select all" })}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {selected.length}/{selectableNames.length}
                  </span>
                </button>
                <div className="max-h-72 overflow-y-auto">
                  {skills.map((skill) => {
                    const checked = selected.includes(skill.name);
                    return (
                      <label
                        key={skill.name}
                        className={cn(
                          "flex items-start gap-3 border-b border-border/35 px-3 py-3 last:border-b-0",
                          skill.already_imported
                            ? "cursor-not-allowed opacity-55"
                            : "cursor-pointer hover:bg-muted/40",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={skill.already_imported || importing}
                          onChange={() => toggleSkill(skill.name)}
                          className="mt-1 h-4 w-4 rounded border-border accent-foreground"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-[13px] font-semibold text-foreground">
                              {skill.name}
                            </span>
                            {skill.already_imported ? (
                              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                                {t("settings.skills.localImportExists", {
                                  defaultValue: "Name already in use",
                                })}
                              </span>
                            ) : null}
                          </span>
                          <span className="mt-0.5 line-clamp-2 block text-[12px] leading-5 text-muted-foreground">
                            {skill.description}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="py-8 text-center text-[13px] text-muted-foreground">
                {t("settings.skills.localImportEmpty", {
                  defaultValue: "No valid skills were found in this directory.",
                })}
              </div>
            )
          ) : null}
        </div>

        <DialogFooter className="border-t border-border/45 px-6 py-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.close", { defaultValue: "Close" })}
          </Button>
          <Button
            type="button"
            disabled={!selected.length || loading || importing}
            onClick={() => void importSelected()}
          >
            {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
            {t("settings.skills.localImportAction", {
              count: selected.length,
              defaultValue: "Import selected ({{count}})",
            })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
