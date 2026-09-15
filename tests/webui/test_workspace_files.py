from pathlib import Path

import pytest

from nanobot.security.workspace_access import default_workspace_scope
from nanobot.webui.workspace_files import WorkspaceFileListingError, workspace_files_payload


def test_lists_workspace_files_and_folders(tmp_path: Path) -> None:
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "main.py").write_text("print('ok')", encoding="utf-8")
    (tmp_path / "image.bin").write_bytes(b"\x00\x01")
    (tmp_path / "node_modules").mkdir()
    scope = default_workspace_scope(tmp_path, restrict_to_workspace=True)

    payload = workspace_files_payload(None, query=None, scope=scope)

    assert {item["path"] for item in payload["items"]} == {"src", "image.bin"}
    image = next(item for item in payload["items"] if item["path"] == "image.bin")
    assert image["binary"] is True
    # Folders sort ahead of files when listing the root.
    assert payload["items"][0]["path"] == "src"
    assert payload["items"][0]["kind"] == "folder"


def test_filters_by_name_and_rejects_escape(tmp_path: Path) -> None:
    (tmp_path / "README.md").write_text("readme", encoding="utf-8")
    (tmp_path / "notes.txt").write_text("notes", encoding="utf-8")
    scope = default_workspace_scope(tmp_path, restrict_to_workspace=True)

    payload = workspace_files_payload(None, query="read", scope=scope)
    assert [item["path"] for item in payload["items"]] == ["README.md"]

    with pytest.raises(WorkspaceFileListingError) as exc_info:
        workspace_files_payload("../", query=None, scope=scope)
    assert exc_info.value.status == 403


def test_fuzzy_match_prefers_directories_and_nested_files(tmp_path: Path) -> None:
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "components").mkdir()
    (tmp_path / "src" / "components" / "Button.tsx").write_text("export {}", encoding="utf-8")
    (tmp_path / "src" / "main.py").write_text("print('ok')", encoding="utf-8")
    (tmp_path / "docs").mkdir()
    (tmp_path / "docs" / "guide.md").write_text("# guide", encoding="utf-8")
    (tmp_path / "button-notes.txt").write_text("notes", encoding="utf-8")
    scope = default_workspace_scope(tmp_path, restrict_to_workspace=True)

    by_name = workspace_files_payload(None, query="button", scope=scope)
    paths = [item["path"] for item in by_name["items"]]
    assert "src/components/Button.tsx" in paths
    assert "button-notes.txt" in paths
    # Exact-ish filename match should rank ahead of path-only noise when equal kind.
    assert paths.index("src/components/Button.tsx") < paths.index("button-notes.txt")

    by_dir = workspace_files_payload(None, query="comp", scope=scope)
    assert by_dir["items"][0]["path"] == "src/components"
    assert by_dir["items"][0]["kind"] == "folder"

    nested = workspace_files_payload("src", query="main", scope=scope)
    assert [item["path"] for item in nested["items"]] == ["src/main.py"]


def test_root_listing_pushes_noise_entries_last(tmp_path: Path) -> None:
    """Hidden tool folders and dunder dirs must not crowd out project entries."""
    for name in (".nanobot", ".claude", "__mocks__", "src", "docs"):
        (tmp_path / name).mkdir()
    (tmp_path / "AGENTS.md").write_text("readme", encoding="utf-8")
    (tmp_path / ".env").write_text("K=V", encoding="utf-8")
    scope = default_workspace_scope(tmp_path, restrict_to_workspace=True)

    paths = [item["path"] for item in workspace_files_payload(None, query=None, scope=scope)["items"]]

    # Project entries first (folders before files), then the demoted noise.
    assert paths == ["docs", "src", "AGENTS.md", ".claude", ".nanobot", "__mocks__", ".env"]


def test_fuzzy_query_ranks_noise_below_project_matches(tmp_path: Path) -> None:
    """A parent hidden directory must not outrank a real project match."""
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "components").mkdir()
    (tmp_path / "src" / "components" / "Button.tsx").write_text("export {}", encoding="utf-8")
    (tmp_path / ".claude").mkdir()
    (tmp_path / ".claude" / "components").mkdir()
    (tmp_path / ".claude" / "settings.json").write_text("{}", encoding="utf-8")
    scope = default_workspace_scope(tmp_path, restrict_to_workspace=True)

    paths = [item["path"] for item in workspace_files_payload(None, query="comp", scope=scope)["items"]]

    assert paths[0] == "src/components"
    assert ".claude/components" in paths
    assert paths.index("src/components") < paths.index(".claude/components")


def test_noise_entries_still_surface_when_queried_directly(tmp_path: Path) -> None:
    """Demotion is ordering only: explicitly searched hidden entries still resolve."""
    (tmp_path / "src").mkdir()
    (tmp_path / ".nanobot").mkdir()
    (tmp_path / ".nanobot" / "config.json").write_text("{}", encoding="utf-8")
    scope = default_workspace_scope(tmp_path, restrict_to_workspace=True)

    paths = [item["path"] for item in workspace_files_payload(None, query="config", scope=scope)["items"]]

    assert paths == [".nanobot/config.json"]

