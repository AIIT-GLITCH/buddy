"""Tests for core.account_thread_context (logged-in persistent chat hydration).

Pure-function tests; no disk, no model, no kokoro/spine access.
"""

from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core import account_thread_context as atc


SYS = {"role": "system", "content": "BUDDY SYSTEM PROMPT (locked)"}


def _thread(*pairs):
    """Build a surface-shaped thread: ('buddy'|'user', text) -> dicts with `text`."""
    return [{"role": r, "text": t, "at": "2026-05-28T00:00:00Z"} for r, t in pairs]


# ---- normalize_thread_messages -------------------------------------------

def test_normalize_maps_buddy_role_to_assistant():
    out = atc.normalize_thread_messages(_thread(("user", "hi"), ("buddy", "yo")))
    assert out == [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "yo"},
    ]


def test_normalize_accepts_content_key_too():
    out = atc.normalize_thread_messages([{"role": "assistant", "content": "hello"}])
    assert out == [{"role": "assistant", "content": "hello"}]


def test_normalize_drops_empty_and_malformed():
    out = atc.normalize_thread_messages(
        [{"role": "user", "text": "   "}, "not a dict", {"role": "user", "text": "real"}]
    )
    assert out == [{"role": "user", "content": "real"}]


def test_normalize_bounds_chars_and_turns():
    long = "x" * 5000
    msgs = _thread(*[("user", f"m{i}") for i in range(40)]) + _thread(("user", long))
    out = atc.normalize_thread_messages(msgs, max_turns=24, max_chars=100)
    assert len(out) == 24                 # last 24 only
    assert len(out[-1]["content"]) == 100  # char-bounded
    assert out[-1]["content"] == "x" * 100


def test_normalize_non_list_is_empty():
    assert atc.normalize_thread_messages(None) == []
    assert atc.normalize_thread_messages("nope") == []
    assert atc.normalize_thread_messages({"role": "user"}) == []


# ---- should_hydrate -------------------------------------------------------

def test_should_hydrate_when_backend_empty_but_thread_has_history():
    incoming = atc.normalize_thread_messages(_thread(("user", "a"), ("buddy", "b")))
    assert atc.should_hydrate([SYS], incoming) is True          # backend only has system
    assert atc.should_hydrate([], incoming) is True
    assert atc.should_hydrate(None, incoming) is True


def test_should_not_hydrate_when_backend_current_or_ahead():
    incoming = atc.normalize_thread_messages(_thread(("user", "a"), ("buddy", "b")))
    backend_equal = [SYS,
                     {"role": "user", "content": "a"},
                     {"role": "assistant", "content": "b"}]
    assert atc.should_hydrate(backend_equal, incoming) is False  # equal -> leave alone
    backend_ahead = backend_equal + [{"role": "user", "content": "c"}]
    assert atc.should_hydrate(backend_ahead, incoming) is False


def test_should_not_hydrate_with_empty_incoming():
    assert atc.should_hydrate([SYS], []) is False
    assert atc.should_hydrate(None, []) is False


# ---- hydrate_session_messages --------------------------------------------

def test_hydrate_preserves_system_prompt_and_seeds_thread():
    incoming = atc.normalize_thread_messages(_thread(("user", "a"), ("buddy", "b")))
    out = atc.hydrate_session_messages([SYS], incoming)
    assert out[0] == SYS                       # locked system prompt untouched
    assert out[1] == {"role": "user", "content": "a"}
    assert out[2] == {"role": "assistant", "content": "b"}
    assert len(out) == 3


def test_hydrate_without_system_prompt_just_seeds_thread():
    incoming = atc.normalize_thread_messages(_thread(("user", "a")))
    out = atc.hydrate_session_messages([], incoming)
    assert out == [{"role": "user", "content": "a"}]


def test_hydrate_does_not_append_live_user_turn():
    # The live question is added by the caller AFTER hydration; hydrate must not
    # invent or duplicate it.
    incoming = atc.normalize_thread_messages(_thread(("user", "a"), ("buddy", "b")))
    out = atc.hydrate_session_messages([SYS], incoming)
    assert out[-1] == {"role": "assistant", "content": "b"}


# ---- maybe_hydrate (integration convenience) ------------------------------

def test_maybe_hydrate_returns_new_list_when_behind():
    thread = _thread(("user", "a"), ("buddy", "b"))
    out = atc.maybe_hydrate([SYS], thread)
    assert out is not None
    assert out[0] == SYS
    assert [m["content"] for m in out[1:]] == ["a", "b"]


def test_maybe_hydrate_returns_none_when_current():
    thread = _thread(("user", "a"))
    backend = [SYS, {"role": "user", "content": "a"}]
    assert atc.maybe_hydrate(backend, thread) is None


def test_maybe_hydrate_returns_none_with_no_thread():
    assert atc.maybe_hydrate([SYS], None) is None
    assert atc.maybe_hydrate([SYS], []) is None
