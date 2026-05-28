"""Account-thread context hydration for Buddy's web /ask path.

WHY THIS EXISTS
---------------
A logged-in account's *authoritative* persistent chat lives in Cloudflare
AUTH_KV (the website chat box) and is sent to the backend on every turn as
``extras.thread_messages``. The backend keeps its own per-``session_id``
working copy in ``buddy_store``, and that copy can fall BEHIND the website
thread whenever:

  * the ``session_epoch`` changes (a thread "clear" mints a new session_id),
  * the durable session row is missing / evicted,
  * the request lands on a backend instance that never saw this session.

In every one of those cases Buddy "forgets" a conversation the user can still
see on screen. Today the backend simply ignores ``extras.thread_messages``.

This module lets the /ask handler REHYDRATE the backend session from the
surface-provided thread *only when the backend copy is behind*, so the chat box
the user sees is what Buddy actually reasons from.

SCOPE / SAFETY
--------------
* Logged-in account threads only. Never touches anonymous public sessions
  (caller gates on ``extras.account_thread``).
* Read-only with respect to kokoro / spine / identity. Writes nothing to disk.
* Pure, dependency-free (stdlib typing only) -> trivially unit-testable.
* Never SHRINKS or overwrites a backend session that is already current or
  ahead; it only fills a gap.
* Aligns with the data policy: a user's own account thread is content the user
  themselves gave Buddy. No spine, no cross-user data, no public exposure.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

_VALID_ROLES = {"user", "assistant"}

# Defaults chosen to match the surface (compactThreadMessages sends last 24)
# and to stay comfortably inside the web context budget.
DEFAULT_MAX_TURNS = 24
DEFAULT_MAX_CHARS = 1000


def _norm_role(role: Any) -> str:
    """Collapse a surface role onto the model's role vocabulary.

    The website stores Buddy's turns as role 'buddy'; the model speaks
    'assistant'. Everything else (including missing) is treated as 'user'.
    """
    r = str(role or "").strip().lower()
    if r in ("buddy", "assistant"):
        return "assistant"
    return "user"


def normalize_thread_messages(
    thread_messages: Any,
    *,
    max_turns: int = DEFAULT_MAX_TURNS,
    max_chars: int = DEFAULT_MAX_CHARS,
) -> List[Dict[str, str]]:
    """Coerce surface ``thread_messages`` into clean ``{role, content}`` dicts.

    - accepts either ``text`` (surface shape) or ``content`` keys
    - roles collapse to user/assistant ('buddy' -> 'assistant')
    - empty / whitespace-only entries are dropped
    - each content is bounded to ``max_chars``
    - keeps only the last ``max_turns`` entries
    Returns [] for anything malformed (never raises).
    """
    if not isinstance(thread_messages, list):
        return []
    out: List[Dict[str, str]] = []
    for m in thread_messages:
        if not isinstance(m, dict):
            continue
        text = str(m.get("text") or m.get("content") or "").strip()
        if not text:
            continue
        out.append({"role": _norm_role(m.get("role")), "content": text[:max_chars]})
    if max_turns >= 0:
        out = out[-max_turns:]
    return out


def _real_turns(messages: Optional[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    """Non-empty user/assistant turns (i.e. exclude the system prompt)."""
    if not messages:
        return []
    return [
        m for m in messages
        if isinstance(m, dict)
        and m.get("role") in _VALID_ROLES
        and str(m.get("content", "")).strip()
    ]


def should_hydrate(
    session_messages: Optional[List[Dict[str, Any]]],
    incoming_thread: List[Dict[str, str]],
) -> bool:
    """True only when the backend session is BEHIND the surface thread.

    If the backend already holds at least as many real turns as the surface
    sent, the backend copy is current (or ahead) and is left untouched.
    """
    if not incoming_thread:
        return False
    return len(_real_turns(session_messages)) < len(incoming_thread)


def hydrate_session_messages(
    session_messages: Optional[List[Dict[str, Any]]],
    incoming_thread: List[Dict[str, str]],
) -> List[Dict[str, Any]]:
    """Rebuild a session message list seeded from the surface thread.

    Preserves the canonical system message at index 0 if present (so the locked
    system prompt is never disturbed). Does NOT append the live user turn --
    the caller adds that afterward exactly as it does today.

    Callers should only apply the result when ``should_hydrate`` is True.
    """
    system_msg: Optional[Dict[str, Any]] = None
    if (
        session_messages
        and isinstance(session_messages[0], dict)
        and session_messages[0].get("role") == "system"
    ):
        system_msg = session_messages[0]

    rebuilt: List[Dict[str, Any]] = []
    if system_msg is not None:
        rebuilt.append(system_msg)
    rebuilt.extend({"role": m["role"], "content": m["content"]} for m in incoming_thread)
    return rebuilt


def maybe_hydrate(
    session_messages: Optional[List[Dict[str, Any]]],
    thread_messages: Any,
    *,
    max_turns: int = DEFAULT_MAX_TURNS,
    max_chars: int = DEFAULT_MAX_CHARS,
) -> Optional[List[Dict[str, Any]]]:
    """One-shot convenience: normalize + decide + rebuild.

    Returns a new messages list to assign to ``session.messages`` when
    hydration is warranted, or ``None`` to signal "leave the session as-is".
    """
    incoming = normalize_thread_messages(
        thread_messages, max_turns=max_turns, max_chars=max_chars
    )
    if not should_hydrate(session_messages, incoming):
        return None
    return hydrate_session_messages(session_messages, incoming)
