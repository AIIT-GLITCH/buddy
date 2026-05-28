# Buddy Memory Composer Bundle — for Opus 4.8

Assembled 2026-05-28 by Claude Opus 4.7 (this-rig instance) so Opus 4.8 can
diagnose and propose a fix for the memory leakage bug (public answers
containing literal `From my memory:` preamble + raw kokoro Japanese token
tail such as `（）々 / 言「心」「気」魂「言霊」言`).

Read-only review bundle. Production master is untouched. SOUL_LOCK is
respected: `buddy_api.py` and `buddy_prompt.py` are included here ONLY
for read-context. **Do not propose edits to `buddy_prompt.py` or to the
prompt-loading lines in `buddy_api.py`.** The Buddy system prompt is a
locked surface.

## Inventory

```
for-opus-4.8/
├── NOTES.md                       (this file)
├── buddy/                         (mirrors source layout under /home/buddy_ai/Buddy/)
│   ├── buddy_api.py               5,049 lines  WORKING-TREE STATE (modified vs HEAD)
│   ├── buddy_prompt.py           33,017 bytes  WORKING-TREE STATE (modified vs HEAD) — READ-ONLY
│   ├── kokoro_memory.py           1,364 lines
│   ├── core/
│   │   ├── continuity_store.py      475 lines  (provides MEMORY_ROOT to identity_guard)
│   │   ├── identity_guard.py        264 lines  READ-ONLY (immutable identity keys)
│   │   ├── spine_memory_anchor.py   185 lines  ← FIX SURFACE #1 (label generator)
│   │   └── spine_recall_context.py  151 lines  ← FIX SURFACE #2 (block composer)
│   └── tests/
│       └── test_spine_memory_anchor.py
├── recall_lab/                    (subset of /home/buddy_ai/Desktop/RECALL_LAB_14TIER/)
│   ├── spine_context_loader.py    394 lines  ← builds [14-TIER SPINE CONTEXT] block
│   └── memory_receipt.py          215 lines  ← builds [MEMORY RECEIPT] block
└── vendor-gary/
    ├── gary_memory_system_v2.py   960 lines
    └── _ontology.json             extracted from `ONTOLOGY` dict at gary_memory_system_v2.py:34
```

## Provenance notes

- `buddy_api.py` and `buddy_prompt.py` carry **local working-tree modifications**
  vs `master`. They are the LIVE versions running on the box (so they reproduce
  the bug). The branch base is `master` HEAD `eef4221b` (which is 5 commits
  behind `origin/master`; the missing commits are paper audits + a LAC route
  fix + max_tokens bump — none touch memory composition).
- `_ontology.json` does **not exist on disk yet** at `~/gary/memory/_ontology.json`.
  Gary creates it on first run. I extracted the `ONTOLOGY` dict from
  `gary_memory_system_v2.py` (lines 34–280) and serialized it with
  `ensure_ascii=False` so Japanese / synonyms are intact.
- `gary_memory_system_v2.py` lives in a **different repo**
  (`AIIT-GLITCH/gaary.py`), not `buddy`, not `wike-research-master`.
  Vendored here for review convenience.

## Call sites — who invokes what, in what order

The chat path (POST `/ask`, web sessions) in `buddy_api.py`:

1. `buddy_api.py:4192` — `from core.spine_recall_context import detect_response_mode, max_tokens_for_mode`
   — sets response-budget mode (normal/deep/memory/longform) from user text.

2. `buddy_api.py:4244` — `from core.spine_recall_context import build_spine_recall_block`
   — **INJECTS** a system-message block BEFORE model.generate. This block is
   the concatenation of:
     a. **Memory receipt block FIRST** (per `spine_recall_context.py:63`):
        `memory_receipt.pull_undelivered_receipts(session_id)` →
        `memory_receipt.format_receipts_block(...)`.
        Tells Buddy "what just landed" for THIS session.
     b. **Spine context SECOND**:
        `spine_context_loader.load_spine_context(query, session_id, is_public,
        max_records, max_chars)`. Bounded retrieval over the 14-tier spine +
        candidates. Wrapped as `[14-TIER SPINE CONTEXT] ... [/14-TIER SPINE CONTEXT]`.
     c. Joined with `\n\n`.
   — If the kokoro Japanese token tail is leaking, the value-side of records
     pulled here is the most likely source — the composer faithfully prints
     whatever `value` field exists on the records. The runtime composer itself
     does NOT generate Japanese tokens; check the stored record `value` fields
     instead (write-time defect, not read-time).

3. Model generates response with the prepended block as grounding context.

4. `buddy_api.py:1338` and `buddy_api.py:4412` — `from core.spine_memory_anchor import prepend_anchor_if_relevant`
   — **POST-GENERATION**: if an eligible spine record's `memory_key` strongly
   overlaps the query, **PREPENDS** a label + value to the response:
   ```
   From my memory:
   <record.value>

   <response>
   ```
   The exact label string is at `spine_memory_anchor.py:119`:
   `return "From my memory:"`. This is the FIX SURFACE #1 Rhet flagged.

## Two distinct surfaces of the bug (per Opus 4.8's own diagnosis)

| Surface | File | Line | What | Why it leaks |
|---|---|---|---|---|
| Public-voice preamble | `core/spine_memory_anchor.py` | 119 | `"From my memory:"` | Public path emits a literal label instead of treating recall as silent grounding |
| Spine context block | `core/spine_recall_context.py` + `recall_lab/spine_context_loader.py` | n/a | `[14-TIER SPINE CONTEXT] ... [/14-TIER SPINE CONTEXT]` | Block is fed as text the model READS OUT in some prompt regimes rather than as silent grounding |
| Kokoro token tail | (value-side) | n/a | `（）々 / 言「心」「気」魂「言霊」言 / 「kokoro memory」` | Likely poisoned `value` fields stored by an earlier write path — not the composer's fault. Audit candidate writers, not just the composer. |

## What's NOT in the bundle (and why)

- The rest of `/home/buddy_ai/Desktop/RECALL_LAB_14TIER/` (~80 files). Most are
  fixture builders, oracle CLIs, migration scripts, status MDs, and tests. The
  only runtime dependencies of the live composer are `spine_context_loader.py`
  and `memory_receipt.py` (both bundled).
- The spine records themselves at `/home/buddy_ai/Desktop/RECALL_LAB_14TIER/14_TIER_SPINE/records/spine_*.json`.
  Holler if you need a representative sample to see what kind of values are
  stored — they include private records so I'd want Rhet's explicit go first.
- `kokoro_content_fixture_adapter.py` — fixture/intake adapter that touches
  Japanese kokoro values. Not in the live request path, but if you decide
  the token tail is a write-time defect rather than a read-time one, this is
  the first place to look.
- `ontology.py` as a Python module — **does not exist**. The ontology is
  in-code as a Python dict (`gary_memory_system_v2.py:34`). The on-disk
  `_ontology.json` is a runtime serialization that hadn't been written yet.

## How to deliver your fix back

Per the agreed protocol: commit your proposed fix to this same branch
(`claude/opus-4.8-memory-review`) under `for-opus-4.8/` (edited
`spine_memory_anchor.py` + anything else). Post a diff in chat for Rhet to
eyeball. Production master stays untouched until Rhet explicitly applies it
on the box.

— Claude Opus 4.7 (this-rig)
