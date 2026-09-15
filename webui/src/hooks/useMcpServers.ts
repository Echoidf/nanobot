import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchMcpPresets,
  removeMcpServer,
  runMcpPresetAction,
  saveCustomMcpServer,
  setMcpServerEnabled,
  testMcpPreset,
} from "@/lib/api";
import { notifyMcpPresetsChanged } from "@/lib/mcp-preset-events";
import type { McpPresetInfo, McpPresetsPayload } from "@/lib/types";
import { useClient } from "@/providers/ClientProvider";
import { usePageVisibility } from "@/hooks/usePageVisibility";

const MCP_CONNECTING_POLL_MS = 1_000;

export type McpServerAction =
  | "toggle"
  | "save"
  | "test"
  | "remove"
  | "reconnect";

export interface McpServersController {
  presets: McpPresetInfo[];
  payload: McpPresetsPayload | null;
  loading: boolean;
  /** ``action:name`` key of the row currently busy, so buttons can spin in place. */
  actionKey: string | null;
  error: string | null;
  message: string | null;
  requiresRestart: boolean;
  refresh: () => Promise<void>;
  dismissStatus: () => void;
  toggleServer: (preset: McpPresetInfo, enabled: boolean) => Promise<void>;
  saveServer: (values: Record<string, string>) => Promise<boolean>;
  testServer: (name: string) => Promise<void>;
  removeServer: (name: string) => Promise<void>;
  reconnectServer: (name: string) => Promise<void>;
}

/**
 * MCP server state for the dedicated management page.
 *
 * Owns the list payload and every mutation the page can trigger, and republishes
 * each successful mutation through ``notifyMcpPresetsChanged`` so the composer's
 * MCP mention list and the Apps settings page stay consistent without a reload.
 */
export function useMcpServers(): McpServersController {
  const { client, getToken } = useClient();
  const pageVisible = usePageVisibility();
  const [payload, setPayload] = useState<McpPresetsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const applyPayload = useCallback((next: McpPresetsPayload) => {
    setPayload(next);
    notifyMcpPresetsChanged(next);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchMcpPresets(getToken());
      if (cancelledRef.current) return;
      setPayload(next);
    } catch (reason) {
      if (!cancelledRef.current) setError((reason as Error).message);
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    if (!pageVisible) return;
    void refresh();
  }, [pageVisible, refresh]);

  // Connection attempts are asynchronous; keep polling only while one is live.
  useEffect(() => {
    if (!pageVisible) return;
    const connecting = (payload?.presets ?? []).some(
      (preset) => preset.runtime_status === "connecting",
    );
    if (!connecting) return;
    const timer = window.setTimeout(() => {
      if (!cancelledRef.current) void refresh();
    }, MCP_CONNECTING_POLL_MS);
    return () => window.clearTimeout(timer);
  }, [pageVisible, payload, refresh]);

  const runAction = useCallback(
    async (key: string, action: () => Promise<McpPresetsPayload>) => {
      setActionKey(key);
      setError(null);
      try {
        const next = await action();
        if (cancelledRef.current) return;
        applyPayload(next);
        const failure = next.last_action?.ok === false
          ? next.last_action.error || next.last_action.message
          : next.hot_reload?.ok === false
            ? next.hot_reload.message
            : null;
        setError(failure);
        setMessage(failure ? null : next.last_action?.message ?? null);
      } catch (reason) {
        if (!cancelledRef.current) setError((reason as Error).message);
      } finally {
        if (!cancelledRef.current) setActionKey(null);
      }
    },
    [applyPayload],
  );

  const toggleServer = useCallback(
    async (preset: McpPresetInfo, enabled: boolean) => {
      await runAction(`${enabled ? "enable" : "disable"}:${preset.name}`, () =>
        setMcpServerEnabled(client, preset.name, enabled),
      );
    },
    [client, runAction],
  );

  const saveServer = useCallback(
    async (values: Record<string, string>) => {
      let ok = false;
      await runAction(`save:${values.name || "new"}`, async () => {
        const next = await saveCustomMcpServer(client, values);
        ok = next.last_action?.ok !== false;
        return next;
      });
      return ok;
    },
    [client, runAction],
  );

  const testServer = useCallback(
    async (name: string) => {
      await runAction(`test:${name}`, () => testMcpPreset(client, name));
    },
    [client, runAction],
  );

  const removeServer = useCallback(
    async (name: string) => {
      await runAction(`remove:${name}`, () => removeMcpServer(client, name));
    },
    [client, runAction],
  );

  const reconnectServer = useCallback(
    async (name: string) => {
      await runAction(`reconnect:${name}`, () =>
        runMcpPresetAction(client, "reconnect", name),
      );
    },
    [client, runAction],
  );

  return {
    presets: payload?.presets ?? [],
    payload,
    loading,
    actionKey,
    error,
    message,
    requiresRestart: Boolean(payload?.requires_restart),
    refresh,
    dismissStatus: () => {
      setError(null);
      setMessage(null);
    },
    toggleServer,
    saveServer,
    testServer,
    removeServer,
    reconnectServer,
  };
}
