"""Effective-identity helpers.

A nanodesk gateway is often started through a launcher that changes only the
*effective* uid (``setuid`` exec bit on a shared binary, ``sudo`` wrappers,
privileged supervisors). Python still reports ``getuid()`` as the real,
unprivileged user in that mode while every file the process creates is owned
by the effective user.

Python's own ``expanduser("~")`` / ``Path.home()`` resolve ``~`` through
``getuid()`` and ``$HOME``, so a root-effective process happily writes
``~/.nanodesk`` for the unprivileged user, who then cannot edit config.json.
These helpers decide identity from the *effective* id instead and build home
paths from it.
"""

from __future__ import annotations

import os
import pwd as _pwd
from collections.abc import Mapping
from contextlib import suppress
from pathlib import Path

# Platform-safe identity accessors (``os.getuid`` does not exist on Windows).
_GETUID = getattr(os, "getuid", lambda: -1)
_GETEUID = getattr(os, "geteuid", lambda: -1)
_GETEGID = getattr(os, "getegid", lambda: -1)


def _env(environ: Mapping[str, str] | None) -> Mapping[str, str]:
    return os.environ if environ is None else environ


def effective_ids() -> tuple[int, int]:
    """Return ``(uid, gid)`` that decide file ownership for this process."""
    return _GETEUID(), _GETEGID()


def euid_is_root() -> bool:
    """Return whether this process writes files as ``root``."""
    return _GETEUID() == 0


def _identity_is_effective_root() -> bool:
    """Return whether files written now are owned by root.

    This is the single switch every helper below relies on: ``True`` only when
    the effective uid differs from the real uid and that effective uid is 0
    (setuid launcher, sudo). Drop it into one place so the decision is easy to
    audit and easy to stub in tests.
    """
    euid = _GETEUID()
    return euid == 0 and _GETUID() != euid


def _passwd_home(
    *,
    uid: int | None = None,
    name: str | None = None,
) -> Path | None:
    try:
        entry = _pwd.getpwuid(uid) if uid is not None else _pwd.getpwnam(str(name))
    except KeyError:
        return None
    return Path(entry.pw_dir)


def effective_home_dir(environ: Mapping[str, str] | None = None) -> Path:
    """Return the home directory that matches the effective identity.

    * Unprivileged process (effective uid == real uid): ``$HOME``, i.e. what
      Python itself would use — nothing changes for normal installs.
    * Privileged process: the effective uid's home. When that is root and a
      ``SUDO_USER`` is set, the invoking account's home is used instead so a
      sudo start never lands in ``/root``.

    Falls back to ``Path.home()`` when the account database cannot name the
    effective uid (container without a passwd entry, Windows).
    """
    env = _env(environ)
    if not _identity_is_effective_root():
        home_from_env = env.get("HOME")
        return Path(home_from_env) if home_from_env else Path.home()
    sudo_user = env.get("SUDO_USER")
    if sudo_user and sudo_user != "root":
        sudo_home = _passwd_home(name=sudo_user)
        if sudo_home is not None:
            return sudo_home
    home = _passwd_home(uid=_GETEUID())
    return home if home is not None else Path.home()


def effective_user_name() -> str:
    """Return a human readable name for the effective identity."""
    euid, _egid = effective_ids()
    try:
        return _pwd.getpwuid(euid).pw_name
    except (KeyError, AttributeError):
        return f"uid={euid}"


def set_private_mode(path: Path, mode: int = 0o600) -> None:
    """Restrict *path* to its owner (best effort)."""
    with suppress(OSError):
        os.chmod(path, mode)


def copy_file_owner(path: Path, source: os.stat_result | None) -> None:
    """Best-effort ``chown`` of *path* to *source*'s owner.

    Only a privileged writer (``euid == 0``) can change ownership; an
    unprivileged one already creates the file as its own identity, so the call
    is skipped. Used after atomic temp-file renames, which otherwise hand an
    existing file to whoever performed the write.
    """
    if source is None or not hasattr(os, "chown"):
        return
    if _GETEUID() != 0:
        return
    if source.st_uid == _GETEUID() and source.st_gid == _GETEGID():
        return
    with suppress(OSError):
        os.chown(path, source.st_uid, source.st_gid)
