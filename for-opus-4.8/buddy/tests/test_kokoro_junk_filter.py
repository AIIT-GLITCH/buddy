"""Tests for the kokoro_memory bracket-scaffolding / token-salad defense.

Covers the three pieces of the 2026-05-28 hardening pass (#4):
  (a) `_is_bracket_scaffolding` — a conservative, kanji-safe detector.
  (b) `_is_junk` — now rejects scaffolding at the write gate.
  (c) `purge_token_salad` — identity-safe cleanup of already-stored salad,
      which must NEVER touch the 心 identity category or IMMUTABLE_KEYS.

The purge tests monkeypatch MEMORY_ROOT so the live store is never touched.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

# Repo-relative import: kokoro_memory.py + core/ live at the bundle root.
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import kokoro_memory as km


# ---------------------------------------------------------------------------
# (a) Detector — JUNK cases (must be flagged)
# ---------------------------------------------------------------------------

JUNK_VALUES = [
    "（）々 / 言「心」「気」魂「言霊」言",   # the canonical leak tail
    "言「心」「気」魂「言霊」言",            # same salad, no empty-paren prefix
    "「kokoro memory」",                     # bracketed kokoro fragment
    "kokoro memory",                          # bare kokoro fragment
    "（kokoro）",                             # full-width-bracketed kokoro
    "｢｣『』（）／・",                        # pure bracket/separator run
    "（）／・｜",                             # pure separators
    "「」",                                   # empty corner brackets
    "（）",                                   # empty full-width parens
    "は",                                     # bare particle
    "を に",                                  # bare particles w/ separator
    "の / は / を",                           # particle salad
    "（）々",                                 # orphan iteration mark
    "「心」「気」",                           # two single-char corner groups
]


@pytest.mark.parametrize("value", JUNK_VALUES)
def test_detector_flags_token_salad(value):
    assert km._is_bracket_scaffolding(value) is True, (
        f"expected scaffolding, not flagged: {value!r}"
    )
    # And it must fail the write gate.
    assert km._is_junk("some_key", value) is True


# ---------------------------------------------------------------------------
# (a) Detector — LEGITIMATE cases (must NOT be flagged)
# ---------------------------------------------------------------------------

GOOD_VALUES = [
    # The sacred seven-kanji sequence — must always survive.
    "無 → 波 → 気 → 命 → 和 → 愛 → 魂",
    "無→波→気→命→和→愛→魂",
    # Ordinary Japanese prose.
    "私はBuddyです。",
    "コーヒーが好きです。",
    "心は大切なもの。",
    "言霊は言葉に宿る力です。",
    # Bilingual / mixed content.
    "Buddy means 心 (kokoro) — heart and mind unified.",
    "言霊 (kotodama) is the spirit that dwells in words.",
    "In Japanese, quotation uses 「」 brackets around speech.",
    # Plain English facts.
    "Rhet Dillard Wike lives in Council Hill, Oklahoma.",
    "The Wike Coherence Law relates coherence to alignment.",
    "TCP/IP is the core networking protocol stack.",
    # A real fact that merely contains a slash and parens.
    "Buddy runs on Qwen2.5-14B (32K context) / served via the API.",
    # Single meaningful tokens that are thin but not salad.
    "心",
    "言霊",
]


@pytest.mark.parametrize("value", GOOD_VALUES)
def test_detector_passes_legitimate_content(value):
    assert km._is_bracket_scaffolding(value) is False, (
        f"false positive — legitimate content flagged: {value!r}"
    )


def test_seven_kanji_sequence_survives_is_junk():
    # Belt-and-suspenders: the sacred sequence must clear the full write gate.
    seq = "無 → 波 → 気 → 命 → 和 → 愛 → 魂"
    assert km._is_junk("seven_kanji", seq) is False


def test_empty_and_blank_are_not_scaffolding():
    # Emptiness is handled by the length rules in _is_junk, not the detector.
    assert km._is_bracket_scaffolding("") is False
    assert km._is_bracket_scaffolding("   ") is False


def test_long_prose_is_never_scaffolding():
    long_text = "心 " * 90  # >160 chars; conservative short-circuit
    assert len(long_text) > 160
    assert km._is_bracket_scaffolding(long_text) is False


# ---------------------------------------------------------------------------
# (c) Identity-safe purge
# ---------------------------------------------------------------------------

@pytest.fixture
def tmp_memory(tmp_path, monkeypatch):
    """Point kokoro_memory at an isolated MEMORY_ROOT."""
    monkeypatch.setattr(km, "MEMORY_ROOT", str(tmp_path))
    return tmp_path


def _write_fact(root: Path, category: str, key: str, value: str) -> Path:
    folder = root / category
    folder.mkdir(parents=True, exist_ok=True)
    safe = key.replace("/", "_")
    path = folder / f"{safe}.json"
    path.write_text(
        json.dumps({"key": key, "value": value, "category": category}),
        encoding="utf-8",
    )
    return path


def test_purge_dry_run_removes_nothing(tmp_memory):
    salad = _write_fact(tmp_memory, "名詞", "salad1", "（）々 / 言「心」「気」魂")
    clean = _write_fact(tmp_memory, "真実", "clean1", "Coherence is measurable.")

    report = km.purge_token_salad(dry_run=True)

    assert report["dry_run"] is True
    assert report["purged_count"] == 1
    assert {"category": "名詞", "key": "salad1"}.items() <= report["purged"][0].items()
    # Nothing actually deleted in a dry run.
    assert salad.exists()
    assert clean.exists()


def test_purge_removes_only_salad(tmp_memory):
    salad = _write_fact(tmp_memory, "名詞", "salad1", "「kokoro memory」")
    clean = _write_fact(tmp_memory, "真実", "clean1", "Coherence is measurable.")

    report = km.purge_token_salad(dry_run=False)

    assert report["purged_count"] == 1
    assert not salad.exists(), "salad fact should be purged"
    assert clean.exists(), "clean fact must survive"


def test_purge_never_touches_kokoro_identity_category(tmp_memory):
    # Even a salad-shaped value in 心 is protected (whole category is off-limits).
    ident = _write_fact(tmp_memory, "心", "weird_identity", "（）々 「心」「気」")

    report = km.purge_token_salad(dry_run=False)

    assert ident.exists(), "心 identity category must never be purged"
    assert report["purged_count"] == 0
    assert report["protected_count"] == 1
    assert report["protected_skipped"][0]["category"] == "心"


def test_purge_never_touches_immutable_keys_anywhere(tmp_memory):
    # An IMMUTABLE_KEYS key is protected even outside 心.
    from core.identity_guard import IMMUTABLE_KEYS
    immutable_key = sorted(IMMUTABLE_KEYS)[0]
    protected = _write_fact(tmp_memory, "名詞", immutable_key, "（）々 「心」「気」")

    report = km.purge_token_salad(dry_run=False)

    assert protected.exists(), "IMMUTABLE_KEYS facts must never be purged"
    assert report["purged_count"] == 0
    assert report["protected_count"] == 1


def test_purge_handles_empty_store(tmp_memory):
    report = km.purge_token_salad(dry_run=False)
    assert report["scanned"] == 0
    assert report["purged_count"] == 0
    assert report["protected_count"] == 0
