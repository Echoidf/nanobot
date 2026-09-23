import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Check, PenLine } from "lucide-react";

import { CardOptionTile } from "@/components/cards/CardOptionTile";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cardChoiceValue, type CardOptionsData } from "@/lib/card-options";
import { cn } from "@/lib/utils";

export interface CardOptionsProps {
  data: CardOptionsData;
  /** Set once the conversation moved past this group: everything locks. */
  answered?: boolean;
  /** Option ids restored from the answering turn, so a refresh re-checks them. */
  selectedIds?: string[];
  /** Deliver the answer (single option value, or ``\n``-joined values). */
  onSelect?: (value: string) => void;
  /** Render ``data.question`` above the grid when it is not already the text. */
  showQuestion?: boolean;
  className?: string;
}

/**
 * Render a card-option group as a responsive grid: stacked on narrow screens,
 * two columns from ``sm`` up. Single-select fires on click, multi-select
 * collects selections behind a confirm button, and ``allowCustomInput`` adds an
 * "Other…" entry that expands a textarea.
 *
 * After the group is answered every tile disables, which is what stops a
 * repeat submit; ``selectedIds`` restores the highlighted choice on replay.
 */
export function CardOptions({
  data,
  answered = false,
  selectedIds,
  onSelect,
  showQuestion = false,
  className,
}: CardOptionsProps) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<string[]>(() => (answered ? selectedIds ?? [] : []));
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState("");
  // A click already sent this group; a second click before React commits must
  // not produce a second user turn.
  const submitLockRef = useRef(false);

  const selectionKey = (selectedIds ?? []).join("\u0000");
  useEffect(() => {
    if (!answered) return;
    setPicked(selectionKey ? selectionKey.split("\u0000") : []);
    setCustomOpen(false);
    setCustomText("");
  }, [answered, selectionKey]);

  const locked = answered || submitLockRef.current;

  const submit = (ids: string[], custom?: string) => {
    if (locked) return;
    const value = cardChoiceValue(data, ids, custom);
    if (!value.trim()) return;
    setPicked(ids);
    setCustomOpen(false);
    setCustomText("");
    if (onSelect) {
      submitLockRef.current = true;
      onSelect(value);
    }
  };

  const toggleOption = (id: string) => {
    setPicked((current) => (
      current.includes(id)
        ? current.filter((entry) => entry !== id)
        : [...current, id]
    ));
  };

  const handleTileClick = (optionId: string) => {
    if (locked) return;
    if (data.multiSelect) {
      toggleOption(optionId);
      return;
    }
    submit([optionId]);
  };

  const submitCustom = (event?: { preventDefault?: () => void }) => {
    event?.preventDefault?.();
    submit(data.multiSelect ? picked : [], customText);
  };

  const customSubmitDisabled = !customText.trim() && picked.length === 0;
  const canSendCustom = !locked && !customSubmitDisabled;

  const handleCustomKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setCustomOpen(false);
      setCustomText("");
      return;
    }
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (canSendCustom) submitCustom();
  };

  return (
    <div data-card-options className={cn("not-prose my-3", className)}>
      {showQuestion ? (
        <p className="mb-2 break-words text-sm font-medium leading-5 text-foreground">
          {data.question}
        </p>
      ) : null}
      <div data-card-option-grid className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {data.options.map((option) => (
          <CardOptionTile
            key={option.id}
            option={option}
            group={data}
            selected={picked.includes(option.id)}
            disabled={locked}
            multiSelect={!!data.multiSelect}
            onSelect={() => handleTileClick(option.id)}
          />
        ))}
      </div>

      {data.multiSelect && !answered ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] leading-none text-muted-foreground">
            {t("cards.multiHint")}
          </span>
          <Button
            type="button"
            size="sm"
            disabled={picked.length === 0}
            onClick={() => submit(picked)}
          >
            {t("cards.confirm", { selected: picked.length })}
          </Button>
        </div>
      ) : null}

      {data.allowCustomInput && !answered ? (
        <div className="mt-2" data-card-custom-input>
          {customOpen ? (
            <div className="flex items-start gap-2">
              <Textarea
                autoFocus
                rows={2}
                value={customText}
                placeholder={t("cards.customPlaceholder")}
                aria-label={t("cards.customPlaceholder")}
                onChange={(event) => setCustomText(event.target.value)}
                onKeyDown={handleCustomKeyDown}
                className="min-h-16 flex-1 resize-none text-sm"
              />
              <Button
                type="button"
                size="sm"
                disabled={!canSendCustom}
                onClick={submitCustom}
              >
                {t("cards.send")}
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCustomOpen(true)}
              className={cn(
                "inline-flex w-full items-center justify-center gap-1.5 rounded-control border border-dashed border-muted-foreground/45 px-3 py-2",
                "text-xs text-muted-foreground transition-colors hover:border-muted-foreground/70 hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <PenLine className="h-3.5 w-3.5" aria-hidden />
              {t("cards.other")}
            </button>
          )}
        </div>
      ) : null}

      {answered ? (
        <p
          role="status"
          className="mt-2 inline-flex items-center gap-1 text-[11px] leading-none text-muted-foreground"
        >
          <Check className="h-3 w-3" aria-hidden />
          {t("cards.answered")}
        </p>
      ) : null}
    </div>
  );
}
