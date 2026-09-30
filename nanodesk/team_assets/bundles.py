"""Bundle builders and validators for team Skill/MCP assets.

Security rules enforced here:

- Skill bundles only carry ``SKILL.md`` markdown validated against the Agent
  Skills identity contract. No executable code is uploaded or published.
- MCP publish payloads are allowlist-filtered service definitions. ``env``,
  ``headers`` (the usual credential carriers), and any unknown key are
  dropped. OAuth server *definitions* may be shared (tokens live outside the
  config), but no secret material ever passes through this module.
"""

from __future__ import annotations

import hashlib
import io
import json
import re
import zipfile
from typing import Any, cast

from nanodesk.agent.skills import parse_skill_metadata, valid_skill_metadata

MAX_SKILL_MARKDOWN_BYTES = 64 * 1024
MAX_DESCRIPTION_LEN = 1024
MAX_STRING_LIST_ITEMS = 64

_MCP_TYPES = ("stdio", "sse", "streamableHttp")
_MCP_AUTH = (None, "oauth")
_URL_SCHEMES = ("http://", "https://")

__all__ = [
    "MAX_SKILL_MARKDOWN_BYTES",
    "build_mcp_manifest_envelope",
    "build_skill_bundle",
    "mcp_manifest_hash",
    "sanitize_mcp_manifest",
    "validate_mcp_manifest",
    "validate_skill_markdown",
]


def mcp_manifest_hash(manifest: dict[str, Any]) -> str:
    """Return the canonical content hash of a shareable MCP manifest.

    One serialization, used by both the stored catalog entry and the
    download envelope, so a consumer can cross-check the catalog hash
    against what it actually downloaded.
    """
    payload = json.dumps(manifest, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _as_str(value: object, *, max_len: int) -> str:
    if not isinstance(value, str):
        raise ValueError("expected a string field")
    text = value.strip()
    if len(value.encode("utf-8")) > max_len * 4 or len(text) > max_len:
        raise ValueError("string field too long")
    return text


def validate_skill_markdown(skill_id: str, content: str) -> dict[str, object]:
    """Validate ``SKILL.md`` text against the Agent Skills identity contract."""
    if not content.strip():
        raise ValueError("skill content must be non-empty markdown")
    if len(content.encode("utf-8")) > MAX_SKILL_MARKDOWN_BYTES:
        raise ValueError("skill content exceeds 64 KiB")
    metadata = parse_skill_metadata(content)
    if metadata is None:
        raise ValueError("skill content is missing valid YAML frontmatter")
    if not valid_skill_metadata(metadata, skill_id):
        raise ValueError("skill frontmatter must match the skill id contract")
    return metadata


def build_skill_bundle(
    *,
    team_instance_id: str,
    skill_id: str,
    version: str,
    skill_markdown: str,
) -> bytes:
    """Build a fixed-version skill bundle (zip with SKILL.md + manifest)."""
    validate_skill_markdown(skill_id, skill_markdown)
    payload = skill_markdown.encode("utf-8")
    content_hash = hashlib.sha256(payload).hexdigest()
    manifest = {
        "team_instance_id": team_instance_id.strip(),
        "asset_type": "skill",
        "id": skill_id,
        "version": version,
        "content_hash": content_hash,
    }
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("SKILL.md", payload)
        archive.writestr(
            "manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2)
        )
    return buffer.getvalue()


def _clean_str_list(value: Any, *, item_max_len: int = 64) -> list[str]:
    if value is None:
        return []
    items = cast(list[Any], value) if isinstance(value, list) else None
    if items is None or len(items) > MAX_STRING_LIST_ITEMS:
        raise ValueError("invalid string list")
    cleaned: list[str] = []
    for item in items:
        if not isinstance(item, str) or not item.strip():
            raise ValueError("invalid string list entry")
        text = item.strip()
        if len(text) > item_max_len:
            raise ValueError("string list entry too long")
        cleaned.append(text)
    return cleaned


def validate_mcp_manifest(manifest: Any) -> dict[str, Any]:
    """Validate a shareable MCP service definition (no credentials allowed)."""
    if not isinstance(manifest, dict):
        raise ValueError("mcp manifest must be an object")
    data = cast(dict[str, Any], manifest)
    rejected = [key for key in ("env", "headers") if key in data]
    if rejected:
        raise ValueError(f"mcp manifest must not contain credentials: {rejected}")
    server_type = data.get("type")
    if server_type is not None and server_type not in _MCP_TYPES:
        raise ValueError(f"unsupported mcp type: {server_type!r}")
    auth = data.get("auth")
    if auth not in _MCP_AUTH:
        raise ValueError(f"unsupported mcp auth: {auth!r}")

    command = ""
    if server_type in (None, "stdio"):
        raw_command = data.get("command", "")
        if raw_command:
            command = _as_str(cast(object, raw_command), max_len=512)
    args = _clean_str_list(data.get("args", []), item_max_len=512)
    url = _as_str(cast(object, data.get("url", "") or ""), max_len=2048)
    if server_type in ("sse", "streamableHttp"):
        if not url.startswith(_URL_SCHEMES):
            raise ValueError("http mcp servers require an http(s) url")
    elif url and not url.startswith(_URL_SCHEMES):
        raise ValueError("mcp url must be http(s)")

    enabled_tools = _clean_str_list(
        data.get("enabled_tools", ["*"]), item_max_len=64
    )
    if not enabled_tools:
        raise ValueError("enabled_tools must not be empty")
    description = _as_str(cast(object, data.get("description", "") or ""), max_len=1024)
    docs_url = _as_str(cast(object, data.get("docs_url", "") or ""), max_len=2048)
    if docs_url and not docs_url.startswith(_URL_SCHEMES):
        raise ValueError("docs_url must be http(s)")

    tool_timeout = data.get("tool_timeout", 30)
    if not isinstance(tool_timeout, int) or not 1 <= tool_timeout <= 600:
        raise ValueError("tool_timeout must be 1..600")
    enabled = data.get("enabled", True)
    if not isinstance(enabled, bool):
        raise ValueError("enabled must be a boolean")
    cwd = _as_str(cast(object, data.get("cwd", "") or ""), max_len=1024)
    if cwd and re.search(r"[;\n\r`$]", cwd):
        raise ValueError("invalid cwd")

    return {
        "type": server_type,
        "auth": auth,
        "command": command,
        "args": args,
        "cwd": cwd,
        "url": url,
        "tool_timeout": tool_timeout,
        "enabled_tools": enabled_tools,
        "enabled": enabled,
        "description": description,
        "docs_url": docs_url,
    }


def sanitize_mcp_manifest(manifest: Any) -> dict[str, Any]:
    """Return the allowlisted shareable subset of an MCP server config."""
    if not isinstance(manifest, dict):
        raise ValueError("mcp manifest must be an object")
    data = cast(dict[str, Any], manifest)
    return validate_mcp_manifest(
        {key: data[key] for key in (
            "type", "auth", "command", "args", "cwd", "url",
            "tool_timeout", "enabled_tools", "enabled",
            "description", "docs_url",
        ) if key in data}
    )


def build_mcp_manifest_envelope(
    *,
    team_instance_id: str,
    name: str,
    version: str,
    manifest: dict[str, Any],
) -> dict[str, Any]:
    """Wrap a sanitized MCP manifest with fixed-version provenance."""
    clean = sanitize_mcp_manifest(manifest)
    return {
        "team_instance_id": team_instance_id.strip(),
        "asset_type": "mcp",
        "id": name,
        "version": version,
        "content_hash": mcp_manifest_hash(clean),
        "manifest": clean,
    }
