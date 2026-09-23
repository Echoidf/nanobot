import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FilePreviewPanel } from "@/components/FilePreviewPanel";
import { setAppLanguage } from "@/i18n";
import { fetchFilePreview } from "@/lib/api";

vi.mock("@/components/CodeBlock", () => ({
  CodeBlock: ({
    code,
    language,
    highlight,
    wrapLongLines,
  }: {
    code: string;
    language?: string;
    highlight?: boolean;
    wrapLongLines?: boolean;
  }) => (
    <pre
      data-testid="mock-code-block"
      data-language={language}
      data-highlight={String(highlight)}
      data-wrap={String(wrapLongLines)}
    >
      {code}
    </pre>
  ),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    fetchFilePreview: vi.fn(),
  };
});

describe("FilePreviewPanel", () => {
  beforeEach(async () => {
    await setAppLanguage("en");
    vi.mocked(fetchFilePreview).mockReset();
  });

  it("shows a compact breadcrumb with one file name and a visible close action", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    vi.mocked(fetchFilePreview).mockResolvedValue({
      path: "/Users/hr/workspace/quicksort.py",
      display_path: "quicksort.py",
      project_path: "/Users/hr/workspace",
      language: "python",
      content: "print('ok')",
      size: 11,
      truncated: false,
    });

    render(
      <FilePreviewPanel
        sessionKey="websocket:chat-1"
        path="quicksort.py"
        token="tok"
        onClose={onClose}
      />,
    );

    const codeBlock = await screen.findByTestId("mock-code-block");
    expect(codeBlock).toHaveTextContent("print('ok')");
    expect(codeBlock).toHaveAttribute("data-language", "python");
    expect(codeBlock).toHaveAttribute("data-highlight", "true");
    expect(screen.getByTestId("file-preview-breadcrumb")).toHaveTextContent("...");
    expect(screen.getByTestId("file-preview-breadcrumb")).toHaveTextContent("workspace");
    expect(screen.getByTestId("file-preview-title")).toHaveTextContent("quicksort.py");
    expect(screen.getAllByText("quicksort.py")).toHaveLength(1);

    const closeButton = screen.getByRole("button", { name: "Close file preview" });
    expect(closeButton).toBeVisible();

    await user.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("updates translated chrome without refetching the open file", async () => {
    vi.mocked(fetchFilePreview).mockResolvedValue({
      path: "/workspace/notes.md",
      display_path: "notes.md",
      project_path: "/workspace",
      language: "markdown",
      content: "# Notes",
      size: 7,
      truncated: false,
    });

    render(
      <FilePreviewPanel
        sessionKey="websocket:chat-1"
        path="notes.md"
        token="tok"
        onClose={() => {}}
      />,
    );

    await screen.findByTestId("file-preview-markdown");
    expect(fetchFilePreview).toHaveBeenCalledTimes(1);

    await act(async () => {
      await setAppLanguage("zh-CN");
    });

    expect(fetchFilePreview).toHaveBeenCalledTimes(1);
  });

  it("renders markdown as rich preview by default with a source toggle", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchFilePreview).mockResolvedValue({
      path: "/workspace/notes.md",
      display_path: "notes.md",
      project_path: "/workspace",
      language: "markdown",
      content: "# Notes\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n",
      size: 42,
      truncated: false,
    });

    render(
      <FilePreviewPanel
        sessionKey="websocket:chat-1"
        path="notes.md"
        token="tok"
        onClose={() => {}}
      />,
    );

    const preview = await screen.findByTestId("file-preview-markdown");
    expect(preview).toHaveTextContent("Notes");
    expect(screen.queryByTestId("mock-code-block")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("file-preview-view-source"));
    const sourceBlock = await screen.findByTestId("mock-code-block");
    expect(sourceBlock).toHaveTextContent("| a | b |");
    // Source rows must stay intact on one line (horizontal scroll instead
    // of wrapping table cells across visual lines).
    expect(sourceBlock).toHaveAttribute("data-wrap", "false");

    await user.click(screen.getByTestId("file-preview-view-preview"));
    expect(await screen.findByTestId("file-preview-markdown")).toBeInTheDocument();
  });

  it("keeps code files on the highlighted source view without a markdown toggle", async () => {
    vi.mocked(fetchFilePreview).mockResolvedValue({
      path: "/workspace/quicksort.py",
      display_path: "quicksort.py",
      project_path: "/workspace",
      language: "python",
      content: "print('ok')",
      size: 11,
      truncated: false,
    });

    render(
      <FilePreviewPanel
        sessionKey="websocket:chat-1"
        path="quicksort.py"
        token="tok"
        onClose={() => {}}
      />,
    );

    await screen.findByTestId("mock-code-block");
    expect(screen.queryByTestId("file-preview-markdown")).not.toBeInTheDocument();
    expect(screen.queryByTestId("file-preview-view-source")).not.toBeInTheDocument();
  });
});
