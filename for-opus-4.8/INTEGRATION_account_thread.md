# Integration: persistent account-thread memory (buddy_api.py)

New module: `core/account_thread_context.py` (+ `tests/test_account_thread_context.py`, 14 tests).
It is self-contained, pure, dependency-free, and writes nothing. The only edits
to `buddy_api.py` are the small wiring hunks below. **No system-prompt / prompt-
loading line is touched** — the system message at `session.messages[0]` is
preserved by `hydrate_session_messages`.

Two independent parts. Part A is the real fix (stops Buddy forgetting a visible
conversation). Part B is an optional depth bump. Apply A first.

---

## Part A — Rehydrate the backend session from the chat box (the fix)

The website already sends the authoritative thread as `extras.thread_messages`
with `extras.account_thread == True`; the backend currently ignores it. Seed the
session from it **only when the backend copy is behind** (epoch change, evicted
row, or a different backend instance).

In the web `/ask` handler, right AFTER the session is restored/created and its
mode normalized (just before `max_tokens = int(extras.get("max_tokens", ...))`,
≈ line 1457), and crucially BEFORE the live user turn is stored/appended:

```python
        # --- Account-thread rehydration (logged-in persistent chat) -------
        # The website chat box (Cloudflare AUTH_KV) is authoritative for a
        # logged-in account and is sent as extras.thread_messages. If this
        # backend session is behind it (epoch change / evicted row / different
        # instance), seed context from it so the box the user sees is what
        # Buddy reasons from. Account threads only; never anonymous public.
        try:
            if extras.get("account_thread"):
                from core.account_thread_context import maybe_hydrate
                _hydrated = maybe_hydrate(session.messages, extras.get("thread_messages"))
                if _hydrated is not None:
                    session.messages = _hydrated
                    log.info(
                        f"[account-thread] hydrated {session_id} from surface "
                        f"thread -> {len(_hydrated)} msgs"
                    )
        except Exception as _hydrate_err:
            log.warning(f"account-thread hydration failed: {_hydrate_err}")
        # ------------------------------------------------------------------
```

That's it for A. After this, a logged-in user whose backend session went empty
goes from seeing **0** of a full chat box to being back in sync.

> Note: the CF surface only forwards `thread_messages` on the *account* path
> (see `askbuddy.js`: `storedThreadMessages` is loaded from AUTH_KV and passed
> in `extras`). Anonymous visitors never carry it, so the `account_thread` gate
> is belt-and-suspenders.

---

## Part B — Optional: let account threads see more than the last 4 turns

`_web_messages_for` (≈ line 1127) feeds the model only the last **4** turns. That
cap is right for cheap anonymous public traffic, but it means even a hydrated
account thread is shallow. Make the window a parameter (default unchanged) and
widen it for account threads.

1. Make `_web_messages_for` window configurable (default preserves today's behavior):

```python
def _web_messages_for(session: Session, user_input: str, *, max_recent: int = 4) -> List[Dict[str, str]]:
    recent_messages = [
        {
            "role": m.get("role", "user"),
            "content": str(m.get("content", ""))[:500],
        }
        for m in session.messages[1:]
        if m.get("role") in {"user", "assistant"} and m.get("content")
    ][-max_recent:]
    ...
```

2. Carry the account flag onto the pending entry in `_enqueue_pending_web_ask`
   (add a param `account_thread: bool = False` and store it on the entry dict),
   pass it from the `/ask` handler (`account_thread=bool(extras.get("account_thread"))`),
   and in the drainer (≈ line 1324) read it back:

```python
                _account_thread = bool(entry.get("account_thread", False))
                raw_answer = await _asyncio.to_thread(
                    engine.chat,
                    _web_messages_for(
                        session, user_input,
                        max_recent=(BUDDY_ACCOUNT_THREAD_WINDOW if _account_thread else 4),
                    ),
                    ...
                )
```

3. Add a bounded constant near the other web budgets, env-overridable:

```python
BUDDY_ACCOUNT_THREAD_WINDOW = int(os.environ.get("BUDDY_ACCOUNT_THREAD_WINDOW", "12"))
```

`12` (≈ 6 exchanges) is a safe starting point; tune against GPU headroom. Each
turn is still truncated to 500 chars, so the worst-case context growth is
bounded (`12 * 500` ≈ 6 KB of recents).

---

## Why this is data-policy clean

A user's own account thread is content **they** gave Buddy in **their** logged-in
session. Hydration moves that same content from "displayed but ignored" to
"actually used." No spine records, no cross-user data, no public exposure, no
change to the public/anonymous path. Internal-data guardrails are unaffected.

## Apply on the box

Copy `for-opus-4.8/buddy/core/account_thread_context.py` ->
`/home/buddy_ai/Buddy/core/account_thread_context.py`
(and the test alongside), then apply the Part A hunk (and Part B if you want
depth). Run `pytest tests/test_account_thread_context.py` to confirm.

---

## ADDENDUM 2026-05-28 — shipped as `APPLY_03_account_thread.patch` (window = 30)

The diagnosis transcript (logged-in alpha thread) confirmed the live path is
**`/ask`** (`AskRequest` carries `extras`; `ChatRequest` / `/api/chat` does not),
i.e. the enqueue→drain path with the cheap window. Rhet asked for **≥30
messages**, so the committed patch differs from the hunks above as follows:

1. **Window default is 30, not 12.** New constants near the other web budgets:
   ```python
   BUDDY_ACCOUNT_THREAD_WINDOW = _env_int("BUDDY_ACCOUNT_THREAD_WINDOW", 30)
   BUDDY_ACCOUNT_THREAD_HISTORY_CHARS = _env_int("BUDDY_ACCOUNT_THREAD_HISTORY_CHARS", 24000)
   ```
   Hydration depth (`account_thread_context.DEFAULT_MAX_TURNS`) was raised 24 -> 40
   so the 30-window is never starved.

2. **Trim carve-out (REQUIRED, not in the original Part A).** The `/ask` handler
   ran `_trim_session_history(session.messages, char_limit=1200, msg_limit=5)`
   on **both** branches, which would have nuked the hydrated thread down to 5
   messages immediately. Both calls are now account-thread-aware:
   `msg_limit = BUDDY_ACCOUNT_THREAD_WINDOW + 1`,
   `char_limit = BUDDY_ACCOUNT_THREAD_HISTORY_CHARS` for account threads;
   anonymous public traffic is unchanged (5 / 1200).

3. Part B is folded in: `_web_messages_for(..., *, max_recent=4)`, the pending
   entry carries `account_thread`, and the drainer feeds
   `max_recent=BUDDY_ACCOUNT_THREAD_WINDOW` for account threads.

**Cloudflare dependency (blocks true >24 depth):** the surface
`compactThreadMessages` currently forwards only the **last 24** messages in
`extras.thread_messages`. The backend can now hold/feed 30, but it can only
hydrate what CF sends — so until `askbuddy.js` raises that forward cap, the
effective ceiling is 24. Raise both in lockstep to actually reach 30. This is
the only remaining piece outside this repo.

**Caveat — in-memory hydration:** hydration mutates the live `session` object;
the drainer prefers `sessions.get(sid)` (same object), so the common
single-process path works. If the session is evicted between enqueue and drain
and restored from `buddy_store` (which does not persist the surface thread),
hydration is lost for that turn and recovers on the next. Acceptable for alpha;
flag if you want it persisted.

### Apply
```bash
cd /home/buddy_ai/Buddy
git fetch origin claude/opus-4.8-memory-review-ktBCy
git show origin/claude/opus-4.8-memory-review-ktBCy:for-opus-4.8/buddy/core/account_thread_context.py > core/account_thread_context.py
git show origin/claude/opus-4.8-memory-review-ktBCy:for-opus-4.8/buddy/tests/test_account_thread_context.py > tests/test_account_thread_context.py
git show origin/claude/opus-4.8-memory-review-ktBCy:for-opus-4.8/APPLY_03_account_thread.patch > /tmp/acct.patch
git apply --check -v /tmp/acct.patch   # exit 0 = clean (touches buddy_api.py only)
git apply /tmp/acct.patch
python3 -m pytest tests/test_account_thread_context.py -q   # expect 14 passed
python3 -m py_compile buddy_api.py
```
Note: the patch's `account_thread_context.py` hunk and the two `git show`
copies above are the same file — if you copy the file you can drop that hunk,
or just let `git apply` handle both (apply the patch, skip the manual copy of
that one file). `buddy_api.py` is only ever touched by the patch.
