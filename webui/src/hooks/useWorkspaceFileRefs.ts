import { useEffect, useState } from "react";

import { fetchWorkspaceFiles } from "@/lib/api";
import type { WorkspaceFileCandidate, WorkspaceScopePayload } from "@/lib/types";

export function splitWorkspaceFileQuery(raw: string): { dir?: string; query: string } {
  const normalized = raw.replace(/\\/g, "/").replace(/^\.+\//, "");
  if (!normalized) {
    return { query: "" };
  }
  // "@src/components/" means "list this directory", not "search from root".
  if (normalized.endsWith("/")) {
    const dir = normalized.replace(/\/+$/, "") || ".";
    return { dir, query: "" };
  }
  if (!normalized.includes("/")) {
    return { query: normalized };
  }
  const lastSlash = normalized.lastIndexOf("/");
  const dir = normalized.slice(0, lastSlash) || ".";
  const query = normalized.slice(lastSlash + 1);
  return { dir, query };
}

export function useWorkspaceFileRefs(
  token: string,
  scope: WorkspaceScopePayload | null | undefined,
  sessionKey: string | null | undefined,
  query: string,
  enabled = true,
): { candidates: WorkspaceFileCandidate[]; loading: boolean } {
  const [candidates, setCandidates] = useState<WorkspaceFileCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!enabled || !scope?.project_path || !token) {
      setCandidates([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const { dir, query: fileQuery } = splitWorkspaceFileQuery(query);
    const timer = window.setTimeout(() => {
      fetchWorkspaceFiles(token, {
        scope: sessionKey ?? null,
        projectPath: scope.project_path,
        accessMode: scope.access_mode,
        ...(dir ? { dir } : {}),
        ...(fileQuery ? { query: fileQuery } : {}),
      })
        .then((payload) => {
          if (!cancelled) setCandidates(payload.items);
        })
        .catch(() => {
          if (!cancelled) setCandidates([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    enabled,
    query,
    scope?.access_mode,
    scope?.project_path,
    sessionKey,
    token,
  ]);
  return { candidates, loading };
}
