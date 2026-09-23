import { useCallback, useEffect, useRef, useState } from "react";

import { sessionOwnerApi } from "@/lib/api";
import type { SessionOwnerStatus } from "@/lib/types";

function ownerId(): string {
  const key = "nanodesk.session-owner-id";
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const created = `web-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    localStorage.setItem(key, created);
    return created;
  } catch {
    return `web-${Math.random().toString(36).slice(2)}`;
  }
}

export function useSessionOwner(active: boolean, token: string, sessionKey: string) {
  const [status, setStatus] = useState<SessionOwnerStatus | null>(null);
  const [mine] = useState(() => ownerId());
  const [conflict, setConflict] = useState(false);
  const timer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (!active || !token || !sessionKey) return;
    try {
      const current = await sessionOwnerApi.status(token, sessionKey);
      setStatus(current);
      setConflict(Boolean(current.active && current.owner && current.owner !== mine));
    } catch {
      /* owner lock is advisory; ignore */
    }
  }, [active, token, sessionKey, mine]);

  const claim = useCallback(async () => {
    if (!token || !sessionKey) return false;
    try {
      const current = await sessionOwnerApi.claim(token, sessionKey, mine);
      setStatus(current);
      setConflict(false);
      return true;
    } catch {
      setConflict(true);
      await refresh();
      return false;
    }
  }, [token, sessionKey, mine, refresh]);

  useEffect(() => {
    if (!active) return;
    void claim();
    timer.current = window.setInterval(() => {
      void sessionOwnerApi.heartbeat(token, sessionKey, mine).catch(() => undefined);
    }, 30_000);
    const onHide = () => {
      if (document.visibilityState === "hidden") {
        sessionOwnerApi.release(token, sessionKey, mine).catch(() => undefined);
      } else {
        void claim();
      }
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", () => {
      sessionOwnerApi.release(token, sessionKey, mine).catch(() => undefined);
    });
    return () => {
      if (timer.current) window.clearInterval(timer.current);
      document.removeEventListener("visibilitychange", onHide);
      sessionOwnerApi.release(token, sessionKey, mine).catch(() => undefined);
    };
  }, [active, token, sessionKey, mine, claim]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { status, mine, conflict, refresh, claim };
}
