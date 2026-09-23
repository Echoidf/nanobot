import { describe, expect, it } from "vitest";

import {
  cardChoiceSelectedIds,
  cardChoiceTitle,
  cardChoiceValue,
  extractCardOptionsFromText,
  parseCardOptionsBlob,
  parseCardOptionsData,
  parseCardOptionsFence,
} from "@/lib/card-options";
import { projectWebuiThreadMessages } from "@/lib/thread-display-compat";
import type { UIMessage } from "@/lib/types";

const OPTIONS = [
  { id: "plan-a", title: "Starter", value: "plan-a" },
  { id: "plan-b", title: "Pro", value: "plan-b" },
  { id: "plan-c", title: "Team", value: "plan-c" },
];

function cardMessage(overrides: Partial<UIMessage> = {}): UIMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    content: "Pick a plan.",
    createdAt: 1700000001000,
    cardOptions: {
      type: "card_options",
      question: "Pick a plan.",
      options: OPTIONS,
    },
    ...overrides,
  };
}

function userMessage(content: string, id = "user-1", createdAt = 1700000002000): UIMessage {
  return { id, role: "user", content, createdAt };
}

describe("parseCardOptionsData", () => {
  it("keeps every documented field and applies the documented defaults", () => {
    const data = parseCardOptionsData({
      type: "card_options",
      question: "Which model?",
      multiSelect: true,
      allowCustomInput: true,
      options: [
        { id: "fast", title: "Fast", description: "cheapest", icon: "⚡", value: "use-fast" },
        { title: "Accurate" },
        { id: "odd", title: "Odd", kind: "progress", progress: 120, imageUrl: "https://img/x.png" },
      ],
    });

    expect(data).not.toBeNull();
    expect(data?.type).toBe("card_options");
    expect(data?.question).toBe("Which model?");
    expect(data?.multiSelect).toBe(true);
    expect(data?.allowCustomInput).toBe(true);
    expect(data?.options).toHaveLength(3);
    expect(data?.options[0]).toEqual({
      id: "fast",
      title: "Fast",
      description: "cheapest",
      icon: "⚡",
      value: "use-fast",
    });
    // Missing id/value fall back to a generated id and the title.
    expect(data?.options[1]).toEqual({ id: "option-2", title: "Accurate", value: "Accurate" });
    // progress is clamped into range.
    expect(data?.options[2]).toMatchObject({ kind: "progress", progress: 100 });
  });

  it("rejects payloads that are not renderable", () => {
    expect(parseCardOptionsData(null)).toBeNull();
    expect(parseCardOptionsData("cards")).toBeNull();
    expect(parseCardOptionsData({ question: "Any?" })).toBeNull();
    expect(parseCardOptionsData({ options: [{ title: "A" }] })).toBeNull();
    expect(parseCardOptionsData({ question: "Any?", options: [{ title: "" }] })).toBeNull();
  });

  it("deduplicates option ids with the producer's rule", () => {
    const data = parseCardOptionsData({
      question: "Pick",
      options: [
        { id: "x", title: "First" },
        { id: "x", title: "Second" },
      ],
    });
    expect(data?.options.map((option) => option.id)).toEqual(["x", "x-2"]);
  });
});

describe("parseCardOptionsBlob", () => {
  it("accepts card blobs and ignores other agent_ui payloads", () => {
    expect(parseCardOptionsBlob({ kind: "panel", data: { version: 1 } })).toBeNull();
    expect(
      parseCardOptionsBlob({
        kind: "card_options",
        data: { question: "Go?", options: [{ title: "Yes" }] },
      }),
    ).toMatchObject({ question: "Go?", options: [{ id: "option-1" }] });
  });
});

describe("parseCardOptionsFence", () => {
  it("tolerates trailing commas in model-written JSON", () => {
    const data = parseCardOptionsFence(`{
      "question": "Pick one",
      "options": [ {"title": "A"}, {"title": "B"}, ]
    }`);
    expect(data?.options.map((option) => option.title)).toEqual(["A", "B"]);
  });

  it("returns null for broken JSON", () => {
    expect(parseCardOptionsFence("{not json}")).toBeNull();
  });
});

describe("extractCardOptionsFromText", () => {
  it("hoists a fence and strips it from the rendered text", () => {
    const text = [
      "Pick a runtime:",
      "",
      "```cards",
      '{"question":"Pick a runtime:","options":[{"title":"Python","value":"python"}]}',
      "```",
      "",
      "You can change later.",
    ].join("\n");

    const { data, content } = extractCardOptionsFromText(text);
    expect(data?.options[0]).toMatchObject({ title: "Python", value: "python" });
    expect(content).not.toContain("```cards");
    expect(content).not.toContain('"question"');
    expect(content).toContain("Pick a runtime:");
    expect(content).toContain("You can change later.");
  });

  it("leaves a broken fence alone so the code renderer can still show it", () => {
    const text = "```cards\n{oops\n```";
    const { data, content } = extractCardOptionsFromText(text);
    expect(data).toBeNull();
    expect(content).toBe(text);
  });

  it("ignores unrelated fences", () => {
    const text = "```python\nprint('hi')\n```";
    expect(extractCardOptionsFromText(text)).toEqual({ data: null, content: text });
  });
});

describe("card selection encoding", () => {
  it("joins multi-select values with newlines and relabels them to titles", () => {
    const group = { type: "card_options" as const, question: "Pick", options: OPTIONS };
    const value = cardChoiceValue(group, ["plan-a", "plan-c"]);
    expect(value).toBe("plan-a\nplan-c");
    expect(cardChoiceTitle(value, group)).toBe("Starter、Team");
    expect(cardChoiceSelectedIds(value, group)).toEqual(["plan-a", "plan-c"]);
  });

  it("keeps custom text verbatim but swaps matched option lines", () => {
    const group = { type: "card_options" as const, question: "Pick", options: OPTIONS };
    const value = cardChoiceValue(group, ["plan-b"], "custom answer");
    expect(value).toBe("plan-b\ncustom answer");
    expect(cardChoiceTitle(value, group)).toBe("Pro\ncustom answer");
    expect(cardChoiceTitle("just typing", group)).toBeNull();
  });
});

describe("resolveCardChoices", () => {
  it("locks the group and relabels the answering turn", () => {
    const messages = projectWebuiThreadMessages([cardMessage(), userMessage("plan-b")]);
    const [card, answer] = messages;
    expect(card.cardOptionsResolvedAt).toBe(1700000002000);
    expect(card.cardOptionsSelectedIds).toEqual(["plan-b"]);
    expect(answer.content).toBe("Pro");
  });

  it("stays idempotent across repeated projections", () => {
    const first = projectWebuiThreadMessages([cardMessage(), userMessage("plan-b")]);
    const second = projectWebuiThreadMessages(first);
    expect(second).toEqual(first);
    const third = projectWebuiThreadMessages(second);
    expect(third).toEqual(first);
  });

  it("leaves a group open while the conversation has not moved on", () => {
    const [card] = projectWebuiThreadMessages([cardMessage()]);
    expect(card.cardOptionsResolvedAt).toBeUndefined();
  });

  it("leaves a hand-typed answer untouched", () => {
    const messages = projectWebuiThreadMessages([cardMessage(), userMessage("something else")]);
    expect(messages[0].cardOptionsResolvedAt).toBeDefined();
    expect(messages[1].content).toBe("something else");
    expect(messages[1].cardOptionsSelectedIds).toBeUndefined();
  });

  it("does not count hidden system turns as an answer", () => {
    const messages = projectWebuiThreadMessages([
      cardMessage(),
      { ...userMessage("/model gpt-5", "hidden", 1700000003000), turnId: "turn-hidden" },
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0].cardOptionsResolvedAt).toBeUndefined();
  });

  it("hoists a ```cards fence into cardOptions before resolving it", () => {
    const assistant: UIMessage = {
      id: "assistant-fence",
      role: "assistant",
      content: [
        "Which region?",
        "",
        "```cards",
        '{"question":"Which region?","options":[{"title":"EU","value":"eu"},{"title":"US","value":"us"}]}',
        "```",
      ].join("\n"),
      createdAt: 1700000001000,
    };

    const messages = projectWebuiThreadMessages([assistant, userMessage("us")]);
    expect(messages[0].content).toBe("Which region?");
    expect(messages[0].cardOptions?.options.map((option) => option.title)).toEqual(["EU", "US"]);
    expect(messages[0].cardOptionsResolvedAt).toBe(1700000002000);
    expect(messages[1].content).toBe("US");
  });
});
