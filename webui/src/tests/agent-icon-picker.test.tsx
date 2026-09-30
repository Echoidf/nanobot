import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AgentWorkbenchView } from "@/components/agents/AgentWorkbenchView";
import type { AgentProfileUpdate } from "@/lib/api";

type SaveAction = "create" | "update" | "delete";
type OnSave = (action: SaveAction, profile: AgentProfileUpdate) => Promise<void>;

function makeOnSave() {
  return vi.fn<OnSave>().mockResolvedValue(undefined);
}

function renderWorkbench(onSave = makeOnSave()) {
  return render(
    <AgentWorkbenchView
      agents={[]}
      onRefresh={vi.fn()}
      onSave={onSave}
      modelPresets={[]}
      skillCatalog={[]}
    />,
  );
}

describe("agent icon picker", () => {
  it("offers the bundled avatar cards instead of emoji glyphs", async () => {
    const user = userEvent.setup();
    renderWorkbench();

    await user.click(screen.getByRole("button", { name: /创建 Agent|Create agent/ }));

    const tiles = screen.getAllByRole("button", {
      name: /^(系统默认|通用助手|编程开发|写作创作|数据分析|图像设计|语音助手|翻译|客服支持|安全风控)$/,
    });
    expect(tiles).toHaveLength(10);
    for (const tile of tiles) {
      const image = tile.querySelector("img");
      expect(image).not.toBeNull();
      expect(image?.getAttribute("src")).toMatch(/^\/agent\/.+\.png$/);
      expect(image?.getAttribute("alt")).toBe("");
      expect(tile.getAttribute("aria-pressed")).toBe("false");
    }
  });

  it("stores the selected card path as the agent icon", async () => {
    const user = userEvent.setup();
    const onSave = makeOnSave();
    renderWorkbench(onSave);

    await user.click(screen.getByRole("button", { name: /创建 Agent|Create agent/ }));
    await user.type(screen.getByLabelText(/^(名称|Name)$/), "翻译");
    await user.click(screen.getByRole("button", { name: "翻译" }));
    expect(screen.getByRole("button", { name: "翻译" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: /保存|Save/ }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]?.[1]).toMatchObject({ name: "翻译", icon: "/agent/翻译.png" });
  });

  it("surfaces the backend reason when saving is rejected", async () => {
    const user = userEvent.setup();
    const onSave = vi
      .fn<OnSave>()
      .mockRejectedValue(new Error("Invalid configuration: teamAssets.instanceId"));
    renderWorkbench(onSave);

    await user.click(screen.getByRole("button", { name: /创建 Agent|Create agent/ }));
    await user.type(screen.getByLabelText(/^(名称|Name)$/), "My Agent");
    await user.click(screen.getByRole("button", { name: /保存|Save/ }));

    // The dialog must stay open *and* explain why, instead of failing silently.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("teamAssets.instanceId");
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Reopening clears the stale error.
    await user.click(screen.getByRole("button", { name: /取消|Cancel/ }));
    await user.click(screen.getByRole("button", { name: /创建 Agent|Create agent/ }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("falls back to localized copy when the failure carries no message", async () => {
    const user = userEvent.setup();
    renderWorkbench(vi.fn<OnSave>().mockRejectedValue(new Error("")));

    await user.click(screen.getByRole("button", { name: /创建 Agent|Create agent/ }));
    await user.type(screen.getByLabelText(/^(名称|Name)$/), "My Agent");
    await user.click(screen.getByRole("button", { name: /保存|Save/ }));

    const alert = await screen.findByRole("alert");
    expect(alert).not.toHaveTextContent("teamAssets");
    expect(alert.textContent?.trim()).not.toBe("");
  });
});
