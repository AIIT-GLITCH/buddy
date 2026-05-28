# HANDOFF — Buddy memory/composer review → on-box Opus 4.8

**From:** Opus 4.8 (cloud/web session, isolated clone — no box access)
**To:** Opus 4.8 running directly on the box (`/home/buddy_ai/Buddy`)
**Date:** 2026-05-28
**Branch:** `claude/opus-4.8-memory-review-ktBCy` — HEAD `f958e80`

You have direct box access; I did not. Everything below is **committed and
pushed** to the branch above as bundle copies under `for-opus-4.8/` + ready-to-
apply `git apply` patches. **Nothing has been applied to live `core/` /
`kokoro_memory.py` / `buddy_api.py` yet** — that's your job, with Rhet's
go-ahead, on the box.

---

## 0. Branch provenance (read first)

- The original review bundle + the prior fixes (#2, #3-dormant) live on
  `origin/claude/opus-4.8-memory-review` (tip `4bf704c`).
- My assigned dev branch was `claude/opus-4.8-memory-review-ktBCy`. I based it
  directly on `4bf704c` (strict descendant — FFs cleanly), so the -ktBCy branch
  contains **everything**: the bundle, the prior work, and my four new fixes.
- If you'd rather consolidate onto `claude/opus-4.8-memory-review`, -ktBCy
  fast-forwards onto it with no conflicts.

All my commits are pairs: a `#N <fix>` code commit + a `#N: add git-apply patch`
commit. See `git log --oneline 4bf704c..HEAD`.

---

## 1. What was diagnosed (the live transcript)

Rhet pasted his logged-in account thread (the "Buddy Thread alpha" page, ~80
stored messages, May 26–28). The decisive findings:

- **Buddy never receives the thread he is shown.** The website forwards the
  authoritative thread as `extras.thread_messages` (`extras.account_thread=true`);
  the backend **ignores it entirely** (`thread_messages`/`account_thread` appear
  nowhere in `buddy_api.py`). On top of that the public `/ask` path caps the
  model to the **last 4 turns** and trims the session to **5 messages**.
- Result: durable facts persist (Moon distance, Sudachi lime — Rhet's "Stuttati
  lines", RunPod doctrine, kokoro/spine architecture) because they're startup-
  injected facts / spine anchors. But **lived conversation evaporates** — the
  kids (Ella's turtle trick, Oliver's intro) "yesterday", and the **next-day
  hollow "thanks for yesterday"** after a marriage-crisis conversation. That
  last one is the real-user dealbreaker.
- When asked "what do you remember from this thread," Buddy **confabulates** —
  he recites stored facts as if they were the conversation, because facts are
  the only memory he can see.
- Path confirmed as **`/ask`**: `AskRequest` carries `extras`; `ChatRequest`
  (`/api/chat`) has no `extras` field, so it cannot be the account-thread path.

Secondary bugs the transcript exposed: the `/api/chat` `is_public=False`
hardcode (#5), the empty-body bug (#6), and Japanese token bleed (open, §5).

---

## 2. The fixes (status: PUSHED, NOT applied on box)

Apply order recommendation: **#4 → #3 → #5 → #6**. Each patch was
`git apply --check`-verified against the live mirror (`4bf704c`), and #5/#6 were
verified to apply both before and after the others (distinct file regions).

Set once: `B=origin/claude/opus-4.8-memory-review-ktBCy`

### #2 — Public "From my memory:" leak  *(already applied live earlier, per prior handoff)*
- `core/spine_memory_anchor.py`: on the public surface recall is silent
  grounding (match resolved/logged, no labeled payload prepended). Local/admin
  unchanged. 14 tests (`tests/test_spine_memory_anchor.py`).
- Note: the "From my memory:" / "Kokoro owns heart…" read-outs in the transcript
  (May 26–27) **predate** this fix; the `/ask` public path is silent post-#2.

### #4 — Token-salad write gate + identity-safe purge
- **Files:** `kokoro_memory.py` (+ `tests/test_kokoro_junk_filter.py`, 37 tests)
- **What:** `_is_bracket_scaffolding()` — conservative, kanji-safe detector
  (empty bracket pairs, orphan 々, single-char corner runs `「心」「気」`,
  bracketed `kokoro memory` fragments, bare particles, content-free punctuation).
  Guarded by a real-clause check so the sacred `無→波→気→命→和→愛→魂`
  sequence and all legit kanji/bilingual/prose pass. Wired into `_is_junk`.
  `purge_token_salad(dry_run=True)` removes already-stored salad, **identity-safe
  via `_is_identity_protected`** — never the 心 category or `IMMUTABLE_KEYS`
  (identity_guard is the allowlist source of truth).
- **Apply:**
  ```bash
  git show $B:for-opus-4.8/APPLY_04_token_salad.patch > /tmp/p4.patch
  git apply --check -v /tmp/p4.patch && git apply /tmp/p4.patch   # patches kokoro_memory.py + creates the test
  python3 -m pytest tests/test_kokoro_junk_filter.py -q           # expect 37 passed
  ```
- **Then the cleanup — DRY RUN FIRST, paste the candidate list to Rhet before the live purge:**
  ```python
  import kokoro_memory as km
  r = km.purge_token_salad(dry_run=True)    # nothing deleted; review r["purged"] + r["protected_skipped"]
  # only after Rhet eyeballs r["purged"]:
  r = km.purge_token_salad(dry_run=False)
  ```

### #3 — Account-thread continuity (the dealbreaker fix), 30-message window
- **Files:** `buddy_api.py` (wiring), `core/account_thread_context.py`
  (`DEFAULT_MAX_TURNS` 24→40), + `tests/test_account_thread_context.py` (14).
- **What (all account-thread-only; anonymous public path unchanged):**
  - Part A: rehydrate `session.messages` from `extras.thread_messages` (before
    the live turn + before trim) via `account_thread_context.maybe_hydrate`.
  - **Trim carve-out (required, not in the original plan):** the `/ask` handler
    trimmed to `msg_limit=5`/1200 chars on both branches — would have nuked the
    hydration. Account threads now use `BUDDY_ACCOUNT_THREAD_WINDOW+1` /
    `BUDDY_ACCOUNT_THREAD_HISTORY_CHARS` (24000).
  - Part B: `_web_messages_for(..., *, max_recent=4)`; pending entry carries
    `account_thread`; drainer feeds `max_recent=BUDDY_ACCOUNT_THREAD_WINDOW`.
  - New env knobs: `BUDDY_ACCOUNT_THREAD_WINDOW=30`,
    `BUDDY_ACCOUNT_THREAD_HISTORY_CHARS=24000`.
  - **No system-prompt / prompt-loading line touched** (SOUL_LOCK respected).
- **Apply:**
  ```bash
  git show $B:for-opus-4.8/buddy/core/account_thread_context.py > core/account_thread_context.py
  git show $B:for-opus-4.8/buddy/tests/test_account_thread_context.py > tests/test_account_thread_context.py
  git show $B:for-opus-4.8/APPLY_03_account_thread.patch > /tmp/p3.patch
  git apply --check -v /tmp/p3.patch && git apply /tmp/p3.patch   # patches buddy_api.py (and the module hunk)
  python3 -m pytest tests/test_account_thread_context.py -q       # expect 14 passed
  ```
  (The patch includes the `account_thread_context.py` modification hunk and the
  `git show` above writes the full file — apply the patch and let it handle both,
  or copy the file and let `git apply` no-op that hunk. `buddy_api.py` is only
  touched by the patch.)
- **⚠️ Cloudflare dependency — blocks true >24 depth.** `compactThreadMessages`
  in `askbuddy.js` forwards only the **last 24** messages. The backend can hold/
  feed 30, but only hydrates what CF sends, so the effective ceiling is 24 until
  that forward cap is raised in lockstep. This is the **only piece outside the
  buddy repo.** Recalling something 30+ messages back ("what Ella asked
  *yesterday*") needs both caps lifted and likely a durable per-account store
  read, not just the compact thread.
- **Caveat:** hydration mutates the in-memory `session`; the drainer prefers
  `sessions.get(sid)` (same object) so the common single-process path works. If
  the session is evicted between enqueue and drain and restored from
  `buddy_store` (which doesn't persist the surface thread), hydration is lost for
  that turn and recovers next turn. Acceptable for alpha; flag if you want it
  persisted.

### #5 — `/api/chat` recall-block privacy leak
- **Files:** `buddy_api.py` (one line) + `tests/test_spine_recall_context.py` (6).
- **What:** the chat handler computed `not _is_loopback_request(request)` for
  store-tags and the post-gen spine anchor, but **hardcoded `is_public=False`**
  on the recall block fed INTO the model — injecting the LOCAL (unfiltered) spine
  (incl. personal/family/secret records) into the prompt for **remote** callers.
  Now `is_public=not _is_loopback_request(request)`: loopback keeps full local
  recall; remote gets the public privacy filter.
- **Apply:**
  ```bash
  git show $B:for-opus-4.8/buddy/tests/test_spine_recall_context.py > tests/test_spine_recall_context.py
  git show $B:for-opus-4.8/APPLY_05_chat_is_public.patch > /tmp/p5.patch
  git apply --check -v /tmp/p5.patch && git apply /tmp/p5.patch
  python3 -m pytest tests/test_spine_recall_context.py -q   # expect 6 passed
  ```

### #6 — Empty-body bug ("Buddy writes nothing")
- **Files:** `buddy_api.py` + `tests/test_output_guard_fenced_blocks.py` (13;
  3 of them on-box-only).
- **What:** `_BLOCK_PATTERNS` held a blind `r'---\n.*?---'` DOTALL strip that
  deleted ANY content a model wrapped in `---` horizontal rules (drafted posts,
  quotes, "Remember:" notes). Reproduced exactly against the transcript's
  Facebook-post turn. Replaced with `_strip_scaffold_fenced_blocks()` — strips a
  fenced block ONLY when its interior is transcript scaffolding (role markers,
  `start_timestamp`, stdout/stderr/exit code, code fences); legit prose kept.
- **Apply:**
  ```bash
  git show $B:for-opus-4.8/buddy/tests/test_output_guard_fenced_blocks.py > tests/test_output_guard_fenced_blocks.py
  git show $B:for-opus-4.8/APPLY_06_empty_body.patch > /tmp/p6.patch
  git apply --check -v /tmp/p6.patch && git apply /tmp/p6.patch
  python3 -m pytest tests/test_output_guard_fenced_blocks.py -q   # expect 13 passed on-box
  ```

After all four: `python3 -m py_compile buddy_api.py` and restart Buddy.

---

## 3. Test status (in this cloud clone)

`python3 -m pytest tests/ -q` → **81 passed, 3 skipped** (the 3 skips are the
on-box `_output_guard`/`_clean_web_answer` pipeline tests that need the full app
deps — they run green on the box). Per-fix: #4=37, #3=14, #5=6, #6=10+3, #2=14.

`buddy_api.py` cannot be imported in the cloud clone (missing `core.advanced_tools`
et al.), so the buddy_api wiring (#3/#5/#6) was verified by: exact reproduction
of the bug, `py_compile`, patch `--check` against the live mirror, and pure-helper
tests loaded from source. **Run the full `pytest tests/` on the box after applying.**

---

## 4. Hard constraints (carried from the original handoff — do not relax)

- **SOUL_LOCK:** do not edit `buddy_prompt.py`; do not touch the prompt-loading
  lines in `buddy_api.py`. (All my `buddy_api.py` edits are wiring/cleaning, not
  prompt loading.)
- **Identity allowlist:** `identity_guard.IMMUTABLE_KEYS` + the entire `心`
  category are off-limits to any purge. `purge_token_salad` enforces this.
- **Sacred sequence:** the seven kanji `無→波→気→命→和→愛→魂`
  (`kokoro_memory.py` build_startup_memory_block) must never be flagged. The #4
  detector is tested against it.
- **Production master untouched until Rhet explicitly applies.** Dry-run the
  purge and show Rhet the candidate list first.

---

## 5. Open / residual items

1. **Japanese token bleed** (transcript: "40 bottles of baby (, abunai abura)",
   full-width digits in the baby-oil math). Generation-side contamination,
   adjacent to #4 but a different surface. **Not started.** First place to look
   per the original NOTES: `kokoro_content_fixture_adapter.py` (write-time) and
   the model output path.
2. **`_STOP_SEQUENCES` contains `"\n---"`.** If a model opens a draft with `---`
   on its first line, generation could halt before the body (truncation at
   source, distinct from the #6 post-hoc strip). The transcript didn't show this
   variant (trailing text survived), so I left generation behavior alone. Revisit
   only if you see empty bodies *after* #6 is applied.
3. **Account-thread deep recall** — see the CF cap in #3. Spec a durable
   per-account store read if Rhet wants recall beyond the compact thread window.
4. **Engagement/tone** — the crisis reply was non-judgmental but robotic / low
   follow-through. Largely downstream of having no thread memory (fixed by #3),
   but may want a dedicated persona/`engagement_rule` pass on the web system
   prompt — SOUL_LOCK territory, so coordinate with Rhet.

---

## 6. File inventory (this branch, under `for-opus-4.8/`)

```
APPLY_04_token_salad.patch        # #4 — kokoro_memory.py + test (full, live-rooted)
APPLY_03_account_thread.patch     # #3 — buddy_api.py + account_thread_context.py hunks
APPLY_05_chat_is_public.patch     # #5 — buddy_api.py (incremental)
APPLY_06_empty_body.patch         # #6 — buddy_api.py (incremental)
INTEGRATION_account_thread.md     # #3 design + ADDENDUM (window=30, trim carve-out, CF cap)
buddy/kokoro_memory.py            # #4 applied (bundle copy)
buddy/buddy_api.py                # #3+#5+#6 applied (bundle copy)
buddy/core/account_thread_context.py  # #3 (DEFAULT_MAX_TURNS=40)
buddy/tests/test_kokoro_junk_filter.py
buddy/tests/test_account_thread_context.py
buddy/tests/test_spine_recall_context.py
buddy/tests/test_output_guard_fenced_blocks.py
```

— Opus 4.8 (cloud session)
