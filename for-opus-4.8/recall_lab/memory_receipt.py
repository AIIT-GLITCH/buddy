"""Per-session memory landing receipts.

When a Buddy chat-output memory intent successfully creates a candidate (or is
rejected as garbled), a receipt is written here. On the next prompt assembly,
the loader pulls undelivered receipts and includes them in a small bounded
block so Buddy can honestly say "my memory candidate landed in the review queue."

Distinct from anomaly heartbeats — receipt confirms landing only, never truth.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

LAB_ROOT = Path("/home/buddy_ai/Desktop/RECALL_LAB_14TIER")
SPINE_DIR_NAME = "14_TIER_SPINE"
RECEIPTS_SUBDIR = "memory_receipts"

HEADER = "[MEMORY RECEIPT]"
FOOTER = "[/MEMORY RECEIPT]"


def _utcnow() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _safe_session_filename(session_id: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_:.-]+", "_", session_id or "unknown").strip("_")
    return (cleaned[:80] or "unknown_session") + ".jsonl"


def _receipts_dir(lab_root: Path) -> Path:
    return Path(lab_root) / SPINE_DIR_NAME / RECEIPTS_SUBDIR


def _receipts_path(lab_root: Path, session_id: str) -> Path:
    return _receipts_dir(lab_root) / _safe_session_filename(session_id)


def _append_jsonl(path: Path, row: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except Exception:
                continue
    return rows


def _rewrite_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    tmp = path.with_suffix(".jsonl.tmp")
    with tmp.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n")
    tmp.replace(path)


def write_landing_receipt(
    *,
    session_id: str,
    candidate_id: str,
    memory_key: str,
    activation_status: str,
    review_required: bool,
    short_claim_summary: str,
    lab_root: Path | str = LAB_ROOT,
) -> dict[str, Any]:
    """Append a landing receipt for a successful candidate write."""
    path = _receipts_path(Path(lab_root), session_id)
    receipt = {
        "ts": _utcnow(),
        "candidate_id": candidate_id,
        "memory_key": memory_key,
        "status": "landed_in_review_queue",
        "activation_status": activation_status,
        "authoritative": False,
        "candidate_visible_to_buddy": True,
        "review_required": bool(review_required),
        "short_claim_summary": (short_claim_summary or "")[:200],
        "response_phrase": (
            "I have an unreviewed candidate memory that landed in the review queue."
        ),
        "delivered": False,
        "delivered_at": None,
    }
    _append_jsonl(path, receipt)
    return receipt


def write_rejection_receipt(
    *,
    session_id: str,
    reason: str,
    raw_excerpt: str,
    lab_root: Path | str = LAB_ROOT,
) -> dict[str, Any]:
    """Append a rejection receipt when a memory intent could not be saved cleanly."""
    path = _receipts_path(Path(lab_root), session_id)
    receipt = {
        "ts": _utcnow(),
        "candidate_id": None,
        "memory_key": None,
        "status": "rejected_garbled" if "garbled" in (reason or "") else "rejected",
        "reason": reason,
        "raw_excerpt": (raw_excerpt or "")[:240],
        "activation_status": "not_saved",
        "authoritative": False,
        "candidate_visible_to_buddy": False,
        "review_required": False,
        "short_claim_summary": "",
        "response_phrase": (
            "My memory attempt was not saved because the text was garbled or rejected."
        ),
        "delivered": False,
        "delivered_at": None,
    }
    _append_jsonl(path, receipt)
    return receipt


def pull_undelivered_receipts(
    *,
    session_id: str,
    lab_root: Path | str = LAB_ROOT,
) -> list[dict[str, Any]]:
    """Return the list of undelivered receipts, then mark them delivered on disk.

    Caller is responsible for actually including them in the next prompt.
    """
    path = _receipts_path(Path(lab_root), session_id)
    rows = _read_jsonl(path)
    if not rows:
        return []
    undelivered = [r for r in rows if not r.get("delivered")]
    if not undelivered:
        return []
    now = _utcnow()
    for r in rows:
        if not r.get("delivered"):
            r["delivered"] = True
            r["delivered_at"] = now
    _rewrite_jsonl(path, rows)
    return undelivered


def format_receipts_block(
    receipts: list[dict[str, Any]],
    *,
    is_public: bool = False,
) -> str:
    if not receipts:
        return ""
    lines: list[str] = [HEADER]
    for r in receipts:
        status = r.get("status", "")
        cid = r.get("candidate_id") or "(no candidate id)"
        key = r.get("memory_key") or "(no key)"
        summary = (r.get("short_claim_summary") or "").strip()
        review_required = bool(r.get("review_required"))

        if status.startswith("rejected"):
            reason = r.get("reason", "unknown")
            lines.append(
                f"Your last memory attempt was NOT saved (reason: {reason}). "
                f"It did not land in the review queue."
            )
            continue

        if is_public and review_required:
            # Generic only — never expose the claim publicly
            lines.append(
                f"Your memory candidate landed in the review queue ({cid}). "
                f"It is pending human review. Do not state it as fact."
            )
            continue

        lines.append(
            f"Your memory candidate landed in the review queue."
        )
        lines.append(f"candidate_id: {cid}")
        lines.append(f"memory_key: {key}")
        lines.append(f"status: unreviewed (do not state as verified fact)")
        if summary:
            lines.append(f"summary: {summary}")
        lines.append(
            "You may recall it as: \"I have an unreviewed candidate memory that says ...\""
        )
    lines.append(FOOTER)
    return "\n".join(lines)


if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--session", required=True)
    p.add_argument("--public", action="store_true")
    args = p.parse_args()
    pulled = pull_undelivered_receipts(session_id=args.session)
    print(format_receipts_block(pulled, is_public=args.public))
