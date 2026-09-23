import { type ReactNode } from "react";

import type { CardOption, CardOptionsData } from "@/lib/card-options";
import { cn } from "@/lib/utils";

/**
 * Pluggable per-option card body.
 *
 * The shell (badge, title, description, hover/selected states, click target)
 * lives in ``CardOptionTile``; everything between the description and the tile
 * edge is owned by the renderer resolved for ``option.kind``.
 *
 * Register a new style from a module imported for side effects:
 *
 * ```tsx
 * registerCardRenderer("image", ({ option }) => <MyPreview url={option.imageUrl} />);
 * ```
 *
 * Unknown kinds fall back to ``"default"``, so a payload from a newer agent
 * still renders as a plain, clickable card instead of nothing.
 */
export interface CardBodyContext {
  option: CardOption;
  group: CardOptionsData;
  selected: boolean;
  disabled: boolean;
}

export type CardBodyRenderer = (context: CardBodyContext) => ReactNode;

const registry = new Map<string, CardBodyRenderer>();

export function registerCardRenderer(kind: string, renderer: CardBodyRenderer): void {
  registry.set(kind, renderer);
}

export function resolveCardRenderer(kind?: string): CardBodyRenderer {
  return (kind ? registry.get(kind) : undefined) ?? registry.get("default") ?? renderNothing;
}

function renderNothing(): null {
  return null;
}

/** Default body: an ``imageUrl`` earns a thumbnail, anything else renders nothing. */
function ImageCardBody({ option }: CardBodyContext): ReactNode {
  const src = option.imageUrl
    ?? (typeof option.meta?.imageUrl === "string" ? option.meta.imageUrl : undefined);
  if (!src) return null;
  return <CardImagePreview src={src} />;
}

function CardImagePreview({ src, className }: { src: string; className?: string }) {
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      draggable={false}
      className={cn(
        "mt-2 block h-20 w-full rounded-mark border border-border/60 bg-muted/40 object-cover",
        className,
      )}
    />
  );
}

/** Progress card: thin meter plus an accessible value. */
function ProgressCardBody(context: CardBodyContext): ReactNode {
  const value = Math.round(context.option.progress ?? 0);
  return (
    <span className="mt-2 block" aria-label={`${value}%`}>
      <span className="block h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <span
          className={cn(
            "block h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none",
            context.disabled && "opacity-70",
          )}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </span>
      <span className="mt-1 block text-[11px] leading-none tabular-nums text-muted-foreground">
        {value}%
      </span>
    </span>
  );
}

// ``default`` and ``image`` share a renderer so any option carrying an image
// previews consistently, even when a newer agent introduces an unknown kind.
registerCardRenderer("default", ImageCardBody);
registerCardRenderer("image", ImageCardBody);
registerCardRenderer("progress", ProgressCardBody);
