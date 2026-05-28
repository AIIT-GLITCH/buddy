"""Hardening tests for core.spine_memory_anchor.

Covers the rules added in the 2026-05-25 fidelity pass:
- Quarantine records are never anchored.
- Preamble accurately matches activation_status (no calling shadow_only
  records "reviewed spine memory").
- Public-surface calls filter out personal_private / family_private /
  secret_sensitive; project_private and public_ok pass through.

Tests monkeypatch SPINE_RECORDS so the live lab spine is never touched.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

# Repo-relative import: core/ lives at the repo root.
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core import spine_memory_anchor as sma


@pytest.fixture
def tmp_spine(tmp_path, monkeypatch):
    records = tmp_path / "records"
    records.mkdir(parents=True)
    monkeypatch.setattr(sma, "SPINE_RECORDS", records)
    return records


def _write(records: Path, rid: str, **fields) -> None:
    base = {
        "id": rid,
        "key": rid,
        "value": "default value",
        "activation_status": "active_bounded",
        "privacy_class": "project_private",
    }
    base.update(fields)
    (records / f"{rid}.json").write_text(json.dumps(base), encoding="utf-8")


def test_active_bounded_preamble_is_natural_public_voice(tmp_spine):
    _write(tmp_spine, "spine_a1",
           key="mact_v0_2_per_token_axis_conditioning",
           value="MACT v0.2 receipt.",
           activation_status="active_bounded")
    out, rid = sma.prepend_anchor_if_relevant("placeholder", "tell me about mact v0_2")
    assert rid == "spine_a1"
    assert out.startswith("From my memory:")
    head = out.split("placeholder")[0]
    # Public voice must not leak lab vocabulary
    assert "spine" not in head.lower()
    assert "record_id" not in head.lower()
    assert "activation_status" not in head.lower()
    # The value still gets quoted for active_bounded
    assert "MACT v0.2 receipt" in out


def test_shadow_only_preamble_uses_unconfirmed_phrasing(tmp_spine):
    _write(tmp_spine, "spine_s1",
           key="mact_v0_2_per_token_axis_conditioning",
           value="MACT v0.2 receipt.",
           activation_status="shadow_only")
    out, rid = sma.prepend_anchor_if_relevant("placeholder", "tell me about mact v0_2")
    assert rid == "spine_s1"
    head = out.split("placeholder")[0]
    assert "spine" not in head.lower()
    assert "reviewed" not in head.lower(), f"shadow_only must not be labeled reviewed; got: {head!r}"
    assert "unconfirmed" in head.lower()
    # Value is still quoted for shadow_only (just with the caveat lead-in)
    assert "MACT v0.2 receipt" in out


def test_review_required_summary_only_no_value_quoted(tmp_spine):
    _write(tmp_spine, "spine_r1",
           key="mact_v0_2_per_token_axis_conditioning",
           value="Sensitive pending-review value should not appear.",
           activation_status="review_required")
    out, rid = sma.prepend_anchor_if_relevant("placeholder", "tell me about mact v0_2")
    assert rid == "spine_r1"
    head = out.split("placeholder")[0]
    # Self-contained statement, no value quoted, no lab vocabulary
    assert "memory candidate" in head.lower()
    assert "awaiting review" in head.lower()
    assert "spine" not in head.lower()
    assert "Sensitive pending-review value" not in out


def test_admin_mode_exposes_internal_terms(tmp_spine):
    _write(tmp_spine, "spine_admin1",
           key="mact_v0_2_per_token_axis_conditioning",
           value="MACT v0.2 receipt.",
           activation_status="shadow_only")
    out, rid = sma.prepend_anchor_if_relevant(
        "placeholder", "tell me about mact v0_2", admin_mode=True,
    )
    assert rid == "spine_admin1"
    head = out.split("placeholder")[0]
    # Admin mode keeps the verbose lab phrasing for debugging
    assert "spine" in head.lower()
    assert "record_id" in head.lower()
    assert "spine_admin1" in head


def test_quarantine_record_is_never_anchored(tmp_spine):
    _write(tmp_spine, "spine_q1",
           key="mact_v0_2_per_token_axis_conditioning",
           value="This claim was disputed and quarantined.",
           activation_status="quarantine")
    out, rid = sma.prepend_anchor_if_relevant("orig", "tell me about mact v0_2")
    assert rid is None, "quarantine records must not be anchored"
    assert out == "orig"


def test_public_call_blocks_personal_private(tmp_spine):
    _write(tmp_spine, "spine_pp",
           key="rhet_home_address_council_hill",
           value="Sensitive personal info.",
           activation_status="active_bounded",
           privacy_class="personal_private")
    out, rid = sma.prepend_anchor_if_relevant(
        "orig", "rhet home address council_hill", is_public=True
    )
    assert rid is None
    assert "Sensitive personal info" not in out


def test_public_call_blocks_family_private(tmp_spine):
    _write(tmp_spine, "spine_fp",
           key="family_member_birthday_marker",
           value="Family-sensitive info.",
           activation_status="active_bounded",
           privacy_class="family_private")
    out, rid = sma.prepend_anchor_if_relevant(
        "orig", "family member birthday marker", is_public=True
    )
    assert rid is None
    assert "Family-sensitive info" not in out


def test_public_call_blocks_secret_sensitive(tmp_spine):
    _write(tmp_spine, "spine_ss",
           key="api_token_for_external_service",
           value="sk-leakytestvalue1234567890",
           activation_status="active_bounded",
           privacy_class="secret_sensitive")
    out, rid = sma.prepend_anchor_if_relevant(
        "orig", "api token for external_service", is_public=True
    )
    assert rid is None
    assert "sk-leakytestvalue" not in out


def test_public_call_allows_project_private(tmp_spine):
    # An eligible project_private record is still resolved on the public
    # surface (so the match can be logged), but recall is SILENT grounding:
    # the value is never read out and the reply is returned untouched.
    _write(tmp_spine, "spine_proj",
           key="mact_v0_2_per_token_axis_conditioning",
           value="Public-safe project content.",
           activation_status="active_bounded",
           privacy_class="project_private")
    out, rid = sma.prepend_anchor_if_relevant(
        "orig", "mact v0_2 per token axis conditioning", is_public=True
    )
    assert rid == "spine_proj"          # match resolved for logging/metadata
    assert out == "orig"                # reply untouched; no read-out
    assert "Public-safe project content" not in out


def test_public_call_allows_public_ok(tmp_spine):
    # Same contract for public_ok: resolved for logging, never read out.
    _write(tmp_spine, "spine_pub",
           key="aiit_threshold_public_site_brand",
           value="AIIT-Threshold public brand fact.",
           activation_status="active_bounded",
           privacy_class="public_ok")
    out, rid = sma.prepend_anchor_if_relevant(
        "orig", "aiit threshold public site brand", is_public=True
    )
    assert rid == "spine_pub"
    assert out == "orig"
    assert "AIIT-Threshold public brand fact" not in out


def test_public_surface_never_reads_out_memory_preamble(tmp_spine):
    # Regression for the public "From my memory:" leak. Even with a strongly
    # relevant, public-safe, active_bounded record, the public surface must
    # NOT prepend a labeled payload to the visible answer.
    _write(tmp_spine, "spine_ro",
           key="mact_v0_2_per_token_axis_conditioning",
           value="MACT v0.2 receipt.",
           activation_status="active_bounded",
           privacy_class="public_ok")
    out, rid = sma.prepend_anchor_if_relevant(
        "placeholder", "tell me about mact v0_2", is_public=True
    )
    assert rid == "spine_ro"                 # match still resolved for logs
    assert "From my memory:" not in out      # no robotic preamble on public
    assert out == "placeholder"              # answer untouched

    # admin_mode is the deliberate exception: operators still see the verbose
    # anchor for debugging, even on a public-flagged call.
    out_admin, rid_admin = sma.prepend_anchor_if_relevant(
        "placeholder", "tell me about mact v0_2", is_public=True, admin_mode=True,
    )
    assert rid_admin == "spine_ro"
    assert "record_id" in out_admin.lower()


def test_local_surface_still_reads_out_memory(tmp_spine):
    # The fix is scoped to the public surface. Local/operator voice (is_public
    # is False) keeps the existing anchor behavior so Rhet's own tooling is
    # unchanged.
    _write(tmp_spine, "spine_local",
           key="mact_v0_2_per_token_axis_conditioning",
           value="MACT v0.2 receipt.",
           activation_status="active_bounded")
    out, rid = sma.prepend_anchor_if_relevant(
        "placeholder", "tell me about mact v0_2", is_public=False
    )
    assert rid == "spine_local"
    assert out.startswith("From my memory:")
    assert "MACT v0.2 receipt" in out


def test_min_key_overlap_threshold_holds(tmp_spine):
    _write(tmp_spine, "spine_t1",
           key="alpha beta gamma delta",
           value="threshold test.")
    # only one matching token → below the threshold of 2
    out, rid = sma.prepend_anchor_if_relevant("orig", "alpha standalone")
    assert rid is None
    # two matching tokens → fires
    out, rid = sma.prepend_anchor_if_relevant("orig", "alpha beta query")
    assert rid == "spine_t1"


def test_empty_spine_dir_returns_response_unchanged(tmp_spine):
    out, rid = sma.prepend_anchor_if_relevant("hello world", "anything")
    assert rid is None
    assert out == "hello world"
