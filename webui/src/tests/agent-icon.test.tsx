import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AgentIcon, isImageAgentIcon } from "@/lib/agent-icon";

describe("isImageAgentIcon", () => {
  it("treats brand asset paths, URLs and data URIs as images", () => {
    expect(isImageAgentIcon("/brand/nanodesk_favicon.svg")).toBe(true);
    expect(isImageAgentIcon("./assets/mark.png")).toBe(true);
    expect(isImageAgentIcon("https://cdn.example/icon.webp")).toBe(true);
    expect(isImageAgentIcon("data:image/svg+xml;base64,AAAA")).toBe(true);
    expect(isImageAgentIcon("assets/mark.svg?v=2")).toBe(true);
  });

  it("keeps emoji, text and empty icons as glyphs", () => {
    expect(isImageAgentIcon("🤖")).toBe(false);
    expect(isImageAgentIcon("✦")).toBe(false);
    expect(isImageAgentIcon("")).toBe(false);
    expect(isImageAgentIcon("   ")).toBe(false);
    expect(isImageAgentIcon(null)).toBe(false);
    expect(isImageAgentIcon(undefined)).toBe(false);
  });
});

describe("AgentIcon", () => {
  it("renders an image icon with the sizing class", () => {
    const { container } = render(
      <AgentIcon
        icon="/brand/nanodesk_favicon.svg"
        imageClassName="h-6 w-6 rounded-md"
        fallbackClassName="h-4 w-4"
      />,
    );

    const image = container.querySelector("img");
    expect(image?.getAttribute("src")).toBe("/brand/nanodesk_favicon.svg");
    expect(image?.getAttribute("alt")).toBe("");
    expect(image?.className).toContain("h-6");
    expect(image?.className).toContain("rounded-md");
    // The fallback glyph must not be rendered alongside the brand mark.
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders emoji and text icons unchanged", () => {
    const { container } = render(
      <AgentIcon icon="🤖" imageClassName="h-6 w-6" fallbackClassName="h-4 w-4" />,
    );

    expect(container.textContent).toBe("🤖");
    expect(container.querySelector("img")).toBeNull();
  });

  it("falls back to the bot glyph when no icon is configured", () => {
    const { container } = render(
      <AgentIcon icon={null} imageClassName="h-6 w-6" fallbackClassName="h-4 w-4" />,
    );

    const glyph = container.querySelector("svg");
    expect(glyph).not.toBeNull();
    expect(glyph?.getAttribute("class")).toContain("h-4");
  });
});
