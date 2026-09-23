import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CardOptions } from "@/components/cards/CardOptions";
import { registerCardRenderer } from "@/components/cards/card-registry";
import { MessageBubble } from "@/components/MessageBubble";
import type { CardOptionsData } from "@/lib/card-options";
import type { UIMessage } from "@/lib/types";

const SINGLE: CardOptionsData = {
  type: "card_options",
  question: "Which runtime should run the job?",
  options: [
    { id: "python", title: "Python", description: "CPython 3.12", icon: "terminal", value: "python" },
    { id: "node", title: "Node", description: "Node 22", icon: "rocket", value: "node" },
  ],
};

const MULTI: CardOptionsData = {
  type: "card_options",
  question: "Which services should restart?",
  multiSelect: true,
  options: [
    { id: "api", title: "API", value: "api" },
    { id: "worker", title: "Worker", value: "worker" },
    { id: "cron", title: "Cron", value: "cron" },
  ],
};

function cardOf(id: string): HTMLElement {
  const tile = document.querySelector(`[data-card-option="${id}"]`);
  if (!tile) throw new Error(`card ${id} not found`);
  return tile as HTMLElement;
}

describe("CardOptions", () => {
  it("renders the grid, icons, titles and descriptions", () => {
    const { container } = render(<CardOptions data={SINGLE} />);

    expect(container.querySelector("[data-card-option-grid]")).toHaveClass(
      "grid-cols-1",
      "sm:grid-cols-2",
    );
    expect(screen.getByText("Python")).toBeInTheDocument();
    expect(screen.getByText("CPython 3.12")).toBeInTheDocument();
    expect(screen.getByText("Node")).toBeInTheDocument();
    // Icon names map onto lucide glyphs, rendered inside the badge slot.
    expect(cardOf("python").querySelector("svg")).toBeInTheDocument();
    expect(cardOf("node").querySelector("svg")).toBeInTheDocument();
  });

  it("renders emoji icons as text when the name is not a known icon", () => {
    render(
      <CardOptions
        data={{
          type: "card_options",
          question: "Pick a tier",
          options: [{ id: "gold", title: "Gold", value: "gold", icon: "👑" }],
        }}
      />,
    );

    expect(screen.getByText("👑")).toBeInTheDocument();
  });

  it("sends the option value on a single-select click and locks afterwards", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<CardOptions data={SINGLE} onSelect={onSelect} />);

    await user.click(cardOf("python"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("python");

    // A second click before the projection locks the group must not double-send.
    fireEvent.click(cardOf("node"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("collects multi-select choices behind a confirm button", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<CardOptions data={MULTI} onSelect={onSelect} />);

    await user.click(cardOf("api"));
    await user.click(cardOf("cron"));
    expect(onSelect).not.toHaveBeenCalled();
    expect(cardOf("api")).toHaveAttribute("data-card-selected", "true");
    expect(cardOf("cron")).toHaveAttribute("data-card-selected", "true");

    const confirm = screen.getByRole("button", { name: "Confirm (2)" });
    await user.click(confirm);
    expect(onSelect).toHaveBeenCalledWith("api\ncron");
  });

  it("offers a free-text fallback when allowCustomInput is set", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <CardOptions
        data={{ ...SINGLE, allowCustomInput: true }}
        onSelect={onSelect}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Other…/ }));
    const input = screen.getByLabelText("Type your answer…");
    await user.type(input, "let me think");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onSelect).toHaveBeenCalledWith("let me think");
    expect(screen.queryByLabelText("Type your answer…")).not.toBeInTheDocument();
  });

  it("submits a custom answer with Enter but keeps Shift+Enter for newlines", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<CardOptions data={{ ...SINGLE, allowCustomInput: true }} onSelect={onSelect} />);

    await user.click(screen.getByRole("button", { name: /Other…/ }));
    const input = screen.getByLabelText("Type your answer…");
    await user.type(input, "second line{Shift>}{Enter}{/Shift}with newline");
    expect(onSelect).not.toHaveBeenCalled();

    await user.type(input, "{Enter}");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("second line\nwith newline");
  });

  it("locks into an answered state that restores the previous selection", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <CardOptions
        data={MULTI}
        answered
        selectedIds={["worker"]}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Answered");
    expect(screen.getByText("API")).toBeInTheDocument();
    expect(cardOf("worker")).toHaveAttribute("data-card-selected", "true");
    expect(cardOf("api")).toBeDisabled();
    expect(cardOf("worker")).toBeDisabled();
    // No confirm or custom input after the group is settled.
    expect(screen.queryByRole("button", { name: /Confirm/ })).not.toBeInTheDocument();
    expect(container.querySelector("[data-card-custom-input]")).not.toBeInTheDocument();

    fireEvent.click(cardOf("cron"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("renders the question only when asked to", () => {
    const { rerender } = render(<CardOptions data={SINGLE} showQuestion />);
    expect(screen.getByText(SINGLE.question)).toBeInTheDocument();

    rerender(<CardOptions data={SINGLE} />);
    expect(screen.queryByText(SINGLE.question)).not.toBeInTheDocument();
  });
});

describe("CardOptions pluggable renderers", () => {
  it("renders registered card bodies and falls back to the default for unknown kinds", () => {
    registerCardRenderer("stars", ({ option }) => (
      <span data-testid="stars-body">{String(option.meta?.stars ?? 0)} stars</span>
    ));
    const data: CardOptionsData = {
      type: "card_options",
      question: "Rate the result",
      options: [
        { id: "five", title: "Great", value: "great", kind: "stars", meta: { stars: 5 } },
        { id: "mystery", title: "Surprise", value: "surprise", kind: "quantum" },
      ],
    };

    render(<CardOptions data={data} />);
    expect(screen.getByTestId("stars-body")).toHaveTextContent("5 stars");
    expect(screen.getByText("Surprise")).toBeInTheDocument();
  });

  it("renders image and progress bodies from option fields", () => {
    render(
      <CardOptions
        data={{
          type: "card_options",
          question: "Pick a build",
          options: [
            { id: "nightly", title: "Nightly", value: "nightly", kind: "image", imageUrl: "https://img/night.png" },
            { id: "stable", title: "Stable", value: "stable", kind: "progress", progress: 42 },
          ],
        }}
      />,
    );

    expect(document.querySelector('img[src="https://img/night.png"]')).toBeInTheDocument();
    expect(screen.getByLabelText("42%")).toBeInTheDocument();
  });
});

describe("MessageBubble card integration", () => {
  const message: UIMessage = {
    id: "assistant-cards",
    role: "assistant",
    content: "Pick a plan.",
    createdAt: 1700000001000,
    cardOptions: SINGLE,
  };

  it("renders the group under the assistant text and forwards the choice", async () => {
    const onCardOptionSelect = vi.fn();
    const user = userEvent.setup();
    render(<MessageBubble message={message} onCardOptionSelect={onCardOptionSelect} />);

    expect(screen.getByText("Pick a plan.")).toBeInTheDocument();
    expect(screen.getByText("Python")).toBeInTheDocument();

    await user.click(cardOf("python"));
    expect(onCardOptionSelect).toHaveBeenCalledWith("python");
  });

  it("keeps the group interactive while the turn is streaming", () => {
    const onCardOptionSelect = vi.fn();
    render(
      <MessageBubble
        message={{ ...message, isStreaming: true }}
        isTurnStreaming
        onCardOptionSelect={onCardOptionSelect}
      />,
    );

    fireEvent.click(cardOf("node"));
    expect(onCardOptionSelect).toHaveBeenCalledWith("node");
  });

  it("disables the group once the projection marked it answered", () => {
    const onCardOptionSelect = vi.fn();
    render(
      <MessageBubble
        message={{
          ...message,
          cardOptionsResolvedAt: 1700000002000,
          cardOptionsSelectedIds: ["node"],
        }}
        onCardOptionSelect={onCardOptionSelect}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Answered");
    expect(cardOf("python")).toBeDisabled();
    expect(cardOf("node")).toBeDisabled();
    fireEvent.click(cardOf("python"));
    expect(onCardOptionSelect).not.toHaveBeenCalled();
  });
});
