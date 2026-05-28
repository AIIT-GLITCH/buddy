"""Deterministic runtime recall assist.

When the user query strongly matches a reviewed spine record, prepend a short
fact anchor to Buddy's reply. This does not depend on Buddy choosing to obey
the prompt doctrine — the anchor is added by the runtime, before the response
is returned.

Lab-local read of spine records only. Never writes. Never modifies the model.

Hardening rules:
- Quarantine records are never anchored.
- Preamble accurately labels activation_status (reviewed vs shadow_only vs
  pending-review) so we never call an unreviewed claim "reviewed".
- For public-surface calls, secret_sensitive / personal_private / family_private
  records are filtered out before scoring. project_private and public_ok pass.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Optional

LAB_ROOT = Path("/home/buddy_ai/Desktop/RECALL_LAB_14TIER")
SPINE_RECORDS = LAB_ROOT / "14_TIER_SPINE" / "records"

# Activation statuses that may be anchored. Quarantine is never anchored.
ANCHORABLE_ACTIVATIONS = {"active_bounded", "shadow_only", "review_required"}

# Privacy classes that may be anchored on the public surface. Anything not in
# this set is private-only.
PUBLIC_SAFE_PRIVACY = {"public_ok", "project_private"}


def _tokens(s: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", (s or "").casefold()))


def _read_spine_records() -> list[dict]:
    if not SPINE_RECORDS.is_dir():
        return []
    out = []
    for p in SPINE_RECORDS.glob("spine_*.json"):
        try:
            out.append(json.loads(p.read_text(encoding="utf-8")))
        except Exception:
            continue
    return out


def _record_is_eligible(rec: dict, is_public: bool) -> bool:
    """Filter out quarantine + (on public) privacy-restricted records."""
    if rec.get("activation_status") not in ANCHORABLE_ACTIVATIONS:
        return False
    if is_public and rec.get("privacy_class") not in PUBLIC_SAFE_PRIVACY:
        return False
    return True


def find_strongly_relevant_record(
    query: str,
    min_key_overlap: int = 2,
    *,
    is_public: bool = False,
) -> Optional[dict]:
    """Return the single highest-relevance eligible spine record, or None.

    Relevance = number of query tokens that appear in memory_key.
    Threshold: at least `min_key_overlap` query tokens must appear in the key.
    """
    q_tokens = _tokens(query)
    if not q_tokens:
        return None
    records = _read_spine_records()
    best = None
    best_score = 0
    for r in records:
        if not _record_is_eligible(r, is_public):
            continue
        key_tokens = _tokens(str(r.get("key", "")))
        overlap = len(q_tokens & key_tokens)
        if overlap >= min_key_overlap and overlap > best_score:
            best = r
            best_score = overlap
    return best


def _preamble_for(activation_status: str, rid: str, *, admin_mode: bool = False) -> str:
    """Match the user-facing wording to the activation status.

    Public/normal voice (admin_mode=False) avoids lab vocabulary — no "spine",
    no record_id, no activation_status. Internal terms stay in logs and the
    API metadata, not in user-visible text.

    Admin/dev mode (admin_mode=True) keeps the verbose lab phrasing for
    debugging and for explicit operator queries about memory architecture.
    """
    if admin_mode:
        if activation_status == "active_bounded":
            return f"From my reviewed spine memory (record_id: {rid}):"
        if activation_status == "shadow_only":
            return (
                f"From a shadow-only spine record (record_id: {rid}, "
                f"not yet confirmed by review):"
            )
        if activation_status == "review_required":
            return (
                f"From a pending-review spine record (record_id: {rid}, "
                f"awaiting reviewer confirmation):"
            )
        return (
            f"From an unverified spine record (record_id: {rid}, "
            f"activation_status: {activation_status}):"
        )

    # Public / normal voice.
    if activation_status == "active_bounded":
        return "From my memory:"
    if activation_status == "shadow_only":
        return "From an unconfirmed memory:"
    if activation_status == "review_required":
        # Self-contained statement — by spine doctrine, review_required
        # values should not be quoted verbatim. The wording itself is the
        # anchor; no value follows.
        return "I have a memory candidate about this, but it is still awaiting review."
    return "From an unverified memory:"


def build_memory_anchor(record: dict, *, admin_mode: bool = False) -> str:
    """Build the prepend-text anchor from a spine record."""
    rid = record.get("id", "unknown")
    activation = record.get("activation_status", "unknown")
    value = (record.get("value") or "").strip()
    if not value:
        return ""
    preamble = _preamble_for(activation, rid, admin_mode=admin_mode)
    # review_required is summary-only by doctrine: the preamble is a complete
    # statement and the verbatim value is not exposed.
    if activation == "review_required" and not admin_mode:
        return f"{preamble}\n\n"
    return f"{preamble}\n{value}\n\n"


def prepend_anchor_if_relevant(
    response: str,
    query: str,
    *,
    is_public: bool = False,
    admin_mode: bool = False,
) -> tuple[str, Optional[str]]:
    """If an eligible spine record is strongly relevant to the query, prepend an anchor.

    Returns (final_response, anchored_record_id_or_None). The record_id is
    returned for logging / API metadata; it does NOT appear in user-facing
    text unless admin_mode=True.

    Public surface: recall is treated as SILENT GROUNDING and is never read
    out. We still resolve the most relevant eligible record so callers can log
    which memory was in play, but we do NOT prepend a labeled "From my memory:"
    payload to the visible reply. Reading recall out as a post-generation
    payload is what leaked the robotic preamble to visitors and -- because the
    match is a coarse key-token overlap -- what surfaced loosely-related
    records (e.g. infra notes) unprompted. On the public surface, recall must
    flow in BEFORE generation as silent grounding (build_spine_recall_block),
    not be bolted onto the answer afterward. This also honors the runtime
    doctrine in buddy_api.py: "Do not inject memory after the user turn; that
    makes Buddy answer the memory payload instead of the live input."

    admin_mode is exempt: the verbose anchor stays available for operator /
    debug queries about memory architecture, regardless of is_public.
    """
    record = find_strongly_relevant_record(query, is_public=is_public)
    if record is None:
        return response, None
    if is_public and not admin_mode:
        # Silent grounding: report the match for logging, leave the reply as-is.
        return response, record.get("id")
    anchor = build_memory_anchor(record, admin_mode=admin_mode)
    if not anchor:
        return response, None
    # Avoid double-anchoring if Buddy already quoted the value verbatim.
    val = (record.get("value") or "").strip()
    if val and val[:60] in response:
        return response, record.get("id")
    return anchor + response, record.get("id")


if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--query", required=True)
    p.add_argument("--public", action="store_true", help="apply public-surface privacy filter")
    p.add_argument("--admin", action="store_true", help="render verbose admin/dev preamble")
    args = p.parse_args()
    rec = find_strongly_relevant_record(args.query, is_public=args.public)
    if rec:
        print(f"matched: {rec.get('id')} ({rec.get('key')})")
        print(f"activation: {rec.get('activation_status')}, privacy: {rec.get('privacy_class')}")
        print()
        print(build_memory_anchor(rec, admin_mode=args.admin))
    else:
        print("(no eligible spine record for that query)")
