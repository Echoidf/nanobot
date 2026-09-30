import { Loader2 } from "lucide-react";

export const SOURCE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function describeError(
  reason: unknown,
  fallback: string,
): string {
  if (reason instanceof Error && reason.message) return reason.message;
  return fallback;
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
