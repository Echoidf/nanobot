import { describe, expect, it } from "vitest";

import {
  baseName,
  breadcrumbLabel,
  commonParentDir,
  discriminatingIndex,
  matchMentionSpans,
  mentionLeafNeedle,
  parentDir,
  planMentionPaths,
  stripPathPrefix,
  truncatePathMiddle,
} from "@/lib/mention-path";

/** The reported failure case: three module folders whose prefix and suffix match. */
const MIRROR_PATHS = [
  "management/auth/src/main/kotlin/com/louzhihui/management",
  "management/bill/src/main/kotlin/com/louzhihui/management",
  "management/common/src/main/kotlin/com/louzhihui/management",
];

function planMirror() {
  return planMentionPaths(MIRROR_PATHS.map((path) => ({ path, kind: "folder" as const })));
}

describe("mention-path segment helpers", () => {
  it("splits a nested path into parent directory and leaf name", () => {
    expect(parentDir("src/main/kotlin/com/example/management/Auth.kt")).toBe(
      "src/main/kotlin/com/example/management",
    );
    expect(baseName("src/main/kotlin/com/example/management/Auth.kt")).toBe("Auth.kt");
  });

  it("treats root-level and trailing-slash entries correctly", () => {
    expect(parentDir("README.md")).toBe("");
    expect(baseName("README.md")).toBe("README.md");
    expect(parentDir("docs/")).toBe("");
    expect(baseName("src/components/")).toBe("components");
  });

  it("normalizes backslashes from Windows-style input", () => {
    expect(parentDir("src\\main\\Auth.kt")).toBe("src/main");
    expect(baseName("src\\main\\Auth.kt")).toBe("Auth.kt");
    expect(planMentionPaths([
      { path: "src\\main\\Auth.kt", kind: "file" },
    ]).views.get("src\\main\\Auth.kt")?.title).toBe("Auth.kt");
  });

  it("finds the deepest shared directory, backtracking when children diverge", () => {
    expect(commonParentDir(MIRROR_PATHS)).toBe("management");
    expect(commonParentDir([
      "src/main/kotlin/com/example/management/Auth.kt",
      "src/main/kotlin/com/example/order/Order.kt",
    ])).toBe("src/main/kotlin/com/example");
  });

  it("returns empty when entries share no directory", () => {
    expect(commonParentDir(["src/App.tsx", "docs/guide.md"])).toBe("");
    expect(commonParentDir(["README.md", "AGENTS.md"])).toBe("");
    expect(commonParentDir([])).toBe("");
  });

  it("strips only a real path prefix", () => {
    expect(stripPathPrefix("src/main/App.kt", "src/main")).toBe("App.kt");
    expect(stripPathPrefix("src/mainother/App.kt", "src/main")).toBe("src/mainother/App.kt");
    expect(stripPathPrefix("src/main", "src/main")).toBe("");
    expect(stripPathPrefix("src/main", "")).toBe("src/main");
  });
});

describe("truncatePathMiddle", () => {
  it("keeps both ends so the branch and the destination survive", () => {
    expect(truncatePathMiddle("auth/src/main/kotlin/com/louzhihui/management", {
      headSegments: 2,
      tailSegments: 2,
    })).toBe("auth/src/…/louzhihui/management");
  });

  it("leaves short paths untouched", () => {
    expect(truncatePathMiddle("src/components", { headSegments: 2, tailSegments: 2 })).toBe(
      "src/components",
    );
    expect(truncatePathMiddle("src", { headSegments: 2, tailSegments: 2 })).toBe("src");
    expect(truncatePathMiddle("", { headSegments: 2, tailSegments: 2 })).toBe("");
  });

  it("caps extreme segment lengths without eating the middle marker", () => {
    const result = truncatePathMiddle("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/bbbbbbbbbbbbbbbbbbbbbbbbbb", {
      headSegments: 1,
      tailSegments: 1,
      maxChars: 24,
    });
    expect(result).toContain("…");
    expect(result.length).toBeLessThanOrEqual(2 * Math.floor((24 - 1) / 2) + 1);
  });
});

describe("discriminatingIndex", () => {
  const segmentsOf = (path: string) => path.split("/");

  it("uses the leaf name when it already differs", () => {
    const sets = ["a/Auth.kt", "b/Bill.kt"].map(segmentsOf);
    expect(sets.map((segments) => segments[discriminatingIndex(segments, sets)]))
      .toEqual(["Auth.kt", "Bill.kt"]);
  });

  it("walks outward past a mirrored suffix to the differing segment", () => {
    const sets = MIRROR_PATHS.map(segmentsOf);
    expect(sets.map((segments) => segments[discriminatingIndex(segments, sets)]))
      .toEqual(["auth", "bill", "common"]);
  });

  it("still titles a row when every segment is identical", () => {
    const sets = ["management", "management"].map(segmentsOf);
    expect(sets.map((segments) => segments[discriminatingIndex(segments, sets)]))
      .toEqual(["management", "management"]);
  });
});

describe("planMentionPaths", () => {
  it("hoists the shared prefix into a single breadcrumb", () => {
    const plan = planMirror();
    expect(plan.breadcrumb).toBe("management");
    expect(plan.breadcrumbLabel).toBe("management/");
  });

  it("gives every mirrored row a distinct bold title", () => {
    const plan = planMirror();
    const titles = MIRROR_PATHS.map((path) => plan.views.get(path)?.title);
    expect(titles).toEqual(["auth/", "bill/", "common/"]);
    expect(new Set(titles).size).toBe(3);
  });

  it("shows the branch at the head and the destination at the tail", () => {
    const plan = planMirror();
    const details = MIRROR_PATHS.map((path) => plan.views.get(path)?.detail);
    expect(details).toEqual([
      "auth/src/…/louzhihui/management",
      "bill/src/…/louzhihui/management",
      "common/src/…/louzhihui/management",
    ]);
    // The title must never be the only cue: trails differ too.
    expect(new Set(details).size).toBe(3);
  });

  it("titles files by name and trails them with their directory", () => {
    const plan = planMentionPaths([
      { path: "src/main/kotlin/com/example/management/AuthController.kt", kind: "file" },
      { path: "src/main/kotlin/com/example/management/dto/AuthRequest.kt", kind: "file" },
    ]);
    expect(plan.breadcrumbLabel).toBe("src/…/example/management/");
    expect(plan.views.get("src/main/kotlin/com/example/management/AuthController.kt")).toEqual({
      title: "AuthController.kt",
      // The file name is the title, so the trail stops before it.
      detail: "",
    });
    expect(plan.views.get("src/main/kotlin/com/example/management/dto/AuthRequest.kt")?.title).toBe(
      "AuthRequest.kt",
    );
  });

  it("omits the breadcrumb and trail for divergent or root-level entries", () => {
    const plan = planMentionPaths([
      { path: "README.md", kind: "file" },
      { path: "docs", kind: "folder" },
      { path: "src", kind: "folder" },
    ]);
    expect(plan.breadcrumbLabel).toBe("");
    expect(plan.views.get("README.md")).toEqual({ title: "README.md", detail: "" });
    expect(plan.views.get("docs")).toEqual({ title: "docs/", detail: "" });
  });

  it("labels the breadcrumb as a directory and compresses a deep one", () => {
    expect(breadcrumbLabel("src/main/kotlin/com/example/management")).toBe(
      "src/…/example/management/",
    );
    expect(breadcrumbLabel("")).toBe("");
  });
});

describe("matchMentionSpans", () => {
  it("marks the first case-insensitive occurrence", () => {
    expect(matchMentionSpans("management", "age")).toEqual([
      { text: "man", matched: false },
      { text: "age", matched: true },
      { text: "ment", matched: false },
    ]);
    expect(matchMentionSpans("management", "MAN")).toEqual([
      { text: "man", matched: true },
      { text: "agement", matched: false },
    ]);
  });

  it("returns the whole text unmarked when nothing matches or the needle is blank", () => {
    expect(matchMentionSpans("docs", "zzz")).toEqual([{ text: "docs", matched: false }]);
    expect(matchMentionSpans("docs", "   ")).toEqual([{ text: "docs", matched: false }]);
    expect(matchMentionSpans("", "abc")).toEqual([]);
  });

  it("does not highlight the same query twice in one label", () => {
    const spans = matchMentionSpans("manage-management", "man");
    expect(spans.filter((span) => span.matched)).toHaveLength(1);
    expect(spans.map((span) => span.text).join("")).toBe("manage-management");
  });
});

describe("mentionLeafNeedle", () => {
  it("uses only the segment still being typed", () => {
    expect(mentionLeafNeedle("mar")).toBe("mar");
    expect(mentionLeafNeedle("src/main/kotl")).toBe("kotl");
    expect(mentionLeafNeedle("src/main/")).toBe("");
    expect(mentionLeafNeedle("src\\main\\kotl")).toBe("kotl");
    expect(mentionLeafNeedle("")).toBe("");
  });
});
