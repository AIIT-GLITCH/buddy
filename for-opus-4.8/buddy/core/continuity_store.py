#!/usr/bin/env python3
"""
continuity_store.py — Atomic, versioned, crash-safe state persistence.

Guarantees:
  1. Never overwrite live JSON directly
  2. Write-ahead journal for every state change
  3. Atomic rename (temp → target)
  4. fsync on every write
  5. Versioned snapshots: current, last_good, pre_update, rolling daily
  6. Crash-safe commit — incomplete writes are detected and rolled back

Write pattern:
  1. write temp file
  2. fsync temp
  3. write journal entry
  4. atomic rename (os.replace)
  5. fsync directory
  6. mark commit complete in journal

Rhet Dillard Wike | AIIT-THRESI | Council Hill, Oklahoma
"""

import os
import json
import time
import shutil
import hashlib
import logging
from datetime import datetime
from typing import Optional, Dict, Any, List

log = logging.getLogger("buddy.continuity")

MEMORY_ROOT = os.path.expanduser("~/Buddy/memory/kokoro")
SNAPSHOT_DIR = os.path.join(MEMORY_ROOT, ".snapshots")
JOURNAL_FILE = os.path.join(MEMORY_ROOT, ".journal.jsonl")
CURRENT_MARKER = os.path.join(SNAPSHOT_DIR, "current")
LAST_GOOD_MARKER = os.path.join(SNAPSHOT_DIR, "last_good")
PRE_UPDATE_MARKER = os.path.join(SNAPSHOT_DIR, "pre_update")

MAX_DAILY_SNAPSHOTS = 14  # keep 2 weeks of daily snapshots
MAX_JOURNAL_ENTRIES = 500


def _ensure_dirs():
    os.makedirs(SNAPSHOT_DIR, exist_ok=True)
    os.makedirs(os.path.join(SNAPSHOT_DIR, "daily"), exist_ok=True)

_ensure_dirs()


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _fsync_dir(dirpath: str):
    """fsync a directory to ensure rename durability."""
    try:
        fd = os.open(dirpath, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    except OSError:
        pass  # some filesystems don't support dir fsync


def _snapshot_id() -> str:
    return datetime.utcnow().strftime("%Y%m%d_%H%M%S")


# ─── Journal ────────────────────────────────────────────────────────────────

class JournalEntry:
    """Write-ahead journal entry."""
    def __init__(self, operation: str, target: str, snapshot_id: str,
                 checksum: str = "", status: str = "pending"):
        self.operation = operation
        self.target = target
        self.snapshot_id = snapshot_id
        self.checksum = checksum
        self.status = status
        self.timestamp = time.time()

    def to_dict(self) -> dict:
        return {
            "op": self.operation,
            "target": self.target,
            "snapshot_id": self.snapshot_id,
            "checksum": self.checksum,
            "status": self.status,
            "ts": self.timestamp,
        }

    @staticmethod
    def from_dict(d: dict) -> "JournalEntry":
        e = JournalEntry(
            operation=d.get("op", ""),
            target=d.get("target", ""),
            snapshot_id=d.get("snapshot_id", ""),
            checksum=d.get("checksum", ""),
            status=d.get("status", "pending"),
        )
        e.timestamp = d.get("ts", 0)
        return e


def _append_journal(entry: JournalEntry):
    """Append a journal entry (write-ahead log)."""
    try:
        line = json.dumps(entry.to_dict(), ensure_ascii=False) + "\n"
        with open(JOURNAL_FILE, "a", encoding="utf-8") as f:
            f.write(line)
            f.flush()
            os.fsync(f.fileno())
    except Exception as e:
        log.error(f"Journal write failed: {e}")


def _read_journal() -> List[JournalEntry]:
    """Read all journal entries."""
    entries = []
    if not os.path.exists(JOURNAL_FILE):
        return entries
    try:
        with open(JOURNAL_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    entries.append(JournalEntry.from_dict(json.loads(line)))
    except Exception as e:
        log.error(f"Journal read failed: {e}")
    return entries


def _compact_journal():
    """Keep only recent journal entries."""
    entries = _read_journal()
    if len(entries) <= MAX_JOURNAL_ENTRIES:
        return
    recent = entries[-MAX_JOURNAL_ENTRIES:]
    try:
        tmp = JOURNAL_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            for e in recent:
                f.write(json.dumps(e.to_dict(), ensure_ascii=False) + "\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, JOURNAL_FILE)
    except Exception as e:
        log.error(f"Journal compaction failed: {e}")


def get_pending_writes() -> List[JournalEntry]:
    """Find journal entries that were started but not committed."""
    entries = _read_journal()
    return [e for e in entries if e.status == "pending"]


def abort_pending_writes() -> int:
    """
    Mark all pending journal entries as 'aborted'.
    Called by recovery_manager at boot when a crash is detected.
    Returns count of entries aborted.
    """
    entries = _read_journal()
    aborted = 0
    updated = []
    for e in entries:
        if e.status == "pending":
            e.status = "aborted"
            aborted += 1
        updated.append(e)
    if aborted > 0:
        # Rewrite journal with aborted status
        try:
            tmp = JOURNAL_FILE + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                for e in updated:
                    f.write(json.dumps(e.to_dict(), ensure_ascii=False) + "\n")
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, JOURNAL_FILE)
        except Exception as err:
            log.error(f"abort_pending_writes failed: {err}")
    return aborted


# ─── Atomic File Write ──────────────────────────────────────────────────────

def atomic_write(target_path: str, data: bytes, journal_op: str = "write") -> bool:
    """
    Crash-safe atomic write.

    1. write temp file
    2. fsync temp
    3. write journal entry (pending)
    4. atomic rename
    5. fsync directory
    6. mark journal entry committed
    """
    sid = _snapshot_id()
    checksum = _sha256(data)
    parent_dir = os.path.dirname(target_path)
    os.makedirs(parent_dir, exist_ok=True)
    tmp_path = target_path + f".tmp.{sid}"

    # 1-2. Write and fsync temp file
    try:
        with open(tmp_path, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
    except Exception as e:
        log.error(f"Atomic write failed (temp): {e}")
        _cleanup_tmp(tmp_path)
        return False

    # 3. Journal entry (pending)
    entry = JournalEntry(
        operation=journal_op,
        target=target_path,
        snapshot_id=sid,
        checksum=checksum,
        status="pending",
    )
    _append_journal(entry)

    # 4. Atomic rename
    try:
        os.replace(tmp_path, target_path)
    except Exception as e:
        log.error(f"Atomic write failed (rename): {e}")
        _cleanup_tmp(tmp_path)
        return False

    # 5. fsync directory
    _fsync_dir(parent_dir)

    # 6. Mark committed
    entry.status = "committed"
    _append_journal(entry)

    return True


def atomic_write_json(target_path: str, obj: Any, journal_op: str = "write_json") -> bool:
    """Atomic write of a JSON-serializable object."""
    data = json.dumps(obj, indent=2, ensure_ascii=False).encode("utf-8")
    return atomic_write(target_path, data, journal_op=journal_op)


def _cleanup_tmp(path: str):
    try:
        if os.path.exists(path):
            os.remove(path)
    except Exception:
        pass


# ─── Snapshots ──────────────────────────────────────────────────────────────

def _snapshot_path(label: str) -> str:
    return os.path.join(SNAPSHOT_DIR, label)


def take_snapshot(label: str = "current") -> Optional[str]:
    """
    Snapshot the entire Kokoro memory tree.
    Returns snapshot ID or None on failure.
    """
    sid = _snapshot_id()
    dest = os.path.join(SNAPSHOT_DIR, f"{label}_{sid}")

    try:
        # Copy the entire memory tree (excluding snapshots themselves)
        shutil.copytree(
            MEMORY_ROOT, dest,
            ignore=shutil.ignore_patterns(".snapshots", ".journal.jsonl", ".identity_hash"),
        )

        # Write metadata
        meta = {
            "snapshot_id": sid,
            "label": label,
            "timestamp": time.time(),
            "timestamp_human": datetime.utcnow().isoformat(),
        }
        meta_path = os.path.join(dest, ".snapshot_meta.json")
        with open(meta_path, "w") as f:
            json.dump(meta, f, indent=2)

        # Update marker symlink
        marker = _snapshot_path(label)
        if os.path.islink(marker):
            os.remove(marker)
        elif os.path.exists(marker):
            os.remove(marker)
        os.symlink(dest, marker)

        log.info(f"Snapshot taken: {label}_{sid}")
        return sid

    except Exception as e:
        log.error(f"Snapshot failed ({label}): {e}")
        return None


def restore_snapshot(label: str) -> bool:
    """
    Restore Kokoro memory from a snapshot.
    Preserves snapshots directory itself.
    """
    marker = _snapshot_path(label)
    if os.path.islink(marker):
        source = os.readlink(marker)
    elif os.path.isdir(marker):
        source = marker
    else:
        # Try finding latest with this label prefix
        candidates = sorted([
            d for d in os.listdir(SNAPSHOT_DIR)
            if d.startswith(label + "_") and os.path.isdir(os.path.join(SNAPSHOT_DIR, d))
        ])
        if not candidates:
            log.error(f"No snapshot found for label '{label}'")
            return False
        source = os.path.join(SNAPSHOT_DIR, candidates[-1])

    if not os.path.isdir(source):
        log.error(f"Snapshot directory not found: {source}")
        return False

    try:
        # Take a pre-restore snapshot first
        take_snapshot("pre_restore")

        # Journal the restore operation
        _append_journal(JournalEntry(
            operation="restore",
            target=MEMORY_ROOT,
            snapshot_id=os.path.basename(source),
            status="pending",
        ))

        # Clear current memory (except snapshots and journal)
        for item in os.listdir(MEMORY_ROOT):
            if item in (".snapshots", ".journal.jsonl", ".identity_hash"):
                continue
            item_path = os.path.join(MEMORY_ROOT, item)
            if os.path.isdir(item_path):
                shutil.rmtree(item_path)
            else:
                os.remove(item_path)

        # Copy snapshot contents into memory root
        for item in os.listdir(source):
            if item == ".snapshot_meta.json":
                continue
            src = os.path.join(source, item)
            dst = os.path.join(MEMORY_ROOT, item)
            if os.path.isdir(src):
                shutil.copytree(src, dst)
            else:
                shutil.copy2(src, dst)

        # Mark committed
        _append_journal(JournalEntry(
            operation="restore",
            target=MEMORY_ROOT,
            snapshot_id=os.path.basename(source),
            status="committed",
        ))

        log.info(f"Snapshot restored: {os.path.basename(source)}")
        return True

    except Exception as e:
        log.error(f"Restore failed: {e}")
        return False


def take_daily_snapshot() -> Optional[str]:
    """Take a daily snapshot and prune old ones."""
    today = datetime.utcnow().strftime("%Y%m%d")
    label = f"daily_{today}"

    # Check if today's snapshot already exists
    existing = [d for d in os.listdir(SNAPSHOT_DIR)
                if d.startswith(label) and os.path.isdir(os.path.join(SNAPSHOT_DIR, d))]
    if existing:
        return None  # Already have today's

    sid = take_snapshot(label)

    # Prune old daily snapshots
    daily_dir = SNAPSHOT_DIR
    dailies = sorted([
        d for d in os.listdir(daily_dir)
        if d.startswith("daily_") and os.path.isdir(os.path.join(daily_dir, d))
    ])
    while len(dailies) > MAX_DAILY_SNAPSHOTS:
        old = dailies.pop(0)
        old_path = os.path.join(daily_dir, old)
        try:
            shutil.rmtree(old_path)
            log.info(f"Pruned old snapshot: {old}")
        except Exception:
            pass

    return sid


def list_snapshots() -> List[Dict]:
    """List all available snapshots."""
    snapshots = []
    if not os.path.isdir(SNAPSHOT_DIR):
        return snapshots

    for item in sorted(os.listdir(SNAPSHOT_DIR)):
        item_path = os.path.join(SNAPSHOT_DIR, item)
        if not os.path.isdir(item_path) or item.startswith("."):
            continue
        # Skip symlinks at top level (markers)
        if os.path.islink(item_path):
            continue

        meta_path = os.path.join(item_path, ".snapshot_meta.json")
        meta = {}
        if os.path.exists(meta_path):
            try:
                with open(meta_path, "r") as f:
                    meta = json.load(f)
            except Exception:
                pass

        snapshots.append({
            "name": item,
            "label": meta.get("label", "unknown"),
            "timestamp": meta.get("timestamp_human", "unknown"),
            "path": item_path,
        })

    return snapshots


def verify_write_integrity(target_path: str, expected_checksum: str) -> bool:
    """Verify a file matches its expected checksum after write."""
    if not os.path.exists(target_path):
        return False
    try:
        with open(target_path, "rb") as f:
            actual = _sha256(f.read())
        return actual == expected_checksum
    except Exception:
        return False


def get_continuity_status() -> Dict:
    """Full continuity store status."""
    snapshots = list_snapshots()
    pending = get_pending_writes()
    journal_entries = _read_journal()

    return {
        "snapshot_count": len(snapshots),
        "snapshots": [s["name"] for s in snapshots[-5:]],
        "pending_writes": len(pending),
        "journal_entries": len(journal_entries),
        "last_committed": (
            journal_entries[-1].to_dict() if journal_entries and
            journal_entries[-1].status == "committed" else None
        ),
    }
