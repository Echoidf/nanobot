import { Bot } from "lucide-react";

import { cn } from "@/lib/utils";

const IMAGE_ICON_EXTENSION = /\.(?:svg|png|jpe?g|webp|gif|ico)(?:\?[^\s]*)?$/i;
const IMAGE_ICON_LOCATION = /^(?:\/|\.\/|\.\.\/|https?:\/\/|data:image\/)/i;

/**
 * Agent icons are usually emoji or short text, but brand assets are referenced
 * by image path (e.g. `/brand/nanodesk_favicon.svg`). Only the WebUI can render
 * those; terminal output falls back to the agent name alone.
 */
export function isImageAgentIcon(icon: string | null | undefined): boolean {
  const value = icon?.trim() ?? "";
  if (!value) return false;
  return IMAGE_ICON_EXTENSION.test(value) || IMAGE_ICON_LOCATION.test(value);
}

/**
 * `imageClassName` must pass an explicit `object-fit` when the icon is one of
 * the bundled 313x418 `/agent/` cards: those are portrait, so a square box
 * letterboxes them into an unreadable sliver. Pick a 3:4 box and keep the
 * default, or crop deliberately with `object-cover` at chip sizes.
 */
export function AgentIcon({
  icon,
  imageClassName,
  fallbackClassName,
}: {
  icon?: string | null;
  /** Size/shape applied to an image icon. */
  imageClassName: string;
  /** Size applied to the fallback glyph when no icon is configured. */
  fallbackClassName: string;
}) {
  const value = icon?.trim() ?? "";
  if (!value) return <Bot className={fallbackClassName} aria-hidden />;
  if (isImageAgentIcon(value)) {
    return (
      <img
        src={value}
        alt=""
        aria-hidden
        className={cn("shrink-0 object-contain", imageClassName)}
      />
    );
  }
  return <>{value}</>;
}
