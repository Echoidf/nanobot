import { describe, expect, it, vi } from "vitest";

import { agentDescription, DEFAULT_AGENT_ID } from "@/lib/agent-copy";

function translateWith(messages: Record<string, string>) {
  return vi.fn((key: string, options?: { defaultValue?: string }) => {
    if (key in messages) return messages[key];
    return options?.defaultValue ?? key;
  });
}

describe("agentDescription", () => {
  it("localizes the built-in default agent description", () => {
    const t = translateWith({
      "agents.profile.defaultDescription": "默认助手，使用全局模型、技能与工具。",
    });

    expect(agentDescription({ id: DEFAULT_AGENT_ID, description: "" }, t)).toBe(
      "默认助手，使用全局模型、技能与工具。",
    );
    // The backend-generated English copy must never win over the locale.
    expect(
      agentDescription(
        {
          id: DEFAULT_AGENT_ID,
          description: "Default NanoDesk assistant using the global model, skills, and tools.",
        },
        t,
      ),
    ).toBe("默认助手，使用全局模型、技能与工具。");
  });

  it("falls back to the English default when the key is absent", () => {
    const en = translateWith({});
    expect(
      agentDescription({ id: DEFAULT_AGENT_ID, description: "" }, en),
    ).toBe("Default NanoDesk assistant using the global model, skills, and tools.");
  });

  it("renders user-authored descriptions verbatim", () => {
    const zh = translateWith({
      "agents.profile.defaultDescription": "默认助手",
      "agents.workbench.noDescription": "暂无简介。",
    });
    expect(agentDescription({ id: "translator", description: "我的翻译助手" }, zh)).toBe(
      "我的翻译助手",
    );
  });

  it("shows the localized placeholder when a custom agent has no description", () => {
    const zh = translateWith({ "agents.workbench.noDescription": "暂无简介。" });
    expect(agentDescription({ id: "translator", description: "   " }, zh)).toBe("暂无简介。");
  });
});
