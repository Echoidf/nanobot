import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CodeBlock } from "@/components/CodeBlock";
import { ThemeProvider } from "@/hooks/useTheme";

// NOTE: no mocks for react-syntax-highlighter here on purpose — this test
// exercises the real Prism pipeline so the token-class sanitizer runs.
describe("CodeBlock markdown tables", () => {
  it("strips Prism's bare table class so Tailwind cannot table-ify tokens", async () => {
    // Simulate Tailwind's global `.table` utility: if any highlighted token
    // still carried the bare `table` class it would become `display: table`
    // and split a single source line across many visual lines.
    const style = document.createElement("style");
    style.textContent = ".table{display:table}";
    document.head.appendChild(style);

    try {
      render(
        <ThemeProvider theme="light">
          <CodeBlock
            language="markdown"
            code={"| a | b |\n| --- | --- |\n| 1 | 2 |\n"}
            chrome="none"
            highlight
            showLineNumbers
            wrapLongLines={false}
          />
        </ThemeProvider>,
      );

      // Wait until Prism actually highlighted the markdown table.
      await waitFor(() => {
        expect(document.querySelectorAll(".token").length).toBeGreaterThan(0);
      });

      // No token may keep the colliding class; colors come from inline styles,
      // so without the `table` class Tailwind's global utility cannot match
      // and every source line keeps rendering on exactly one visual line.
      expect(document.querySelectorAll(".token.table").length).toBe(0);
    } finally {
      style.remove();
    }
  });
});
