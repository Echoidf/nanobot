import { Loader2 } from "lucide-react";

export const SOURCE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

type Translate = (key: string, options?: Record<string, unknown>) => string;

export function describeError(
  reason: unknown,
  fallback: string,
): string {
  if (reason instanceof Error && reason.message) return reason.message;
  return fallback;
}

/**
 * Team-asset errors with an action hint in front and the raw server
 * message kept in parentheses, so users know what to do next instead
 * of guessing. Matching is on the English server message (the backend
 * always responds in English); the hint itself is translated.
 */
const TEAM_ERROR_HINTS: Array<{ match: string; key: string; fallback: string }> = [
  {
    match: "remote team asset changes are disabled",
    key: "assets.teamHub.errRemoteDenied",
    fallback:
      "This action is only accepted from a browser on that instance's own machine. Open this page there via http://127.0.0.1:18790, or enable remote package install for the intranet.",
  },
  {
    match: "did not respond in time",
    key: "assets.teamHub.errUnreachable",
    fallback:
      "The team instance did not answer. Check its host/port, that its gateway is running with team assets enabled, and that the port is reachable from here.",
  },
  {
    match: "is unreachable",
    key: "assets.teamHub.errUnreachable",
    fallback:
      "The team instance did not answer. Check its host/port, that its gateway is running with team assets enabled, and that the port is reachable from here.",
  },
  {
    match: "url is blocked",
    key: "assets.teamHub.errBlocked",
    fallback:
      "This address is blocked by the SSRF guard. Add the team's network CIDR to tools.ssrf_whitelist on this instance and retry.",
  },
  {
    match: "already bound to",
    key: "assets.teamHub.errAlreadyBound",
    fallback:
      "This team id is already bound to a different address. Unbind it first, or re-probe: the peer may have been replaced.",
  },
  {
    match: "unknown team instance",
    key: "assets.teamHub.errUnknownInstance",
    fallback:
      "No binding with this id exists on this instance. It may already have been removed — reload the list.",
  },
  {
    match: "reload the catalog",
    key: "assets.teamHub.errStaleCatalog",
    fallback:
      "The asset changed after you listed it. Reload the catalog and retry with the current version.",
  },
  {
    match: "already reviewed",
    key: "assets.teamHub.errAlreadyReviewed",
    fallback:
      "This submission was already reviewed. Use the history list to take down an approved version if needed.",
  },
  {
    match: "already in progress",
    key: "assets.teamHub.errInstallBusy",
    fallback:
      "Another asset installation is still running. Wait for it to finish and retry.",
  },
];

export function describeTeamError(
  reason: unknown,
  t: Translate,
  fallback: string,
): string {
  const raw = reason instanceof Error && reason.message ? reason.message : "";
  const text = raw || fallback;
  const lowered = text.toLowerCase();
  for (const hint of TEAM_ERROR_HINTS) {
    if (lowered.includes(hint.match)) {
      const hintText = t(hint.key, { defaultValue: hint.fallback });
      return raw ? `${hintText} (${raw})` : hintText;
    }
  }
  return text;
}

export function formatTime(value: number): string {
  if (!value) return "";
  try {
    return new Date(value * 1000).toLocaleString();
  } catch {
    return "";
  }
}

export function TeamEmptyState({ message }: { message: string }) {
  return (
    <p className="rounded-panel border border-dashed border-border/55 bg-settings-surface px-4 py-8 text-center text-sm text-muted-foreground">
      {message}
    </p>
  );
}

export function TeamPending({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-2 text-xs text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      {label}
    </p>
  );
}
