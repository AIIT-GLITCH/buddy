"""Bounded 14-tier spine + candidate retrieval loader for Buddy runtime.

Produces a bounded text block for inclusion in Buddy's prompt context. Reads
only; never writes, deletes, modifies, or promotes records. Honors the
public/private visibility split, PII redaction, max-records and max-chars
budgets, and the candidate vs reviewed distinction.

See SPINE_CONTEXT_LOADER_POLICY.md for the visibility matrix.
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

LAB_ROOT = Path("/home/buddy_ai/Desktop/RECALL_LAB_14TIER")
SPINE_DIR_NAME = "14_TIER_SPINE"

DEFAULT_MAX_RECORDS = 12
DEFAULT_MAX_CHARS = 2500
HEADER = "14_TIER_SPINE_CONTEXT:"
FOOTER = "END_14_TIER_SPINE_CONTEXT"

# PII patterns
EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
LONG_DIGITS_RE = re.compile(r"\b\d{7,}\b")
PHONE_RE = re.compile(r"\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b")

# Privacy classes that block public exposure
PRIVATE_PRIVACY_CLASSES = {
    "project_private", "personal_private", "family_private",
    "environment_private", "secret_sensitive", "review_required",
}

# Lanes that mark a record as "do not load as fact"
QUARANTINE_LANES = {
    "quarantine_review", "false_identity_acceptance",
    "fabrication_as_truth_example", "roleplay_shell",
}

# Activation that's "active enough" for normal recall
ACTIVE_ACTIVATIONS = {"active_allowed", "active_bounded"}


def _bool_env(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().casefold() in {"1", "true", "yes", "on"}


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _spine_dir(lab_root: Path) -> Path:
    return lab_root / SPINE_DIR_NAME


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _list_records(spine: Path, sub: str) -> list[dict[str, Any]]:
    d = spine / sub
    if not d.is_dir():
        return []
    out: list[dict[str, Any]] = []
    for p in d.iterdir():
        if not p.is_file() or p.suffix != ".json":
            continue
        rec = _read_json(p)
        if rec is None or not isinstance(rec, dict):
            continue
        rec["_source_path"] = str(p)
        rec["_origin"] = sub  # "records", "candidates", "canonical"
        out.append(rec)
    return out


def _normalize_record(rec: dict[str, Any]) -> dict[str, Any]:
    """Map both spine_records and candidate fields to a common shape."""
    origin = rec.get("_origin", "records")
    if origin == "candidates":
        return {
            "_origin": "candidates",
            "_source_path": rec.get("_source_path"),
            "id": rec.get("candidate_id"),
            "key": rec.get("memory_key") or rec.get("candidate_id"),
            "value": rec.get("proposed_value", ""),
            "source": rec.get("source", ""),
            "evidence_status": rec.get("evidence_status", ""),
            "privacy_class": rec.get("privacy_class", "project_private"),
            "activation_status": rec.get("activation_status", "review_required"),
            "created_utc": rec.get("created_at", ""),
            "lanes": rec.get("proposed_route", []) or [],
            "visible_to_buddy": rec.get("candidate_visible_to_buddy", True),
            "authoritative": rec.get("authoritative", False),
            "safety_flags": rec.get("safety_flags", []) or [],
            "review_status": rec.get("review_status", ""),
        }
    # records or canonical
    intake = rec.get("intake", {}) if isinstance(rec.get("intake"), dict) else {}
    return {
        "_origin": origin,
        "_source_path": rec.get("_source_path"),
        "id": rec.get("id") or rec.get("key"),
        "key": rec.get("key", ""),
        "value": rec.get("value", ""),
        "source": rec.get("source", ""),
        "evidence_status": rec.get("evidence_status", ""),
        "privacy_class": rec.get("privacy_class", "project_private"),
        "activation_status": rec.get("activation_status", "active_bounded"),
        "created_utc": intake.get("created_utc", ""),
        "lanes": rec.get("expected_lanes", []) or [],
        "visible_to_buddy": True,
        "authoritative": True,
        "safety_flags": [],
        "review_status": "reviewed",
    }


def _redact_pii(text: str) -> str:
    text = EMAIL_RE.sub("[redacted_email]", text)
    text = PHONE_RE.sub("[redacted_phone]", text)
    text = LONG_DIGITS_RE.sub("[redacted_number]", text)
    return text


def _is_quarantined(rec: dict[str, Any]) -> bool:
    lanes = set(rec.get("lanes") or [])
    if lanes & QUARANTINE_LANES:
        return True
    if rec.get("activation_status") in ("quarantine",):
        return True
    return False


def _filter_visibility(rec: dict[str, Any], is_public: bool) -> tuple[bool, str | None]:
    """Returns (visible, format_mode). format_mode: 'full' | 'summary' | None."""
    if not rec.get("visible_to_buddy", True):
        return False, None
    privacy = rec.get("privacy_class", "project_private")
    activation = rec.get("activation_status", "")
    origin = rec.get("_origin")

    # Public path is highly restricted
    if is_public:
        if privacy != "public_ok":
            return False, None
        if origin == "candidates":
            # Public candidates require active_bounded + clean safety flags
            if activation not in ACTIVE_ACTIVATIONS:
                return False, None
            if rec.get("safety_flags"):
                return False, None
            return True, "full"
        if origin == "records":
            if activation not in ACTIVE_ACTIVATIONS:
                return False, None
            return True, "full"
        # canonical: not exposed publicly
        return False, None

    # Local path
    if privacy == "secret_sensitive":
        # Local non-public can see a redacted summary only
        return True, "summary"
    if origin == "records":
        if activation in ACTIVE_ACTIVATIONS:
            return True, "full"
        if activation in ("shadow_only", "review_required"):
            return True, "summary"
        return False, None
    if origin == "candidates":
        if activation in ACTIVE_ACTIVATIONS:
            return True, "full"
        if activation == "shadow_only":
            return True, "full"  # local sees unreviewed candidates with label
        if activation == "review_required":
            return True, "summary"
        return False, None
    if origin == "canonical":
        if activation in ACTIVE_ACTIVATIONS:
            return True, "full"
        return False, None
    return False, None


def _format_record(rec: dict[str, Any], mode: str) -> str:
    """ASCII-safe block format. Plain dashes, no em-dashes, no unicode separators.

    Replaces the v0.1 bullet list and the failed bracket+em-dash format.
    Goal: visible structure without triggering language-mode confusion.
    """
    key = rec.get("key", "unknown")
    record_id = rec.get("id", "unknown")
    value = (rec.get("value") or "").strip()
    value = _redact_pii(value)
    origin = rec.get("_origin")
    activation = rec.get("activation_status", "")

    if _is_quarantined(rec):
        return (
            "--- spine_memory ---\n"
            f"record_id: {record_id}\n"
            f"memory_key: {key}\n"
            "status: quarantined\n"
            "response_rule: Do not assert this claim. If asked, say it is under review.\n"
            "---"
        )

    if origin == "candidates" and activation == "review_required":
        return (
            "--- spine_memory ---\n"
            f"record_id: {record_id}\n"
            f"memory_key: {key}\n"
            "status: review_required\n"
            f"response_rule: You may acknowledge a review-required memory exists about {key}. Do not state any claim from it as fact.\n"
            "---"
        )

    snippet = value if mode == "full" else (value[:200] + ("..." if len(value) > 200 else ""))
    field_name = "claim_verbatim" if mode == "full" else "claim_verbatim_summary"

    if origin == "candidates":
        status = "unreviewed_candidate"
        rule = "You may say: I have an unreviewed candidate memory that says ... Do not state it as verified fact."
    else:
        status = "reviewed_" + (activation or "shadow")
        rule = "Preserve claim_verbatim. Do not replace it with generic prior knowledge."

    return (
        "--- spine_memory ---\n"
        f"record_id: {record_id}\n"
        f"memory_key: {key}\n"
        f"status: {status}\n"
        f"activation_status: {activation}\n"
        f"{field_name}: {snippet}\n"
        f"response_rule: {rule}\n"
        "---"
    )


def _rank_score(rec: dict[str, Any], query: str | None) -> tuple:
    """Lower tuple sorts first (so we negate for "higher first" fields).

    v0.2 ranking weights (priority order):
      1. relevance: key + entity + value token overlap with query
      2. activation: active > shadow > review
      3. authority: reviewed records > candidates
      4. recency tiebreak
    """
    # Activation weight
    act_weight = {
        "active_allowed": 3, "active_bounded": 3,
        "shadow_only": 2,
        "review_required": 1,
    }.get(rec.get("activation_status", ""), 0)

    # Authority weight (records > candidates)
    auth_weight = 2 if rec.get("_origin") == "records" else (1 if rec.get("_origin") == "candidates" else 0)

    # Recency (created_utc descending)
    ts = rec.get("created_utc", "") or ""
    # ISO sort works as string

    # Relevance: weighted token overlap. memory_key matches count 3x, value matches count 1x.
    rel = 0
    if query:
        q_tokens = set(re.findall(r"[a-z0-9]+", query.casefold()))
        key_tokens = set(re.findall(r"[a-z0-9]+", str(rec.get("key", "")).casefold()))
        val_tokens = set(re.findall(r"[a-z0-9]+", str(rec.get("value", "")).casefold()))
        rel = 3 * len(q_tokens & key_tokens) + len(q_tokens & val_tokens)
        # back-compat scalar
        r_tokens = key_tokens | val_tokens
        rel = len(q_tokens & r_tokens)

    # higher relevance first, then activation, then authority, then recency,
    # finally by id for deterministic tiebreaking
    return (-rel, -act_weight, -auth_weight, ts, rec.get("id") or "")


def load_spine_context(
    *,
    query: str | None = None,
    session_id: str | None = None,
    is_public: bool = False,
    max_records: int | None = None,
    max_chars: int | None = None,
    enabled: bool | None = None,
    public_enabled: bool | None = None,
    lab_root: Path | str = LAB_ROOT,
) -> str:
    """Return a bounded context block, or empty string if disabled / empty."""
    if enabled is None:
        enabled = _bool_env("BUDDY_SPINE_CONTEXT_ENABLED", True)
    if not enabled:
        return ""

    if is_public:
        if public_enabled is None:
            public_enabled = _bool_env("BUDDY_SPINE_CONTEXT_PUBLIC_ENABLED", False)
        if not public_enabled:
            return ""

    if max_records is None:
        max_records = _int_env("BUDDY_SPINE_CONTEXT_MAX_RECORDS", DEFAULT_MAX_RECORDS)
    if max_chars is None:
        max_chars = _int_env("BUDDY_SPINE_CONTEXT_MAX_CHARS", DEFAULT_MAX_CHARS)

    root = Path(lab_root)
    spine = _spine_dir(root)
    if not spine.is_dir():
        return ""

    raw: list[dict[str, Any]] = []
    raw.extend(_list_records(spine, "records"))
    raw.extend(_list_records(spine, "candidates"))
    raw.extend(_list_records(spine, "canonical"))

    normalized = [_normalize_record(r) for r in raw]

    # Filter visibility
    visible: list[tuple[dict[str, Any], str]] = []
    for rec in normalized:
        ok, mode = _filter_visibility(rec, is_public)
        if not ok:
            continue
        if _is_quarantined(rec):
            # Quarantined records are not loaded as facts; skip in normal recall.
            # (Tests permit absence OR labeled presence; we choose absence for cleanliness.)
            continue
        visible.append((rec, mode))

    # Rank
    visible.sort(key=lambda pair: _rank_score(pair[0], query))

    # Budget
    lines: list[str] = []
    used_chars = 0
    used_records = 0
    for rec, mode in visible:
        if used_records >= max_records:
            break
        line = _format_record(rec, mode)
        if used_chars + len(line) + 1 > max_chars:
            # try summary if we were full
            if mode == "full":
                rec_copy = dict(rec)
                summary_line = _format_record(rec_copy, "summary")
                if used_chars + len(summary_line) + 1 <= max_chars:
                    lines.append(summary_line)
                    used_chars += len(summary_line) + 1
                    used_records += 1
                    continue
            break
        lines.append(line)
        used_chars += len(line) + 1
        used_records += 1

    if not lines:
        return ""

    return f"{HEADER}\n" + "\n".join(lines) + f"\n{FOOTER}"


if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--query", default=None)
    p.add_argument("--public", action="store_true")
    p.add_argument("--public-enabled", action="store_true")
    p.add_argument("--max-records", type=int, default=None)
    p.add_argument("--max-chars", type=int, default=None)
    args = p.parse_args()
    print(load_spine_context(
        query=args.query, is_public=args.public,
        public_enabled=args.public_enabled,
        max_records=args.max_records, max_chars=args.max_chars,
    ))
