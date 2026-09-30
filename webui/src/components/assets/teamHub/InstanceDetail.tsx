import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";

import type { InstanceTarget } from "./InstanceList";

/**
 * Second level of the team hub: one selected instance, with only the
 * actions that make sense for it. Browsing and sharing always need a target
 * instance, so they live here rather than beside the instance list.
 */
export function InstanceDetail({
  target,
  tabs,
  active,
  onSelectTab,
  onBack,
  children,
}: {
  target: InstanceTarget;
  tabs: { value: string; label: string }[];
  active: string;
  onSelectTab: (value: string) => void;
  onBack: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="mt-0.5 shrink-0"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {t("assets.teamHub.back", { defaultValue: "All instances" })}
        </Button>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-foreground">{target.name}</h3>
          {target.description ? (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              {target.description}
            </p>
          ) : null}
          {target.kind === "remote" ? (
            <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground/80">
              {target.baseUrl}
            </p>
          ) : null}
        </div>
      </div>

      <SegmentedControl
        ariaLabel={t("assets.teamHub.actions", { defaultValue: "Instance actions" })}
        value={active}
        onChange={onSelectTab}
        options={tabs}
        className="self-start"
      />

      {children}
    </div>
  );
}
