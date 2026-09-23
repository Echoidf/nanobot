"""Console entrypoint for the nanodesk CLI."""

from __future__ import annotations

import os
import sys
from contextlib import suppress


def _configure_windows_console() -> None:
    if sys.platform != "win32" or sys.stdout.encoding == "utf-8":
        return
    os.environ["PYTHONIOENCODING"] = "utf-8"
    with suppress(Exception):
        for stream in (sys.stdout, sys.stderr):
            reconfigure = getattr(stream, "reconfigure", None)
            if callable(reconfigure):
                reconfigure(encoding="utf-8", errors="replace")


def main() -> None:
    """Run the nanodesk CLI."""
    _configure_windows_console()
    from nanodesk.cli.commands import app

    app()
