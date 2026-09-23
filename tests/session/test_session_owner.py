"""Tests for the lightweight session owner lock."""

from nanodesk.session.owner import heartbeat, owner_status, release, try_claim


def test_claim_heartbeat_release_flow() -> None:
    metadata: dict[str, object] = {}
    assert owner_status(metadata)["active"] is False

    ok, status = try_claim(metadata, owner_id="alice", label="Alice")
    assert ok is True
    assert status["owner"] == "alice"

    # Another active owner cannot steal the session.
    ok, status = try_claim(metadata, owner_id="bob", label="Bob")
    assert ok is False
    assert status["owner"] == "alice"

    ok, _ = heartbeat(metadata, owner_id="alice")
    assert ok is True
    ok, _ = heartbeat(metadata, owner_id="bob")
    assert ok is False

    # Others cannot release; the holder can.
    release(metadata, owner_id="bob")
    assert owner_status(metadata)["owner"] == "alice"
    release(metadata, owner_id="alice")
    assert owner_status(metadata)["active"] is False

    # After release someone else can claim.
    ok, _ = try_claim(metadata, owner_id="bob")
    assert ok is True


def test_stale_owner_can_be_taken_over() -> None:
    metadata: dict[str, object] = {
        "session_owner": "alice",
        "session_owner_label": "Alice",
        "session_owner_at": 1000.0,
    }
    assert owner_status(metadata, now=1000.0 + 30.0)["active"] is True
    assert owner_status(metadata, now=1000.0 + 61.0)["stale"] is True

    ok, status = try_claim(metadata, owner_id="bob", now=1000.0 + 61.0)
    assert ok is True
    assert status["owner"] == "bob"
