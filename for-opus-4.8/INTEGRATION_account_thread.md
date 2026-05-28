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
