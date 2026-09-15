/**
 * Path shaping for the composer "@" mention palette.
 *
 * Workspace paths differ only in the middle (`management/auth/.../management`
 * vs `management/bill/.../management`), so neither the leaf name nor a
 * tail-only truncation can tell two rows apart. This module picks a
 * discriminating title per row and compresses the rest with a *middle*
 * ellipsis so both the branch and the destination stay visible.
 */

/** Segments kept at the head when a relative path is compressed. */
const DETAIL_HEAD_SEGMENTS = 2;
/** Segments kept at the tail when a relative path is compressed. */
const DETAIL_TAIL_SEGMENTS = 2;
/** Extra guard so a single pathological segment cannot stretch a row. */
const DETAIL_MAX_CHARS = 64;
/** Breadcrumb shows the project root plus the nearest context. */
const BREADCRUMB_HEAD_SEGMENTS = 1;
const BREADCRUMB_TAIL_SEGMENTS = 2;

export interface MentionPathView {
  /** Emphasised title: the deepest segment that distinguishes this row. */
  title: string;
  /** Compressed relative path; "" when it would only repeat the title. */
  detail: string;
}

export interface MentionPathInput {
  path: string;
  kind: "file" | "folder";
}

export interface MentionPathPlan {
  /** Directory shared by every candidate; "" when they diverge at the root. */
  breadcrumb: string;
  /** Breadcrumb as displayed in the group header (trailing slash, compressed). */
  breadcrumbLabel: string;
  /** Per-path display data. */
  views: Map<string, MentionPathView>;
}

/** Normalize separators and drop trailing slashes. */
function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

/** Path segments of a normalized workspace path. */
function segmentsOf(path: string): string[] {
  return normalize(path).split("/").filter(Boolean);
}

/** Directory that contains a workspace-relative path; "" for root entries. */
export function parentDir(path: string): string {
  const segments = segmentsOf(path);
  return segments.slice(0, -1).join("/");
}

/** Final path segment, without any trailing slash. */
export function baseName(path: string): string {
  const segments = segmentsOf(path);
  return segments[segments.length - 1] ?? "";
}

/**
 * Deepest directory shared by every path, compared segment by segment.
 * Returns "" when entries sit in different directories.
 */
export function commonParentDir(paths: string[]): string {
  const parents = paths.map(parentDir);
  if (parents.length === 0) return "";
  const [head = "", ...rest] = parents;
  let shared = head.split("/").filter(Boolean);
  for (const parent of rest) {
    const segments = parent.split("/").filter(Boolean);
    let index = 0;
    while (index < shared.length && segments[index] === shared[index]) index += 1;
    shared = shared.slice(0, index);
    if (shared.length === 0) return "";
  }
  return shared.join("/");
}

/** Number of trailing segments two paths share. */
function commonSuffixLength(a: string[], b: string[]): number {
  let count = 0;
  while (
    count < a.length
    && count < b.length
    && a[a.length - 1 - count] === b[b.length - 1 - count]
  ) {
    count += 1;
  }
  return count;
}

/**
 * Index of the segment that should title this row.
 *
 * The leaf name is preferred, but when several candidates end with the same
 * segments (module folders mirrored deep inside their own path), the title
 * walks outward until it reaches a segment that actually differs — which is
 * what makes `auth` / `bill` / `common` scannable.
 */
export function discriminatingIndex(segments: string[], siblings: string[][]): number {
  let sharedTail = 0;
  for (const other of siblings) {
    if (other === segments) continue;
    sharedTail = Math.max(sharedTail, commonSuffixLength(segments, other));
  }
  // Keep at least the outermost segment available, so duplicated paths still render.
  return Math.max(0, segments.length - 1 - Math.min(sharedTail, segments.length - 1));
}

/** Drop a leading `prefix/` from `path`; returns `path` unchanged when unrelated. */
export function stripPathPrefix(path: string, prefix: string): string {
  const normalized = normalize(path);
  if (!prefix) return normalized;
  if (normalized === prefix) return "";
  return normalized.startsWith(`${prefix}/`)
    ? normalized.slice(prefix.length + 1)
    : normalized;
}

/**
 * Middle-truncate a path, keeping both ends:
 * `auth/src/main/kotlin/com/louzhihui/management`
 *   -> `auth/src/…/louzhihui/management`
 *
 * Head preservation matters: the relative path starts exactly where the
 * candidates diverge, so the branch segment is never the thing we drop.
 */
export function truncatePathMiddle(
  path: string,
  options: { headSegments: number; tailSegments: number; maxChars?: number },
): string {
  const { headSegments, tailSegments, maxChars } = options;
  const normalized = normalize(path);
  if (!normalized) return "";
  const segments = normalized.split("/").filter(Boolean);
  const budget = headSegments + tailSegments;
  let result = segments.length <= budget
    ? normalized
    : [
      ...segments.slice(0, headSegments),
      "…",
      ...segments.slice(segments.length - tailSegments),
    ].join("/");
  if (maxChars && result.length > maxChars) {
    const keep = Math.max(8, Math.floor((maxChars - 1) / 2));
    result = `${result.slice(0, keep)}…${result.slice(-keep)}`;
  }
  return result;
}

/** Compress a directory trail for the group breadcrumb. */
export function breadcrumbLabel(breadcrumb: string): string {
  if (!breadcrumb) return "";
  return `${truncatePathMiddle(breadcrumb, {
    headSegments: BREADCRUMB_HEAD_SEGMENTS,
    tailSegments: BREADCRUMB_TAIL_SEGMENTS,
  })}/`;
}

/**
 * Plan every file row at once: shared breadcrumb plus per-row title/trail.
 *
 * Titles need the whole sibling set (that is what makes them discriminating),
 * so they are computed here instead of per row.
 */
export function planMentionPaths(items: readonly MentionPathInput[]): MentionPathPlan {
  const paths = items.map((item) => normalize(item.path));
  const breadcrumb = paths.length > 1 ? commonParentDir(paths) : "";
  const segmentSets = paths.map(segmentsOf);
  const views = new Map<string, MentionPathView>();

  items.forEach((item, index) => {
    const segments = segmentSets[index] ?? [];
    const path = paths[index] ?? "";
    const titleText = segments[discriminatingIndex(segments, segmentSets)] ?? baseName(path);
    const relative = stripPathPrefix(path, breadcrumb);
    // A folder's trail is its own relative path, so the branch segment stays
    // visible at the head and the destination at the tail
    // (`auth/src/…/louzhihui/management`). A file's trail is its containing
    // directory, since the filename is already the title.
    const trail = item.kind === "folder" ? relative : parentDir(relative);
    // Only a trail that repeats the title is dropped; a short one such as
    // `dto` still carries real information and should stay visible.
    const detail = trail && trail !== titleText
      ? truncatePathMiddle(trail, {
        headSegments: DETAIL_HEAD_SEGMENTS,
        tailSegments: DETAIL_TAIL_SEGMENTS,
        maxChars: DETAIL_MAX_CHARS,
      })
      : "";
    views.set(item.path, {
      title: item.kind === "folder" ? `${titleText}/` : titleText,
      detail,
    });
  });

  return { breadcrumb, breadcrumbLabel: breadcrumbLabel(breadcrumb), views };
}

export interface MentionTextSegment {
  text: string;
  matched: boolean;
}

/**
 * Split `text` at the first case-insensitive occurrence of `needle`.
 * Only the first hit is marked so the highlight stays a locator.
 */
export function matchMentionSpans(text: string, needle: string): MentionTextSegment[] {
  if (!text) return [];
  const query = needle.trim();
  if (!query) return [{ text, matched: false }];
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) return [{ text, matched: false }];
  return [
    { text: text.slice(0, index), matched: false },
    { text: text.slice(index, index + query.length), matched: true },
    { text: text.slice(index + query.length), matched: false },
  ].filter((segment) => segment.text.length > 0);
}

/**
 * Segment the user is still typing: `@src/main/kotl` -> `kotl`.
 * Earlier segments already narrowed the directory, and a bare `@management`
 * must keep matching inside the trails rather than only leaf names.
 */
export function mentionLeafNeedle(rawQuery: string): string {
  const normalized = rawQuery.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  return slash < 0 ? normalized : normalized.slice(slash + 1);
}
