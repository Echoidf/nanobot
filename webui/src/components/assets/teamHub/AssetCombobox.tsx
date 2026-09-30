import { useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { ComboboxOption, useComboboxNavigation } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Searchable picker for a local skill or MCP server.
 *
 * Replaces a native `<select>`: the candidate list is user-authored and can
 * grow, so it needs filtering and keyboard navigation rather than a native
 * list box. Follows the same Popover + ComboboxOption shape as the model
 * picker in settings.
 */
export function AssetCombobox({
  value,
  options,
  onChange,
  placeholder,
  searchPlaceholder,
  emptyLabel,
  kindLabel,
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  placeholder: string;
  searchPlaceholder: string;
  emptyLabel: string;
  kindLabel: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const visible = query.trim()
    ? options.filter((option) => option.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  const navigation = useComboboxNavigation({
    open,
    values: visible,
    selectedValue: value,
    onSelect: (option) => {
      onChange(option);
      setOpen(false);
      setQuery("");
    },
    onClose: () => setOpen(false),
  });

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "h-10 w-full justify-between rounded-control border-input bg-background px-3 text-sm font-normal shadow-none",
            "hover:bg-accent/55 focus-visible:ring-2 focus-visible:ring-ring",
            !value && "text-muted-foreground",
          )}
        >
          <span className="min-w-0 truncate">{value || placeholder}</span>
          <ChevronDown className="ml-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[320px] max-w-[calc(100vw-2rem)] p-1.5"
      >
        <div className="p-1 pb-1.5">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              {...navigation.inputProps}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="h-8 rounded-full pl-8 pr-3 text-[12px]"
            />
          </div>
        </div>
        {!options.length ? (
          <p className="px-2 py-1.5 text-[11px] leading-4 text-muted-foreground">{emptyLabel}</p>
        ) : null}
        {!!options.length && !visible.length ? (
          <p className="px-2 py-1.5 text-[11px] leading-4 text-muted-foreground">
            {t("assets.teamHub.noMatch", { defaultValue: "No match." })}
          </p>
        ) : null}
        <div className="max-h-64 overflow-y-auto">
          {visible.map((option) => (
            <ComboboxOption
              key={option}
              {...navigation.getOptionProps(option)}
              className={cn(
                "flex cursor-default items-center justify-between gap-2 rounded-control px-2 py-1.5 text-[12px]",
                option === value && "text-foreground",
              )}
            >
              <span className="min-w-0 truncate">{option}</span>
              {option === value ? (
                <Check className="h-3.5 w-3.5 shrink-0 text-foreground" aria-hidden />
              ) : null}
            </ComboboxOption>
          ))}
        </div>
        {kindLabel ? (
          <p className="px-2 py-1.5 text-[10px] text-muted-foreground/80">{kindLabel}</p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
