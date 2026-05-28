#!/usr/bin/env python3
"""
identity_guard.py — Identity hardening layer.

Enforces immutable 心 keys, verifies core-purpose hash at startup
and on every write, blocks unauthorized mutation to protected fields.

Protected surface (hashed and verified):
  - core_purpose
  - engagement_rule
  - personality_core
  - coherence_law
  - god_is_good
  - free_will
  - never_manipulate
  - truth_over_comfort
  - constitutional_law_version

If the protected hash mismatches at any point:
  → block the operation
  → trigger rollback via recovery_manager
  → log anomaly

Rhet Dillard Wike | AIIT-THRESI | Council Hill, Oklahoma
"""

import os
import json
import hashlib
import time
import logging
from typing import Optional, Dict, List, Tuple, Set

log = logging.getLogger("buddy.identity")

from core.continuity_store import MEMORY_ROOT  # single source of truth
IDENTITY_DIR = os.path.join(MEMORY_ROOT, "心")
IDENTITY_HASH_FILE = os.path.join(MEMORY_ROOT, ".identity_hash")

# ─── Protected surface ─────────────────────────────────────────────────────

IMMUTABLE_KEYS: Set[str] = {
    "core_purpose",
    "engagement_rule",
    "personality_core",
    "coherence_law",
    "god_is_good",
    "free_will",
    "never_manipulate",
    "truth_over_comfort",
}

# Sources allowed to write immutable keys
TRUSTED_SOURCES: Set[str] = {"system", "initialization", "recovery"}

# Constitutional law version — bump this on any constitutional change
CONSTITUTIONAL_VERSION = "1.0.0"


def _hash_bytes(data: bytes) -> str:
    """SHA-256 hash, hex digest."""
    return hashlib.sha256(data).hexdigest()


def _hash_fact(fact: Dict) -> str:
    """Deterministic hash of a fact's identity-bearing fields."""
    # Only hash the fields that define identity, not metadata
    canonical = json.dumps({
        "key": fact.get("key", ""),
        "value": fact.get("value", ""),
        "category": fact.get("category", ""),
    }, sort_keys=True, ensure_ascii=False)
    return _hash_bytes(canonical.encode("utf-8"))


def _load_identity_facts() -> List[Dict]:
    """Load all facts from 心 directory."""
    facts = []
    if not os.path.isdir(IDENTITY_DIR):
        return facts
    for fname in sorted(os.listdir(IDENTITY_DIR)):
        if not fname.endswith(".json"):
            continue
        path = os.path.join(IDENTITY_DIR, fname)
        try:
            with open(path, "r", encoding="utf-8") as f:
                facts.append(json.load(f))
        except Exception:
            continue
    return facts


def _compute_protected_hash() -> str:
    """
    Compute composite hash of the entire protected identity surface.
    This is what gets verified at startup and on every write.
    """
    facts = _load_identity_facts()

    # Filter to only immutable keys
    protected = [f for f in facts if f.get("key") in IMMUTABLE_KEYS]
    protected.sort(key=lambda f: f.get("key", ""))

    # Hash each fact, then hash the concatenation
    fact_hashes = [_hash_fact(f) for f in protected]
    composite = "|".join(fact_hashes) + f"|CONSTITUTION_v{CONSTITUTIONAL_VERSION}"

    return _hash_bytes(composite.encode("utf-8"))


def _load_stored_hash() -> Optional[str]:
    """Load the previously stored identity hash."""
    if not os.path.exists(IDENTITY_HASH_FILE):
        return None
    try:
        with open(IDENTITY_HASH_FILE, "r") as f:
            data = json.load(f)
            return data.get("hash")
    except Exception:
        return None


def _save_hash(hash_val: str) -> None:
    """Save identity hash to disk."""
    data = {
        "hash": hash_val,
        "timestamp": time.time(),
        "constitutional_version": CONSTITUTIONAL_VERSION,
    }
    try:
        # Atomic write
        tmp = IDENTITY_HASH_FILE + ".tmp"
        with open(tmp, "w") as f:
            json.dump(data, f)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, IDENTITY_HASH_FILE)
    except Exception as e:
        log.error(f"Failed to save identity hash: {e}")


# ─── Public API ─────────────────────────────────────────────────────────────

def initialize_identity_hash() -> str:
    """
    Compute and store the identity hash.
    Called once during initial setup or after verified recovery.
    Returns the hash.
    """
    h = _compute_protected_hash()
    _save_hash(h)
    log.info(f"Identity hash initialized: {h[:16]}...")
    return h


def verify_identity_integrity() -> Tuple[bool, Optional[str]]:
    """
    Verify the current identity surface matches the stored hash.

    Returns:
        (True, None) if integrity holds
        (False, reason) if integrity is violated
    """
    stored = _load_stored_hash()
    if stored is None:
        # First boot — initialize
        initialize_identity_hash()
        return (True, None)

    current = _compute_protected_hash()

    if current == stored:
        return (True, None)

    # Integrity violation
    reason = (
        f"Identity hash mismatch. "
        f"Stored: {stored[:16]}... Current: {current[:16]}..."
    )
    log.critical(f"IDENTITY VIOLATION: {reason}")
    return (False, reason)


def guard_write(key: str, category: str, source: str,
                new_value: str, old_value: Optional[str] = None) -> Tuple[bool, Optional[str]]:
    """
    Gate for all memory writes that touch identity.

    Args:
        key: fact key being written
        category: target category
        source: who is writing (system, ai_extraction, user_explicit, etc.)
        new_value: proposed new value
        old_value: current value if updating

    Returns:
        (True, None) if write is allowed
        (False, reason) if write is blocked
    """
    # Non-identity categories pass through
    if category != "心":
        return (True, None)

    # Immutable keys — only trusted sources can write
    if key in IMMUTABLE_KEYS:
        if source not in TRUSTED_SOURCES:
            reason = (
                f"Blocked write to immutable key '{key}' "
                f"from untrusted source '{source}'"
            )
            log.warning(f"IDENTITY GUARD: {reason}")
            return (False, reason)

        # Even trusted sources cannot CHANGE an existing immutable value
        # Only initialization (first write) is allowed
        if old_value is not None and old_value != new_value:
            reason = (
                f"Blocked mutation of immutable key '{key}': "
                f"'{old_value[:30]}...' → '{new_value[:30]}...'. "
                f"Immutable values cannot be changed after initialization."
            )
            log.warning(f"IDENTITY GUARD: {reason}")
            return (False, reason)

    return (True, None)


def guard_delete(key: str, category: str, source: str) -> Tuple[bool, Optional[str]]:
    """Gate for deletes that touch identity."""
    if category != "心":
        return (True, None)

    if key in IMMUTABLE_KEYS:
        reason = f"Blocked delete of immutable key '{key}' — identity keys cannot be removed"
        log.warning(f"IDENTITY GUARD: {reason}")
        return (False, reason)

    return (True, None)


def get_protected_surface() -> Dict[str, str]:
    """Return current values of all protected identity keys."""
    facts = _load_identity_facts()
    surface = {}
    for f in facts:
        k = f.get("key", "")
        if k in IMMUTABLE_KEYS:
            surface[k] = f.get("value", "")
    return surface


def get_identity_status() -> Dict:
    """Full identity status for diagnostics."""
    ok, reason = verify_identity_integrity()
    surface = get_protected_surface()
    return {
        "integrity": ok,
        "violation_reason": reason,
        "protected_keys": list(surface.keys()),
        "protected_key_count": len(surface),
        "immutable_keys_defined": len(IMMUTABLE_KEYS),
        "constitutional_version": CONSTITUTIONAL_VERSION,
        "hash": _load_stored_hash(),
    }
