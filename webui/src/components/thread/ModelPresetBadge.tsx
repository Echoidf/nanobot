import { useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronDown, CircleHelp, Loader2, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLogoFallback } from "@/hooks/useLogoFallback";
import { inferProviderFromModelName, providerBrand } from "@/lib/provider-brand";
import { cn } from "@/lib/utils";

export interface ModelPresetOption {
  name: string;
  label?: string | null;
  model?: string | null;
  provider?: string | null;
  providerLabel?: string | null;
  isDefault?: boolean;
  callOrderIndex?: number | null;
  available?: boolean;
}

interface ModelPresetBadgeProps {
  label: string;
  modelDetail?: string | null;
  modelPreset?: string | null;
  modelPresets?: ModelPresetOption[];
  onPresetChange?: (name: string) => void | Promise<void>;
  provider?: string | null;
  providerLabel?: string | null;
  needsSetup?: boolean;
  fallbackModelName?: string | null;
  isHero: boolean;
  onClick?: () => void;
}

/** Render the active model as an explicit, accessible session-level preset selector. */
export function ModelPresetBadge({
  label,
  modelDetail,
  modelPreset,
  modelPresets = [],
  onPresetChange,
  provider,
  providerLabel,
  needsSetup = false,
  fallbackModelName,
  isHero,
  onClick,
}: ModelPresetBadgeProps) {
  const { t } = useTranslation();
  const activeName = modelPreset?.trim() || "default";
  const canSwitch = Boolean(onPresetChange) && modelPresets.length > 1;
  const [open, setOpen] = useState(false);
  const [pendingPreset, setPendingPreset] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);

  async function selectPreset(name: string) {
    if (!onPresetChange || name === activeName || pendingPreset) return;
    setPendingPreset(name);
    setSwitchError(null);
    try {
      await onPresetChange(name);
      setOpen(false);
    } catch (reason) {
      setSwitchError(reason instanceof Error && reason.message ? reason.message : " ");
    } finally {
      setPendingPreset(null);
    }
  }

  const trigger = (
    <button
      type="button"
      aria-label={canSwitch
        ? t("thread.composer.chooseModel", { defaultValue: "Choose model" })
        : label}
      aria-haspopup={canSwitch ? "menu" : undefined}
      aria-expanded={canSwitch ? open : undefined}
      onClick={!canSwitch ? onClick : undefined}
      className={cn(
        "thread-composer-model-badge group/model-badge relative inline-flex w-fit min-w-0 max-w-[min(18rem,44vw)] justify-end appearance-none border-0 bg-transparent p-0 shadow-none focus-visible:outline-none",
        (canSwitch || onClick) && "cursor-pointer",
        isHero ? "h-8" : "h-9",
      )}
    >
      <PresetPill
        label={label}
        modelDetail={modelDetail}
        provider={provider}
        providerLabel={providerLabel}
        needsSetup={needsSetup}
        fallbackModelName={fallbackModelName}
        isHero={isHero}
        showChevron={canSwitch}
      />
    </button>
  );

  if (!canSwitch) return trigger;

  return (
    <DropdownMenu open={open} onOpenChange={(nextOpen) => {
      if (pendingPreset) return;
      setOpen(nextOpen);
      if (nextOpen) setSwitchError(null);
    }}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="top"
        sideOffset={8}
        className="w-[min(23rem,calc(100vw-1.5rem))] p-1.5"
      >
        <DropdownMenuLabel className="px-2.5 pb-2 pt-1.5">
          <span className="block text-[13px] font-semibold text-foreground">
            {t("thread.composer.chooseModel", { defaultValue: "Choose model" })}
          </span>
          <span className="mt-0.5 block text-[11px] font-normal leading-4 text-muted-foreground">
            {t("thread.composer.modelScopeHelp", {
              defaultValue: "Applies to this chat. Automatic fallback remains enabled.",
            })}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="max-h-[min(22rem,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto">
          {modelPresets.map((preset) => {
            const selected = preset.name === activeName;
            const pending = preset.name === pendingPreset;
            const available = preset.available !== false;
            return (
              <DropdownMenuItem
                key={preset.name}
                disabled={!available || Boolean(pendingPreset)}
                onSelect={(event) => {
                  event.preventDefault();
                  void selectPreset(preset.name);
                }}
                className={cn(
                  "min-h-[3.75rem] items-start gap-2.5 px-2.5 py-2",
                  selected && "bg-foreground/[0.045] dark:bg-white/[0.07]",
                )}
              >
                <PresetProviderMark
                  provider={preset.provider}
                  model={preset.model}
                  unavailable={!available}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[13px] font-semibold text-foreground">
                      {preset.label || preset.name}
                    </span>
                    <PresetRole option={preset} />
                  </span>
                  <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
                    {[preset.model, preset.providerLabel].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center text-foreground">
                  {pending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : selected ? (
                    <Check className="h-3.5 w-3.5" strokeWidth={2.4} aria-hidden />
                  ) : null}
                </span>
              </DropdownMenuItem>
            );
          })}
        </div>
        {switchError ? (
          <>
            <DropdownMenuSeparator />
            <p role="alert" className="px-2.5 py-1.5 text-[11.5px] leading-4 text-destructive">
              {t("thread.composer.modelSwitchFailed", { defaultValue: "Could not switch model." })}
              {switchError.trim() ? ` ${switchError}` : ""}
            </p>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PresetRole({ option }: { option: ModelPresetOption }) {
  const { t } = useTranslation();
  let text: string;
  if (option.callOrderIndex === 0) {
    text = t("settings.models.primary", { defaultValue: "Primary" });
  } else if (typeof option.callOrderIndex === "number" && option.callOrderIndex > 0) {
    text = t("settings.models.fallbackNumber", {
      number: option.callOrderIndex,
      defaultValue: `Fallback ${option.callOrderIndex}`,
    });
  } else {
    text = t("thread.composer.notInFallbackChain", { defaultValue: "Manual" });
  }
  return (
    <span className={cn(
      "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.06em]",
      option.callOrderIndex === 0
        ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
        : "bg-muted text-muted-foreground",
    )}>
      {text}
    </span>
  );
}

function PresetProviderMark({
  provider,
  model,
  unavailable,
}: {
  provider?: string | null;
  model?: string | null;
  unavailable: boolean;
}) {
  const inferredProvider = provider || inferProviderFromModelName(model || "");
  const brand = providerBrand(inferredProvider);
  const { logoUrl, onLogoError, onLogoLoad } = useLogoFallback(brand?.logoUrls);
  return (
    <span
      className={cn(
        "mt-0.5 grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-full border bg-background",
        unavailable && "opacity-45 grayscale",
      )}
      style={{
        borderColor: brand ? `${brand.color}28` : undefined,
        boxShadow: brand ? `inset 0 0 0 1px ${brand.color}18` : undefined,
      }}
      aria-hidden
    >
      {logoUrl ? (
        <img
          src={logoUrl}
          alt=""
          draggable={false}
          decoding="async"
          loading="lazy"
          className="h-4 w-4 object-contain"
          onLoad={onLogoLoad}
          onError={onLogoError}
        />
      ) : brand ? (
        <span
          className="grid h-full w-full place-items-center text-[9px] font-semibold text-white"
          style={{ backgroundColor: brand.color }}
        >
          {brand.initials.slice(0, 2)}
        </span>
      ) : (
        <Sparkles className="h-3.5 w-3.5 text-muted-foreground/65" />
      )}
    </span>
  );
}

function PresetPill({
  label,
  modelDetail,
  provider,
  providerLabel,
  needsSetup = false,
  fallbackModelName,
  isHero,
  showChevron = false,
}: {
  label: string;
  modelDetail?: string | null;
  provider?: string | null;
  providerLabel?: string | null;
  needsSetup?: boolean;
  fallbackModelName?: string | null;
  isHero: boolean;
  showChevron?: boolean;
}) {
  const labelRef = useRef<HTMLSpanElement | null>(null);
  const [labelOverflows, setLabelOverflows] = useState(false);
  const inferredProvider = needsSetup
    ? null
    : provider || inferProviderFromModelName(modelDetail || label);
  const brand = providerBrand(inferredProvider);
  const { logoUrl, onLogoError, onLogoLoad } = useLogoFallback(brand?.logoUrls);
  const title = [...new Set([label, modelDetail, providerLabel].filter(Boolean))].join(" · ");

  useLayoutEffect(() => {
    const node = labelRef.current;
    if (!node) return;
    const update = () => setLabelOverflows(node.scrollWidth > node.clientWidth + 1);
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(node);
    return () => observer?.disconnect();
  }, [label]);

  return (
    <span
      data-fallback={fallbackModelName ? "true" : undefined}
      title={fallbackModelName || title || undefined}
      className={cn(
        "composer-model-badge composer-model-pill inline-flex h-full w-fit max-w-full min-w-0 shrink-0 items-center rounded-full border border-border/55 bg-card font-medium text-foreground/70",
        "shadow-[0_2px_8px_rgba(15,23,42,0.045)] transition-[color,background-color,border-color,transform] duration-150 ease-out group-focus-visible/model-badge:ring-2 group-focus-visible/model-badge:ring-ring/45",
        needsSetup && "border-amber-500/35 bg-amber-50/70 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200",
        isHero ? "gap-1.5 px-2.5 text-[12px]" : "gap-2 px-3 text-[12.5px]",
      )}
    >
      <span
        data-testid={needsSetup
          ? "composer-model-setup-icon"
          : `composer-model-logo${inferredProvider ? `-${inferredProvider}` : ""}`}
        className={cn(
          "grid shrink-0 place-items-center overflow-hidden",
          needsSetup ? "text-amber-800 dark:text-amber-200" : "rounded-full border bg-background",
          isHero ? "h-4 w-4" : "h-[18px] w-[18px]",
        )}
        style={{
          borderColor: !needsSetup && brand ? `${brand.color}28` : undefined,
          boxShadow: !needsSetup && brand ? `inset 0 0 0 1px ${brand.color}18` : undefined,
        }}
        aria-hidden
      >
        {needsSetup ? (
          <CircleHelp className={cn(isHero ? "h-3 w-3" : "h-3.5 w-3.5")} strokeWidth={1.8} />
        ) : logoUrl ? (
          <img
            src={logoUrl}
            alt=""
            draggable={false}
            decoding="async"
            loading="lazy"
            className={cn("object-contain", isHero ? "h-3 w-3" : "h-3.5 w-3.5")}
            onLoad={onLogoLoad}
            onError={onLogoError}
          />
        ) : brand ? (
          <span
            className={cn(
              "grid h-full w-full place-items-center rounded-full text-white",
              isHero ? "text-[7.5px]" : "text-[8px]",
            )}
            style={{ backgroundColor: brand.color }}
          >
            {brand.initials.slice(0, 2)}
          </span>
        ) : (
          <Sparkles className="h-3 w-3 text-muted-foreground/65" />
        )}
      </span>
      <span
        ref={labelRef}
        className={cn(
          "thread-composer-model-label min-w-0 overflow-hidden whitespace-nowrap text-center",
          labelOverflows && "thread-composer-model-label-fade",
        )}
      >
        {label}
      </span>
      {showChevron ? (
        <ChevronDown
          className="h-3 w-3 shrink-0 text-muted-foreground/70 transition-transform group-data-[state=open]/model-badge:rotate-180"
          aria-hidden
        />
      ) : null}
    </span>
  );
}
