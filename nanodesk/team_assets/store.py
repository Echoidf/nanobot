"""Filesystem store for published team assets and the local pending queue.

Layout under ``<workspace>/team_assets``::

    published/skills/<id>/<version>/SKILL.md
    published/skills/<id>/<version>/asset.json
    published/mcp/<name>/<version>/manifest.json
    published/mcp/<name>/<version>/asset.json
    pending/<submission_id>.json

Pending submissions are inert review data: they are never loaded into the
agent runtime. Only an authenticated reviewer (team WebUI) may promote a
pending submission into ``published``.
"""

from __future__ import annotations

import hashlib
import json
import re
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, cast

AssetKind = Literal["skill", "mcp"]

_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_MCP_NAME_PATTERN = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")
_VERSION_PATTERN = re.compile(r"^[A-Za-z0-9._-]{1,32}$")
_SUBMISSION_ID_PATTERN = re.compile(r"^sub_[0-9a-f]{16}$")
_PENDING_STATUSES = ("pending", "approved", "rejected")

__all__ = [
    "AssetKind",
    "PublishedAsset",
    "TeamAssetStore",
    "normalize_asset_id",
    "normalize_version",
]


def _read_json(path: Path) -> dict[str, Any]:
    try:
        data = cast(object, json.loads(path.read_text(encoding="utf-8")))
    except (OSError, ValueError) as exc:
        raise ValueError(f"corrupt asset metadata: {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError(f"corrupt asset metadata: {path}")
    return cast(dict[str, Any], data)


def normalize_asset_id(kind: AssetKind, raw: str) -> str:
    """Validate and normalize a published asset id (skill id or MCP name)."""
    value = (raw or "").strip()
    pattern = _ID_PATTERN if kind == "skill" else _MCP_NAME_PATTERN
    if not pattern.fullmatch(value):
        raise ValueError(f"invalid {kind} id: {raw!r}")
    return value


def normalize_version(raw: str) -> str:
    """Validate and normalize a fixed asset version string."""
    value = (raw or "").strip()
    if not _VERSION_PATTERN.fullmatch(value):
        raise ValueError(f"invalid version: {raw!r}")
    return value


@dataclass(frozen=True)
class PublishedAsset:
    """Metadata for one fixed published asset version."""

    kind: AssetKind
    asset_id: str
    version: str
    name: str
    description: str
    content_hash: str
    team_instance_id: str
    created_at: float


class TeamAssetStore:
    """Read published bundles and append pending submissions on local disk."""

    def __init__(self, workspace: str | Path, *, team_instance_id: str = "") -> None:
        self.workspace = Path(workspace).expanduser().resolve(strict=False)
        self.root = self.workspace / "team_assets"
        self.published_dir = self.root / "published"
        self.pending_dir = self.root / "pending"
        self.team_instance_id = team_instance_id.strip()

    def ensure_dirs(self) -> None:
        self.published_dir.mkdir(parents=True, exist_ok=True)
        self.pending_dir.mkdir(parents=True, exist_ok=True)

    # -- published ------------------------------------------------------

    def _version_dir(self, kind: AssetKind, asset_id: str, version: str) -> Path:
        kind_dir = "skills" if kind == "skill" else "mcp"
        return self.published_dir / kind_dir / asset_id / version

    @staticmethod
    def content_hash(payload: bytes) -> str:
        return hashlib.sha256(payload).hexdigest()

    def publish_skill_version(
        self,
        *,
        skill_id: str,
        version: str,
        skill_markdown: str,
        description: str = "",
    ) -> PublishedAsset:
        """Persist one fixed skill version (reviewer path; caller must be authed)."""
        from nanodesk.team_assets.bundles import validate_skill_markdown

        asset_id = normalize_asset_id("skill", skill_id)
        version = normalize_version(version)
        validate_skill_markdown(asset_id, skill_markdown)
        return self._write_published(
            kind="skill",
            asset_id=asset_id,
            version=version,
            filename="SKILL.md",
            payload=skill_markdown.encode("utf-8"),
            description=description,
        )

    def publish_mcp_version(
        self,
        *,
        name: str,
        version: str,
        manifest: dict[str, Any],
    ) -> PublishedAsset:
        """Persist one fixed MCP version after credential stripping (reviewer path)."""
        from nanodesk.team_assets.bundles import mcp_manifest_hash, sanitize_mcp_manifest

        asset_id = normalize_asset_id("mcp", name)
        version = normalize_version(version)
        clean = sanitize_mcp_manifest(manifest)
        payload = json.dumps(clean, ensure_ascii=False, indent=2).encode("utf-8")
        return self._write_published(
            kind="mcp",
            asset_id=asset_id,
            version=version,
            filename="manifest.json",
            payload=payload,
            description=clean.get("description", ""),
            # Hash the canonical manifest, not the pretty-printed file, so the
            # catalog hash matches the one carried in the download envelope.
            content_hash=mcp_manifest_hash(clean),
        )

    def _write_published(
        self,
        *,
        kind: AssetKind,
        asset_id: str,
        version: str,
        filename: str,
        payload: bytes,
        description: str,
        content_hash: str | None = None,
    ) -> PublishedAsset:
        self.ensure_dirs()
        version_dir = self._version_dir(kind, asset_id, version)
        version_dir.mkdir(parents=True, exist_ok=True)
        content_path = version_dir / filename
        content_path.write_bytes(payload)
        asset = PublishedAsset(
            kind=kind,
            asset_id=asset_id,
            version=version,
            name=asset_id,
            description=(description or "").strip()[:1024],
            content_hash=content_hash or self.content_hash(payload),
            team_instance_id=self.team_instance_id,
            created_at=time.time(),
        )
        meta_path = version_dir / "asset.json"
        tmp_path = meta_path.with_suffix(".tmp")
        tmp_path.write_text(
            json.dumps(
                {
                    "kind": asset.kind,
                    "id": asset.asset_id,
                    "version": asset.version,
                    "name": asset.name,
                    "description": asset.description,
                    "content_hash": asset.content_hash,
                    "team_instance_id": asset.team_instance_id,
                    "created_at": asset.created_at,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        tmp_path.replace(meta_path)
        return asset

    def list_published(self, kind: AssetKind) -> list[PublishedAsset]:
        """List every published fixed version for one asset kind."""
        kind_dir = self.published_dir / ("skills" if kind == "skill" else "mcp")
        results: list[PublishedAsset] = []
        if not kind_dir.is_dir():
            return results
        for id_dir in sorted(kind_dir.iterdir()):
            if not id_dir.is_dir():
                continue
            for version_dir in sorted(id_dir.iterdir()):
                meta = version_dir / "asset.json"
                if not version_dir.is_dir() or not meta.is_file():
                    continue
                try:
                    data = _read_json(meta)
                    results.append(
                        PublishedAsset(
                            kind=kind,
                            asset_id=str(data.get("id", id_dir.name)),
                            version=str(data.get("version", version_dir.name)),
                            name=str(data.get("name", id_dir.name)),
                            description=str(data.get("description", "")),
                            content_hash=str(data.get("content_hash", "")),
                            team_instance_id=str(data.get("team_instance_id", "")),
                            created_at=float(data.get("created_at", 0.0)),
                        )
                    )
                except (ValueError, TypeError):
                    continue
        return results

    def read_published_bytes(self, kind: AssetKind, asset_id: str, version: str) -> bytes:
        """Read the fixed-version payload bytes, verifying the recorded hash."""
        asset_id = normalize_asset_id(kind, asset_id)
        version = normalize_version(version)
        version_dir = self._version_dir(kind, asset_id, version)
        filename = "SKILL.md" if kind == "skill" else "manifest.json"
        content_path = version_dir / filename
        meta_path = version_dir / "asset.json"
        if not content_path.is_file() or not meta_path.is_file():
            raise FileNotFoundError(f"{kind} {asset_id}@{version} is not published")
        payload = content_path.read_bytes()
        recorded = str(_read_json(meta_path).get("content_hash", ""))
        if recorded and recorded != self._expected_hash(kind, payload):
            raise ValueError(f"{kind} {asset_id}@{version} failed integrity check")
        return payload

    @staticmethod
    def _expected_hash(kind: AssetKind, payload: bytes) -> str:
        """Hash the asset's canonical content, matching what publish recorded."""
        if kind == "skill":
            return hashlib.sha256(payload).hexdigest()
        from nanodesk.team_assets.bundles import mcp_manifest_hash

        try:
            data = cast(object, json.loads(payload.decode("utf-8")))
        except (UnicodeDecodeError, ValueError) as exc:
            raise ValueError("corrupt MCP manifest payload") from exc
        if not isinstance(data, dict):
            raise ValueError("corrupt MCP manifest payload")
        return mcp_manifest_hash(cast(dict[str, Any], data))

    # -- pending ---------------------------------------------------------

    def append_pending(self, submission: dict[str, Any]) -> str:
        """Append one inert pending submission; returns the submission id.

        The submission payload carries the *asset* id under ``id``, so the
        envelope's own key is ``submission_id`` to keep both addressable.
        """
        self.ensure_dirs()
        submission_id = f"sub_{uuid.uuid4().hex[:16]}"
        record = {
            "submission_id": submission_id,
            "status": "pending",
            "created_at": time.time(),
            **submission,
        }
        path = self.pending_dir / f"{submission_id}.json"
        tmp_path = path.with_suffix(".tmp")
        tmp_path.write_text(
            json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        tmp_path.replace(path)
        return submission_id

    def list_pending(self) -> list[dict[str, Any]]:
        """List pending submissions for the authenticated reviewer surface."""
        if not self.pending_dir.is_dir():
            return []
        records: list[dict[str, Any]] = []
        for path in sorted(self.pending_dir.glob("sub_*.json")):
            try:
                records.append(_read_json(path))
            except ValueError:
                continue
        return records

    def get_pending(self, submission_id: str) -> dict[str, Any]:
        """Read one submission record by id (reviewer path; caller must be authed)."""
        path = self._pending_path(submission_id)
        if not path.is_file():
            raise FileNotFoundError(f"submission not found: {submission_id}")
        return _read_json(path)

    def set_pending_status(
        self,
        submission_id: str,
        status: str,
        *,
        reviewed_at: float | None = None,
        reviewer: str = "",
    ) -> dict[str, Any]:
        """Record a review decision on one submission, keeping the audit trail."""
        if status not in _PENDING_STATUSES:
            raise ValueError(f"invalid submission status: {status}")
        record = self.get_pending(submission_id)
        record["status"] = status
        record["reviewed_at"] = float(reviewed_at if reviewed_at is not None else time.time())
        record["reviewer"] = reviewer.strip()[:64]
        path = self._pending_path(submission_id)
        tmp_path = path.with_suffix(".tmp")
        tmp_path.write_text(
            json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        tmp_path.replace(path)
        return record

    def _pending_path(self, submission_id: str) -> Path:
        if _SUBMISSION_ID_PATTERN.fullmatch(submission_id or "") is None:
            raise ValueError(f"invalid submission id: {submission_id!r}")
        return self.pending_dir / f"{submission_id}.json"
