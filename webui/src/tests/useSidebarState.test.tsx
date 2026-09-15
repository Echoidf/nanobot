import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { useSidebarState } from "@/hooks/useSidebarState";
import type { NanodeskClient } from "@/lib/nanodesk-client";
import type { ChatSummary, SidebarStatePayload } from "@/lib/types";
import { ClientProvider } from "@/providers/ClientProvider";

describe("useSidebarState", () => {
  it("serializes full-state writes so an older request cannot overwrite a newer update", async () => {
    let resolveFirstWrite: (() => void) | null = null;
    let sidebarStateUpdateHandler: ((state: SidebarStatePayload) => void) | null = null;
    const setSidebarState = vi.fn()
      .mockImplementationOnce((state: SidebarStatePayload) => new Promise<SidebarStatePayload>(
        (resolve) => {
          resolveFirstWrite = () => resolve(state);
        },
      ))
      .mockImplementation(async (state: SidebarStatePayload) => state);
    const client = {
      status: "open" as const,
      onStatus: () => () => {},
      onSidebarStateUpdate: (handler: (state: SidebarStatePayload) => void) => {
        sidebarStateUpdateHandler = handler;
        return () => {
          sidebarStateUpdateHandler = null;
        };
      },
      setSidebarState,
    } as unknown as NanodeskClient;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    }));
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ClientProvider client={client} token="token">
        {children}
      </ClientProvider>
    );
    const { result } = renderHook(() => useSidebarState([], false), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      void result.current.update((current) => ({
        ...current,
        title_overrides: { "websocket:a": "First" },
      }));
      void result.current.update((current) => ({
        ...current,
        title_overrides: { "websocket:a": "Second" },
      }));
    });

    expect(setSidebarState).toHaveBeenCalledTimes(1);
    act(() => {
      sidebarStateUpdateHandler?.(setSidebarState.mock.calls[0]?.[0]);
    });
    expect(result.current.state.title_overrides).toEqual({
      "websocket:a": "Second",
    });
    act(() => resolveFirstWrite?.());
    await waitFor(() => expect(setSidebarState).toHaveBeenCalledTimes(2));
    expect(setSidebarState.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      title_overrides: { "websocket:a": "Second" },
    }));
  });

  it("keeps removed projects while their folder still has topics", async () => {
    const client = {
      status: "open" as const,
      onStatus: () => () => {},
      onSidebarStateUpdate: () => () => {},
      setSidebarState: vi.fn(async (state: SidebarStatePayload) => state),
    } as unknown as NanodeskClient;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        hidden_project_keys: ["/Users/me/alpha/", "/Users/me/gone"],
        collapsed_groups: {
          "project:/Users/me/alpha": true,
          "project:/Users/me/gone": true,
        },
      }),
    }));
    const sessions = [{
      key: "websocket:alpha",
      channel: "websocket",
      chatId: "alpha",
      createdAt: "2026-05-20T10:00:00Z",
      updatedAt: "2026-05-20T10:00:00Z",
      preview: "",
      workspaceScope: {
        project_path: "/Users/me/alpha",
        project_name: "Alpha",
        access_mode: "restricted" as const,
      },
    }] as ChatSummary[];
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ClientProvider client={client} token="token">
        {children}
      </ClientProvider>
    );
    const { result } = renderHook(() => useSidebarState(sessions, true), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.state.hidden_project_keys).toEqual(["/Users/me/alpha"]);
    expect(result.current.state.collapsed_groups).toEqual({
      "project:/Users/me/alpha": true,
    });
    await waitFor(() => expect(setSidebarStateWrite(client)).toEqual(
      expect.objectContaining({ hidden_project_keys: ["/Users/me/alpha"] }),
    ));
  });
});

function setSidebarStateWrite(client: NanodeskClient): unknown {
  const mock = (client.setSidebarState as unknown as ReturnType<typeof vi.fn>);
  return mock.mock.calls[mock.mock.calls.length - 1]?.[0];
}
