"""Workspace-scoped file and folder listing for the WebUI file-ref picker."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence, cast

from nanobot.security.workspace_access import WorkspaceScope
from nanobot.security.workspace_policy import WorkspaceBoundaryError, resolve_allowed_path

MAX_PATH_REFS = 20
_MAX_LIST_DEPTH = 8
_MAX_LIST_ENTRIES = 200
_MAX_WALK_NODES = 5_000
_IGNORED_DIR_NAMES = {
    ".git",
    ".hg",
    ".svn",
    "__pycache__",
    "node_modules",
    ".venv",
    "venv",
    "dist",
    "build",
    ".tox",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".coverage",
    "htmlcov",
}

# Tool/metadata directories that are still legitimately referenceable, but
# should never crowd out real project files in the composer "@" picker.
_NOISE_PREFIXES = (".", "__")


def _noise_rank(rel_path: str, name: str) -> int:
    """Return 1 for dot/dunder entries so they sort last.

    An entry is noise when its own name, or any parent directory in the
    relative path, starts with ``.`` or ``__`` — so ``.claude/settings.json``
    is demoted the same way as the ``.claude`` folder itself. These entries stay
    listed (a query can still surface them on purpose); they only lose their
    position to ordinary project entries.
    """
    segments = (*rel_path.split("/")[:-1], name)
    return 1 if any(segment.startswith(_NOISE_PREFIXES) for segment in segments) else 0


class WorkspaceFileListingError(ValueError):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


@dataclass(frozen=True)
class WorkspaceFileEntry:
    name: str
    path: str
    kind: str
    binary: bool = False
    size: int | None = None
    language: str | None = None

    def as_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"name": self.name, "path": self.path, "kind": self.kind}
        if self.binary:
            payload["binary"] = True
        if self.size is not None:
            payload["size"] = self.size
        if self.language:
            payload["language"] = self.language
        return payload


def normalize_path_refs(raw: object) -> list[dict[str, str]]:
    """Validate and de-duplicate client supplied workspace references."""
    if not isinstance(raw, Sequence) or isinstance(raw, (str, bytes, bytearray)):
        return []
    output: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for item in cast(Sequence[object], raw)[:MAX_PATH_REFS]:
        if not isinstance(item, Mapping):
            continue
        path = item.get("path")
        kind = item.get("kind")
        if not isinstance(path, str) or not isinstance(kind, str):
            continue
        path = path.strip().replace("\\", "/")
        kind = kind.strip().lower()
        if not path or len(path) > 4096 or kind not in {"file", "folder"}:
            continue
        key = (path, kind)
        if key in seen:
            continue
        seen.add(key)
        output.append({"path": path, "kind": kind})
    return output


def workspace_files_payload(
    raw_dir: str | None,
    *,
    query: str | None,
    scope: WorkspaceScope,
    max_entries: int = _MAX_LIST_ENTRIES,
) -> dict[str, Any]:
    """List or fuzzy-search workspace files/folders for the composer picker."""
    directory = _resolve_listing_dir(raw_dir, scope=scope)
    items = _iter_workspace_entries(
        directory,
        scope=scope,
        query=query,
        max_entries=max_entries,
    )
    return {
        "dir": _display_path(directory, scope.project_path),
        "project_path": str(scope.project_path),
        "items": [item.as_payload() for item in items],
    }


def _resolve_listing_dir(raw_dir: str | None, *, scope: WorkspaceScope) -> Path:
    raw = "." if raw_dir is None or not raw_dir.strip() else raw_dir.strip()
    try:
        resolved = resolve_allowed_path(
            raw,
            workspace=scope.project_path,
            allowed_root=scope.project_path if scope.restrict_to_workspace else None,
            strict=True,
        )
    except FileNotFoundError as e:
        raise WorkspaceFileListingError(404, "directory not found") from e
    except WorkspaceBoundaryError as e:
        raise WorkspaceFileListingError(403, "path is outside the current workspace") from e
    except OSError as e:
        raise WorkspaceFileListingError(400, "invalid path") from e
    if not resolved.is_dir():
        raise WorkspaceFileListingError(404, "directory not found")
    if _depth_from_root(resolved, scope.project_path) > _MAX_LIST_DEPTH:
        raise WorkspaceFileListingError(400, "directory depth exceeds limit")
    return resolved


def _depth_from_root(path: Path, root: Path) -> int:
    try:
        return len(path.resolve(strict=False).relative_to(root.resolve(strict=False)).parts)
    except ValueError:
        return _MAX_LIST_DEPTH + 1


def _query_terms(query: str | None) -> list[str]:
    if not isinstance(query, str):
        return []
    normalized = query.strip().replace("\\", "/").casefold()
    if not normalized:
        return []
    return [part for part in normalized.replace("/", " ").split() if part]


def _matches_terms(haystack: str, terms: Sequence[str]) -> bool:
    if not terms:
        return True
    lowered = haystack.casefold()
    return all(term in lowered for term in terms)


def _match_rank(
    rel_path: str,
    name: str,
    kind: str,
    terms: Sequence[str],
) -> tuple[int, int, int, int, int, str]:
    """Lower rank sorts first: project entries, folders, then tighter matches.

    ``noise_rank`` leads so tool directories such as ``.nanobot`` or
    ``__pycache__`` never outrank ordinary project entries, even when the kind
    or match quality would otherwise favour them.
    """
    kind_rank = 0 if kind == "folder" else 1
    if not terms:
        return (_noise_rank(rel_path, name), kind_rank, 0, 0, 0, name.casefold())

    name_cf = name.casefold()
    stem_cf = name_cf.rsplit(".", 1)[0] if "." in name_cf else name_cf
    path_cf = rel_path.casefold()
    joined = " ".join(terms)

    if name_cf == joined or stem_cf == joined:
        quality = 0
    elif name_cf.startswith(joined) or stem_cf.startswith(joined):
        quality = 1
    elif joined in name_cf:
        quality = 2
    elif all(term in name_cf for term in terms):
        quality = 3
    elif path_cf.startswith(joined) or path_cf.endswith(joined):
        quality = 4
    else:
        quality = 5

    # Prefer tighter basename matches (Button over button-notes for "button").
    tightness = abs(len(stem_cf) - len(joined))
    depth = path_cf.count("/")
    return (_noise_rank(rel_path, name), kind_rank, quality, tightness, depth, name_cf)


def _iter_workspace_entries(
    directory: Path,
    *,
    scope: WorkspaceScope,
    query: str | None,
    max_entries: int,
) -> list[WorkspaceFileEntry]:
    terms = _query_terms(query)
    root_depth = _depth_from_root(directory, scope.project_path)
    ranked: list[tuple[tuple[int, int, int, int, str], WorkspaceFileEntry]] = []
    visited = 0

    def consider(path: Path, *, is_dir: bool) -> None:
        nonlocal visited
        visited += 1
        if visited > _MAX_WALK_NODES:
            return
        rel = _display_path(path, scope.project_path)
        name = path.name
        if terms and not (
            _matches_terms(name, terms)
            or _matches_terms(rel, terms)
        ):
            return
        if is_dir:
            entry = WorkspaceFileEntry(name, rel, "folder")
        else:
            entry = _file_entry(path, rel)
        ranked.append((_match_rank(rel, name, entry.kind, terms), entry))

    try:
        if not terms:
            with os.scandir(directory) as scandir:
                children = sorted(scandir, key=lambda item: item.name.casefold())
                for entry in children:
                    if entry.name in _IGNORED_DIR_NAMES:
                        continue
                    child = Path(entry.path)
                    if entry.is_dir(follow_symlinks=False):
                        consider(child, is_dir=True)
                    elif entry.is_file(follow_symlinks=False):
                        consider(child, is_dir=False)
            ranked.sort(key=lambda item: item[0])
            return [item[1] for item in ranked[:max_entries]]

        # Fuzzy query: walk from the current directory, folders first in ranking.
        for dirpath, dirnames, filenames in os.walk(directory, followlinks=False):
            current = Path(dirpath)
            depth = _depth_from_root(current, scope.project_path)
            if depth > _MAX_LIST_DEPTH:
                dirnames[:] = []
                continue
            dirnames[:] = sorted(
                name
                for name in dirnames
                if name not in _IGNORED_DIR_NAMES
            )
            # Prefer matching directories at this level before descending further.
            for name in list(dirnames):
                child = current / name
                child_depth = depth + 1 if current != directory or depth == root_depth else depth
                if child_depth > _MAX_LIST_DEPTH:
                    continue
                consider(child, is_dir=True)
                if len(ranked) >= max_entries * 4:
                    break
            for name in sorted(filenames, key=str.casefold):
                if name in _IGNORED_DIR_NAMES:
                    continue
                consider(current / name, is_dir=False)
                if len(ranked) >= max_entries * 4:
                    break
            if visited > _MAX_WALK_NODES or len(ranked) >= max_entries * 4:
                break
    except OSError as e:
        raise WorkspaceFileListingError(500, "failed to list directory") from e

    ranked.sort(key=lambda item: item[0])
    return [item[1] for item in ranked[:max_entries]]


def _file_entry(path: Path, rel: str) -> WorkspaceFileEntry:
    size: int | None = None
    binary = False
    try:
        size = path.stat().st_size
        with open(path, "rb") as f:
            binary = b"\0" in f.read(4096)
    except OSError:
        pass
    return WorkspaceFileEntry(path.name, rel, "file", binary, size, _language_for_path(path))


def _language_for_path(path: Path) -> str | None:
    ext = path.suffix.lower().lstrip(".")
    if not ext:
        return None
    if path.name.lower() == "dockerfile":
        return "dockerfile"
    return {
        "js": "javascript",
        "jsx": "jsx",
        "ts": "typescript",
        "tsx": "tsx",
        "json": "json",
        "md": "markdown",
        "py": "python",
        "sh": "bash",
        "yaml": "yaml",
        "yml": "yaml",
    }.get(ext, ext)


def _display_path(path: Path, root: Path) -> str:
    try:
        return path.resolve(strict=False).relative_to(root.resolve(strict=False)).as_posix()
    except ValueError:
        return path.as_posix()
