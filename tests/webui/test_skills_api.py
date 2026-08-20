from pathlib import Path
from types import SimpleNamespace

import pytest

from nanobot.config.loader import load_config, save_config
from nanobot.config.schema import Config
from nanobot.webui.skills_api import (
    SkillManagementError,
    delete_webui_skill,
    import_webui_local_skills,
    set_webui_skill_enabled,
    webui_local_skills_payload,
    webui_skill_detail_payload,
    webui_skills_payload,
)


def _write_skill(workspace: Path, name: str, *, metadata: str = "") -> Path:
    directory = workspace / "skills" / name
    directory.mkdir(parents=True)
    (directory / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: {name} description.\n{metadata}---\n",
        encoding="utf-8",
    )
    return directory


def _config(*disabled: str) -> SimpleNamespace:
    return SimpleNamespace(
        agents=SimpleNamespace(
            defaults=SimpleNamespace(disabled_skills=list(disabled)),
        )
    )


def test_local_skills_are_linked_and_existing_workspace_entries_are_skipped(
    tmp_path: Path,
) -> None:
    workspace = tmp_path / "workspace"
    source = tmp_path / "local-skills"
    for name, description in (
        ("alpha", "Alpha skill."),
        ("beta", "Beta skill."),
        ("cron", "Conflicts with built-in."),
    ):
        skill_dir = source / name
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(
            f"---\nname: {name}\ndescription: {description}\n---\n",
            encoding="utf-8",
        )
    _write_skill(workspace, "beta")

    payload = webui_local_skills_payload(workspace, source_path=str(source))

    assert payload == {
        "source_path": str(source),
        "skills": [
            {
                "name": "alpha",
                "description": "Alpha skill.",
                "already_imported": False,
            },
            {
                "name": "beta",
                "description": "Beta skill.",
                "already_imported": True,
            },
            {
                "name": "cron",
                "description": "Conflicts with built-in.",
                "already_imported": True,
            },
        ],
    }

    action = import_webui_local_skills(
        workspace,
        ["alpha", "beta", "cron"],
        source_path=str(source),
    )

    linked = workspace / "skills" / "alpha"
    assert action == {
        "source_path": str(source),
        "imported": ["alpha"],
        "skipped": [
            {"name": "beta", "reason": "already_exists"},
            {"name": "cron", "reason": "already_exists"},
        ],
    }
    assert linked.is_symlink()
    assert linked.resolve() == (source / "alpha").resolve()


def test_local_skill_scan_skips_symlinks_that_escape_source_root(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    source = tmp_path / "local-skills"
    outside = tmp_path / "outside-skill"
    source.mkdir()
    outside.mkdir()
    (outside / "SKILL.md").write_text(
        "---\nname: escaped\ndescription: Escaped skill.\n---\n",
        encoding="utf-8",
    )
    try:
        (source / "escaped").symlink_to(outside, target_is_directory=True)
    except OSError as exc:
        pytest.skip(f"directory symlink unavailable: {exc}")

    payload = webui_local_skills_payload(workspace, source_path=str(source))

    assert payload["skills"] == []


def test_local_skill_import_rolls_back_links_when_batch_fails(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = tmp_path / "workspace"
    source = tmp_path / "local-skills"
    for name in ("alpha", "beta"):
        skill_dir = source / name
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(
            f"---\nname: {name}\ndescription: {name} skill.\n---\n",
            encoding="utf-8",
        )
    original_symlink_to = Path.symlink_to

    def fail_second_link(
        path: Path,
        target: Path,
        target_is_directory: bool = False,
    ) -> None:
        if path.name == "beta":
            raise OSError("link failed")
        original_symlink_to(path, target, target_is_directory=target_is_directory)

    monkeypatch.setattr(Path, "symlink_to", fail_second_link)

    with pytest.raises(SkillManagementError, match="could not link skill beta"):
        import_webui_local_skills(
            workspace,
            ["alpha", "beta"],
            source_path=str(source),
        )

    assert not (workspace / "skills" / "alpha").exists()
    assert not (workspace / "skills" / "alpha").is_symlink()


def test_deleting_imported_skill_removes_only_symlink(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = tmp_path / "workspace"
    source = tmp_path / "local-skills"
    source_skill = source / "linked-skill"
    source_skill.mkdir(parents=True)
    (source_skill / "SKILL.md").write_text(
        "---\nname: linked-skill\ndescription: Linked skill.\n---\n",
        encoding="utf-8",
    )
    import_webui_local_skills(
        workspace,
        ["linked-skill"],
        source_path=str(source),
    )
    moved_source = tmp_path / "moved-linked-skill"
    source_skill.rename(moved_source)
    config = _config()
    monkeypatch.setattr("nanobot.webui.skills_api.load_config", lambda _path=None: config)
    monkeypatch.setattr("nanobot.webui.skills_api.save_config", lambda *_args: None)

    action = delete_webui_skill(
        workspace,
        "linked-skill",
        disabled_skills=set(),
    )

    assert action["deleted"] is True
    assert not (workspace / "skills" / "linked-skill").is_symlink()
    assert moved_source.is_dir()
    assert (moved_source / "SKILL.md").is_file()


def test_disabled_skills_remain_visible_and_loadable(tmp_path: Path) -> None:
    _write_skill(tmp_path, "custom-skill")

    payload = webui_skills_payload(tmp_path, disabled_skills={"custom-skill"})
    skill = next(item for item in payload["skills"] if item["name"] == "custom-skill")

    assert skill["enabled"] is False
    assert skill["deletable"] is True
    detail = webui_skill_detail_payload(
        tmp_path,
        "custom-skill",
        disabled_skills={"custom-skill"},
    )
    assert detail is not None
    assert detail["enabled"] is False
    assert "custom-skill description" in detail["raw_markdown"]


def test_skill_detail_exposes_copyable_install_commands(tmp_path: Path) -> None:
    _write_skill(
        tmp_path,
        "custom-skill",
        metadata=(
            'metadata: {"nanobot":{"requires":{"bins":["demo"]},'
            '"install":[{"id":"brew","kind":"brew","formula":"acme/demo",'
            '"label":"Install demo"}]}}\n'
        ),
    )

    detail = webui_skill_detail_payload(tmp_path, "custom-skill")

    assert detail is not None
    assert detail["install_options"] == [
        {
            "id": "brew",
            "kind": "brew",
            "label": "Install demo",
            "command": "brew install acme/demo",
        }
    ]


def test_set_webui_skill_enabled_persists_and_updates_runtime(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _write_skill(tmp_path, "custom-skill")
    config = _config()
    saved: list[object] = []
    monkeypatch.setattr("nanobot.webui.skills_api.load_config", lambda _path=None: config)
    monkeypatch.setattr(
        "nanobot.webui.skills_api.save_config",
        lambda value, _path=None: saved.append(value),
    )
    disabled: set[str] = set()

    action = set_webui_skill_enabled(
        tmp_path,
        "custom-skill",
        enabled=False,
        disabled_skills=disabled,
    )

    assert action == {
        "name": "custom-skill",
        "enabled": False,
        "deleted": False,
    }
    assert config.agents.defaults.disabled_skills == ["custom-skill"]
    assert disabled == {"custom-skill"}
    assert saved == [config]


def test_skill_state_uses_explicit_gateway_config(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = tmp_path / "workspace"
    _write_skill(workspace, "custom-skill")
    default_path = tmp_path / "default.json"
    gateway_path = tmp_path / "gateway.json"
    save_config(Config(), default_path)
    save_config(Config(), gateway_path)
    monkeypatch.setattr("nanobot.config.loader._current_config_path", default_path)

    set_webui_skill_enabled(
        workspace,
        "custom-skill",
        enabled=False,
        disabled_skills=set(),
        config_path=gateway_path,
    )

    assert load_config(default_path).agents.defaults.disabled_skills == []
    assert load_config(gateway_path).agents.defaults.disabled_skills == ["custom-skill"]


def test_delete_webui_skill_only_deletes_workspace_skills(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    directory = _write_skill(tmp_path, "custom-skill")
    config = _config("custom-skill")
    saved: list[object] = []
    monkeypatch.setattr("nanobot.webui.skills_api.load_config", lambda _path=None: config)
    monkeypatch.setattr(
        "nanobot.webui.skills_api.save_config",
        lambda value, _path=None: saved.append(value),
    )
    disabled = {"custom-skill"}

    action = delete_webui_skill(
        tmp_path,
        "custom-skill",
        disabled_skills=disabled,
    )

    assert action["deleted"] is True
    assert not directory.exists()
    assert disabled == set()
    assert config.agents.defaults.disabled_skills == []
    assert saved == [config]

    with pytest.raises(SkillManagementError) as exc_info:
        delete_webui_skill(tmp_path, "cron", disabled_skills=disabled)
    assert exc_info.value.status == 403


def test_delete_webui_skill_rejects_symlinked_skills_root(
    tmp_path: Path,
) -> None:
    workspace = tmp_path / "workspace"
    outside = tmp_path / "outside"
    workspace.mkdir()
    directory = outside / "custom-skill"
    directory.mkdir(parents=True)
    (directory / "SKILL.md").write_text(
        "---\nname: custom-skill\n---\n",
        encoding="utf-8",
    )
    try:
        (workspace / "skills").symlink_to(outside, target_is_directory=True)
    except OSError as exc:
        pytest.skip(f"directory symlink unavailable: {exc}")

    with pytest.raises(SkillManagementError) as exc_info:
        delete_webui_skill(workspace, "custom-skill", disabled_skills=set())

    assert exc_info.value.status == 403
    assert (outside / "custom-skill" / "SKILL.md").is_file()


def test_delete_webui_skill_restores_directory_when_config_save_fails(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    directory = _write_skill(tmp_path, "custom-skill")
    config = _config("custom-skill")
    monkeypatch.setattr("nanobot.webui.skills_api.load_config", lambda _path=None: config)

    def fail_save(_config: object, _path: Path | None = None) -> None:
        raise OSError("disk full")

    monkeypatch.setattr("nanobot.webui.skills_api.save_config", fail_save)
    disabled = {"custom-skill"}

    with pytest.raises(OSError, match="disk full"):
        delete_webui_skill(
            tmp_path,
            "custom-skill",
            disabled_skills=disabled,
        )

    assert directory.is_dir()
    assert (directory / "SKILL.md").is_file()
    assert config.agents.defaults.disabled_skills == ["custom-skill"]
    assert disabled == {"custom-skill"}
