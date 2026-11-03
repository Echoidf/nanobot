"""Ownership safety for shared (multi-user) installs.

A gateway started with more privilege than the account that owns the instance
must not leave ``~/.nanodesk`` owned by another user. These tests pin the
identity-aware path resolution and the owner-preserving atomic writes.
"""

from __future__ import annotations

import os
import pwd
from pathlib import Path

import pytest

from nanodesk.config import loader
from nanodesk.config import paths as config_paths
from nanodesk.utils import identity
from nanodesk.utils.helpers import _write_text_atomic


class _PasswdEntry:
    def __init__(self, name: str, home: str) -> None:
        self.pw_name = name
        self.pw_dir = home


def _fake_passwd(monkeypatch: pytest.MonkeyPatch, mapping: dict[int, str]) -> None:
    names = {home: f"user{uid}" for uid, home in mapping.items()}

    def _getpwuid(uid: int) -> _PasswdEntry:
        home = mapping[uid]
        return _PasswdEntry(names[home], home)

    def _getpwnam(name: str) -> _PasswdEntry:
        for home, known in names.items():
            if known == name:
                return _PasswdEntry(name, home)
        raise KeyError(name)

    monkeypatch.setattr(identity._pwd, "getpwuid", _getpwuid)
    monkeypatch.setattr(identity._pwd, "getpwnam", _getpwnam)


def test_normal_user_home_follows_env(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(identity, "_identity_is_effective_root", lambda: False)

    assert identity.effective_home_dir({"HOME": str(tmp_path / "home")}) == tmp_path / "home"


def test_privileged_process_uses_effective_uid_home(monkeypatch, tmp_path: Path) -> None:
    """The config must land next to the account that can actually edit it."""
    # Real uid: alice (1000). Effective uid: root (0).
    monkeypatch.setattr(identity, "_identity_is_effective_root", lambda: True)
    monkeypatch.setattr(identity, "_GETEUID", lambda: 0)
    _fake_passwd(monkeypatch, {0: str(tmp_path / "root-home")})

    home = identity.effective_home_dir({"HOME": str(tmp_path / "inherited")})

    assert home == tmp_path / "root-home"


def test_sudo_launch_prefers_sudo_user_home(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(identity, "_identity_is_effective_root", lambda: True)
    monkeypatch.setattr(identity, "_GETEUID", lambda: 0)
    _fake_passwd(
        monkeypatch,
        {0: str(tmp_path / "root-home"), 1000: str(tmp_path / "alice")},
    )

    with_sudo = identity.effective_home_dir({"SUDO_USER": "user1000"})
    without_sudo = identity.effective_home_dir({})

    assert with_sudo == tmp_path / "alice"
    assert without_sudo == tmp_path / "root-home"


def test_real_sudo_environment_is_honoured(monkeypatch) -> None:
    """SUDO_USER=root is not a de-escalation target; fall back to uid 0."""
    monkeypatch.setattr(identity, "_identity_is_effective_root", lambda: True)
    monkeypatch.setattr(identity, "_GETEUID", lambda: 0)
    monkeypatch.setenv("SUDO_USER", "root")

    assert identity.effective_home_dir() == Path(pwd.getpwuid(0).pw_dir)


def test_missing_passwd_entry_falls_back_to_path_home(monkeypatch) -> None:
    monkeypatch.setattr(identity, "_identity_is_effective_root", lambda: True)
    monkeypatch.setattr(identity, "_GETEUID", lambda: 4242)

    def _missing(_uid: int) -> object:
        raise KeyError(4242)

    monkeypatch.setattr(identity._pwd, "getpwuid", _missing)

    assert identity.effective_home_dir({}) == Path.home()


def test_config_path_and_data_dir_share_effective_home(monkeypatch, tmp_path: Path) -> None:
    home = tmp_path / "alice-home"
    monkeypatch.setattr(loader, "effective_home_dir", lambda: home)

    config_path = loader.get_config_path()
    assert config_path == home / ".nanodesk" / "config.json"

    monkeypatch.setattr(config_paths, "get_config_path", loader.get_config_path)
    monkeypatch.setattr(config_paths, "effective_home_dir", lambda: home)
    data_dir = config_paths.get_data_dir()
    assert data_dir == home / ".nanodesk"
    assert config_paths.get_workspace_path() == data_dir / "workspace"
    assert config_paths.is_default_workspace(data_dir / "workspace") is True
    assert config_paths.get_cli_history_path().is_relative_to(home)
    assert config_paths.get_legacy_sessions_dir().is_relative_to(home)


def test_instance_data_dir_is_private(monkeypatch, tmp_path: Path) -> None:
    """~/.nanodesk holds API keys, so other accounts must not read it."""
    config_file = tmp_path / "instance" / "config.json"
    monkeypatch.setattr(config_paths, "get_config_path", lambda: config_file)

    data_dir = config_paths.get_data_dir()
    sessions = config_paths.get_runtime_subdir("sessions")

    if os.name != "nt":
        assert data_dir.stat().st_mode & 0o777 == 0o700
        assert sessions.stat().st_mode & 0o777 == 0o700


def test_atomic_write_keeps_mode_and_owner(tmp_path: Path) -> None:
    target = tmp_path / "config.json"
    target.write_text('{"a": 1}', encoding="utf-8")
    if os.name != "nt":
        os.chmod(target, 0o600)
    before = target.stat()

    _write_text_atomic(target, '{"a": 2}')

    after = target.stat()
    assert target.read_text(encoding="utf-8") == '{"a": 2}'
    if os.name != "nt":
        assert after.st_mode & 0o777 == 0o600
    assert after.st_uid == before.st_uid
    assert not list(tmp_path.glob(".*.tmp"))


def test_permission_error_explains_owner_mismatch(tmp_path: Path) -> None:
    config_file = tmp_path / ".nanodesk" / "config.json"
    config_file.parent.mkdir()
    config_file.write_text("{}", encoding="utf-8")
    exc = PermissionError(13, "Permission denied", str(config_file))

    hint = loader.explain_permission_denied(config_file, exc)

    assert hint is not None
    assert str(config_file) in hint
    assert "chown -R" in hint
    # Anything that is not a permission failure stays unexplained.
    assert loader.explain_permission_denied(config_file, FileNotFoundError()) is None
