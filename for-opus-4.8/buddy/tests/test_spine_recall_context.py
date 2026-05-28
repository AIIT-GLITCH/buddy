"""Tests for core.spine_recall_context.

The #5 fix changes the /api/chat call site to pass the real public-ness
(`not _is_loopback_request(request)`) into `build_spine_recall_block` instead
of a hardcoded False. These tests lock the contract the fix depends on: the
`is_public` flag must flow through to BOTH the receipt formatter and the spine
loader (the privacy filters). If propagation ever breaks, passing the correct
flag at the call site would silently become a no-op.

The real lab loader (spine_context_loader / memory_receipt) lives outside this
repo, so we inject fakes into sys.modules and assert the flag they receive.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core import spine_recall_context as src


@pytest.fixture
def fake_lab(monkeypatch):
    """Inject fake spine_context_loader + memory_receipt and record is_public."""
    seen = {"loader_is_public": None, "receipt_is_public": None}

    loader = types.ModuleType("spine_context_loader")

    def load_spine_context(*, query=None, session_id=None, is_public=False,
                           max_records=None, max_chars=None):
        seen["loader_is_public"] = is_public
        return "[14-TIER SPINE CONTEXT] ctx [/14-TIER SPINE CONTEXT]"

    loader.load_spine_context = load_spine_context

    receipt = types.ModuleType("memory_receipt")

    def pull_undelivered_receipts(*, session_id=None):
        return [{"id": "r1"}]

    def format_receipts_block(receipts, *, is_public=False):
        seen["receipt_is_public"] = is_public
        return "[MEMORY RECEIPT] landed [/MEMORY RECEIPT]"

    receipt.pull_undelivered_receipts = pull_undelivered_receipts
    receipt.format_receipts_block = format_receipts_block

    monkeypatch.setitem(sys.modules, "spine_context_loader", loader)
    monkeypatch.setitem(sys.modules, "memory_receipt", receipt)
    # Keep the (nonexistent) lab path out of the way; fakes are already in sys.modules.
    monkeypatch.setattr(src, "_ensure_lab_on_path", lambda: None)
    monkeypatch.setenv("BUDDY_SPINE_RECALL_ENABLED", "1")
    return seen


@pytest.mark.parametrize("is_public", [True, False])
def test_is_public_flag_propagates_to_both_filters(fake_lab, is_public):
    block = src.build_spine_recall_block(
        session_id="s1", query="anything", is_public=is_public
    )
    # The exact value the call site passes must reach both privacy filters.
    assert fake_lab["loader_is_public"] is is_public
    assert fake_lab["receipt_is_public"] is is_public
    # And both blocks are present in the combined output.
    assert "14-TIER SPINE CONTEXT" in block
    assert "MEMORY RECEIPT" in block


def test_recall_disabled_returns_empty(fake_lab, monkeypatch):
    monkeypatch.setenv("BUDDY_SPINE_RECALL_ENABLED", "0")
    assert src.build_spine_recall_block(session_id="s1") == ""


def test_loader_failure_is_swallowed(monkeypatch):
    # If the lab modules can't be imported, the block degrades to "" (never raises).
    monkeypatch.setattr(src, "_ensure_lab_on_path", lambda: None)
    monkeypatch.delitem(sys.modules, "spine_context_loader", raising=False)
    monkeypatch.delitem(sys.modules, "memory_receipt", raising=False)
    monkeypatch.setenv("BUDDY_SPINE_RECALL_ENABLED", "1")
    # No fakes injected and the real lab path doesn't exist here.
    assert src.build_spine_recall_block(session_id="s1") == ""


# --- pure mode helpers ------------------------------------------------------

def test_detect_response_mode_classifies():
    assert src.detect_response_mode("give me everything in full detail") == "longform"
    assert src.detect_response_mode("tell me about your memory and the 14-tier spine") == "memory"
    assert src.detect_response_mode("explain how this works") == "deep"
    assert src.detect_response_mode("what time is it") == "normal"
    assert src.detect_response_mode("") == "normal"


def test_max_chars_and_tokens_for_mode(monkeypatch):
    assert src.max_chars_for_mode("normal") == 2500
    assert src.max_chars_for_mode("longform") == 10000
    # token budget is char budget / ~3.5, floored at 64
    assert src.max_tokens_for_mode("normal") == int(2500 / 3.5)
    assert src.max_tokens_for_mode("unknown-mode") >= 64
    # env override is clamped to [200, 10000]
    monkeypatch.setenv("BUDDY_CHAT_MAX_CHARS_DEEP", "999999")
    assert src.max_chars_for_mode("deep") == 10000
