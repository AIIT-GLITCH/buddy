"""Combined spine context + memory receipt block for Buddy prompt injection.

Wraps spine_context_loader (recall) + memory_receipt (landing confirmation).
Returns a single bounded text block, or empty string, suitable for prepending
as a system message in the chat handler before model.generate.

This module is SAFE TO IMPORT but does not auto-inject anywhere. The integration
point in buddy_api.py is an explicit call by the operator.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Optional

LAB_ROOT = Path("/home/buddy_ai/Desktop/RECALL_LAB_14TIER")


def _bool_env(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().casefold() in {"1", "true", "yes", "on"}


def _ensure_lab_on_path() -> None:
    lab = str(LAB_ROOT)
    if lab not in sys.path:
        sys.path.insert(0, lab)


def build_spine_recall_block(
    *,
    session_id: str,
    query: Optional[str] = None,
    is_public: bool = False,
    max_records: Optional[int] = None,
    max_chars: Optional[int] = None,
) -> str:
    """Build the combined recall block.

    Returns:
        A string containing [14-TIER SPINE CONTEXT] + [MEMORY RECEIPT] blocks,
        joined by a blank line, or "" if nothing to surface.

    Reads only. Never writes spine. Receipt pull marks delivered (one-shot).
    """
    enabled = _bool_env("BUDDY_SPINE_RECALL_ENABLED", True)
    if not enabled:
        return ""

    _ensure_lab_on_path()
    try:
        from spine_context_loader import load_spine_context
        from memory_receipt import pull_undelivered_receipts, format_receipts_block
    except Exception:
        return ""

    parts: list[str] = []

    # Receipts FIRST (so Buddy knows what just landed, then sees broader context)
    try:
        receipts = pull_undelivered_receipts(session_id=session_id)
        if receipts:
            receipts_block = format_receipts_block(receipts, is_public=is_public)
            if receipts_block:
                parts.append(receipts_block)
    except Exception:
        pass

    # Bounded spine + candidate recall
    try:
        ctx = load_spine_context(
            query=query,
            session_id=session_id,
            is_public=is_public,
            max_records=max_records,
            max_chars=max_chars,
        )
        if ctx:
            parts.append(ctx)
    except Exception:
        pass

    if not parts:
        return ""
    return "\n\n".join(parts)


def detect_response_mode(user_text: str) -> str:
    """Detect response budget mode from user query content.

    Returns one of: 'normal' | 'deep' | 'memory' | 'longform'.
    """
    text = (user_text or "").casefold()
    if any(p in text for p in (
        "full report", "complete explanation", "give me everything",
        "in full detail", "write a long", "longform",
    )):
        return "longform"
    if any(p in text for p in (
        "kokoro", "kokuro", "14-tier", "14 tier", "spine", "memory candidate",
        "remember this", "doctrine", "architecture of your memory", "your memory",
    )):
        return "memory"
    if any(p in text for p in (
        "explain", "teach", "summarize", "walk me through", "tell me more",
        "deep dive", "go deeper", "elaborate",
    )):
        return "deep"
    return "normal"


def max_chars_for_mode(mode: str) -> int:
    """Return char budget for a mode, respecting env overrides."""
    defaults = {
        "normal":   2500,
        "deep":     6000,
        "memory":   8000,
        "longform": 10000,
    }
    env_keys = {
        "normal":   "BUDDY_CHAT_MAX_CHARS_NORMAL",
        "deep":     "BUDDY_CHAT_MAX_CHARS_DEEP",
        "memory":   "BUDDY_CHAT_MAX_CHARS_MEMORY",
        "longform": "BUDDY_CHAT_MAX_CHARS_LONGFORM",
    }
    raw = os.environ.get(env_keys.get(mode, ""))
    if raw:
        try:
            return max(200, min(int(raw), 10000))
        except ValueError:
            pass
    return defaults.get(mode, 2500)


def max_tokens_for_mode(mode: str, char_to_token: float = 3.5) -> int:
    """Approximate token budget from char budget (avg ~3.5 chars/token for English)."""
    return max(64, int(max_chars_for_mode(mode) / char_to_token))


if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--session", required=True)
    p.add_argument("--query", default=None)
    p.add_argument("--public", action="store_true")
    args = p.parse_args()
    print(build_spine_recall_block(session_id=args.session, query=args.query, is_public=args.public))
