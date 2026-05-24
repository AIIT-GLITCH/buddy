# API Surfaces

This inventory covers Cloudflare Pages Functions under `functions/api/`.
Shared helpers under `functions/_lib/` are not routes.

## Summary

| Route | Method | Auth Model | KV/Storage | Rate Limit | Failure Mode |
| --- | --- | --- | --- | --- | --- |
| `/api/askbuddy` | `POST`, `OPTIONS` | Public route with origin/referrer allowlist; optional dev bypass | `ASKBUDDY_USAGE` or `JOKE_KV` for throttle/logs; `AUTH_KV` for logged-in thread | 4/min per IP/fingerprint and 24/min global when KV exists | JSON error, usually 200 with offline/pressure message or 403 for origin |
| `/api/askbuddy_poll` | `POST`, `OPTIONS` | Public route with origin/referrer allowlist | `AUTH_KV` for logged-in thread persistence | Backend queue pressure only | JSON pending/ready/error frame |
| `/api/joke` | `POST`, `OPTIONS` | Public route with origin/referrer check; optional dev bypass | `JOKE_KV` for throttle | 10/min per visitor when `JOKE_KV` exists | JSON error or offline message |
| `/api/auth/github/login` | `GET` | Public OAuth start | `AUTH_KV` stores OAuth state when bound | None | Redirect to GitHub or 500 missing client id |
| `/api/auth/github/callback` | `GET` | GitHub OAuth callback | `AUTH_KV` stores sessions and consumed state | GitHub OAuth controls | 400/502 text response or login retry redirect |
| `/api/auth/me` | `GET` | Session cookie optional | `AUTH_KV` reads session and pro status | None | JSON `{ "user": null }` and expired cookie cleanup |
| `/api/auth/logout` | `GET`, `POST` | Session cookie optional | `AUTH_KV` deletes session | None | Redirect or JSON `{ "ok": true }` |
| `/api/buddy-thread/thread` | `GET`, `DELETE`, `OPTIONS` | Requires `aiit_session` login | `AUTH_KV` reads/clears user-visible Buddy thread | None | JSON `login_required`, `auth_kv_missing`, or operation error |
| `/api/buddy-thread/report` | `POST`, `OPTIONS` | Requires `aiit_session` login | `AUTH_KV` stores report; optional email providers notify | None | JSON report write/mail status |
| `/api/paper-game/collection` | `GET`, `POST` | GET returns anonymous state if logged out; POST requires login and same-origin | `AUTH_KV` stores collected slugs | None | JSON `login_required`, `auth_kv_missing`, or validation error |
| `/api/leaderboard/flap` | `GET`, `POST` | Public | `AUTH_KV` stores top scores | None | JSON error for bad score/json; empty list if KV missing |
| `/api/gary-memory` | `POST`, `OPTIONS` | Requires logged-in GitHub user via `/api/auth/me` | `GARY_MEMORY` stores per-user Gary memory | Size/count caps only | JSON `gary-memory not configured`, `not logged in`, or corrupt record |
| `/api/gary-write` | `POST`, `OPTIONS` | Requires same-site origin, logged-in owner, `OWNER_LOGIN` match | GitHub Contents API writes repo; signed write cookie | 15 writes/day via signed cookie | JSON auth/config/path/GitHub errors |
| `/api/broke-gary` | `POST`, `OPTIONS` | Public origin check plus signed free-call cookie | Signed cookie only; Anthropic API upstream | 3 free calls per cookie | JSON config/gate errors or upstream Anthropic response |
| `/api/browse` | `POST`, `OPTIONS` | Public origin/referrer check | No persistence | Timeout and 30k char response cap | JSON validation/upstream/fetch error |
| `/api/anchorforge/gate` | `POST` | Requires `aiit_session` login | `ANCHORFORGE_KV` for usage; GitHub repo write for logs | 1/week free, 1/day pro when KV exists | JSON login/rate/config/GitHub/model errors |
| `/api/download` | `GET` | Requires valid paid Stripe Checkout session id | Fetches allowed public zip assets | Stripe API limits | Text 400/403/404 or file download |
| `/api/verify-purchase` | `GET` | Requires valid Stripe Checkout session id | Stripe API only | Stripe API limits | Redirects to product or success page |
| `/api/stripe/webhook` | `POST` | Stripe signature verification | `AUTH_KV` writes/clears pro records; email notification attempt | Stripe retry policy | Text 400/500 or JSON received |

## Data Retention Notes

- AskBuddy stores short throttle counters and short-lived logs in
  `ASKBUDDY_USAGE` or `JOKE_KV` when bound. Logged-in thread turns are stored in
  `AUTH_KV`.
- Buddy thread reports are stored in `AUTH_KV` for review and may include the
  reporter note and selected recent messages.
- Paper Game collection stores normalized paper slugs in `AUTH_KV`.
- Gary memory stores per-user messages, notes, exit state, and counters in
  `GARY_MEMORY`.
- Stripe webhook stores pro/subscription state in `AUTH_KV`; Stripe remains the
  payment source of truth.
- AnchorForge writes submitted raw output and verdict markdown to the configured
  GitHub log repo.

## Endpoint Details

### `/api/askbuddy`

- Route file: `functions/api/askbuddy.js`
- Method: `POST`, `OPTIONS`
- Auth required: No. Logged-in users get account thread persistence.
- KV used: `ASKBUDDY_USAGE` or `JOKE_KV` for throttle/logs; `AUTH_KV` for
  account thread lookup and storage.
- Data stored: throttle counters, short question log snippets, account thread
  messages for logged-in users.
- Rate limit: 4 requests/minute per IP/fingerprint and 24 requests/minute
  global when KV exists.
- Failure mode: fail-closed if Buddy backend is not configured, offline, or does
  not confirm `corpus_written:true`.
- User-visible behavior: JSON with `ok:false` and pressure/offline message.

### `/api/askbuddy_poll`

- Route file: `functions/api/askbuddy_poll.js`
- Method: `POST`, `OPTIONS`
- Auth required: No. Logged-in users can save ready answers to account thread.
- KV used: `AUTH_KV` for logged-in thread persistence.
- Data stored: completed thread turn for logged-in users.
- Rate limit: no edge throttle in this route; Buddy backend queue controls apply.
- Failure mode: returns pending, ready, or JSON error based on Buddy poll result.
- User-visible behavior: JSON status frame.

### `/api/joke`

- Route file: `functions/api/joke.js`
- Method: `POST`, `OPTIONS`
- Auth required: No.
- KV used: `JOKE_KV` for throttle.
- Data stored: throttle counters only in this route.
- Rate limit: 10 requests/minute per visitor when `JOKE_KV` exists.
- Failure mode: fail-closed through Buddy ingestion helper.
- User-visible behavior: JSON reaction or error/offline message.

### Auth Routes

- Route files:
  - `functions/api/auth/github/login.js`
  - `functions/api/auth/github/callback.js`
  - `functions/api/auth/me.js`
  - `functions/api/auth/logout.js`
- Methods: login/callback/me use `GET`; logout uses `GET` and `POST`.
- Auth required: GitHub OAuth for session creation; session cookie for user
  lookup/logout.
- KV used: `AUTH_KV`.
- Data stored: OAuth state, session records, pro lookup.
- Rate limit: none in repo.
- Failure mode: missing env/KV causes login failure or anonymous session result.
- User-visible behavior: redirects, plain text OAuth errors, or JSON user state.

### Buddy Thread Routes

- Route files:
  - `functions/api/buddy-thread/thread.js`
  - `functions/api/buddy-thread/report.js`
- Methods: thread uses `GET`, `DELETE`, `OPTIONS`; report uses `POST`,
  `OPTIONS`.
- Auth required: logged-in GitHub session.
- KV used: `AUTH_KV`.
- Data stored: visible Buddy thread record; user-submitted report records.
- Rate limit: none in repo.
- Failure mode: JSON `login_required`, `auth_kv_missing`, write failure, or mail
  delivery failure.
- User-visible behavior: JSON thread/report status.

### `/api/paper-game/collection`

- Route file: `functions/api/paper-game/collection.js`
- Method: `GET`, `POST`
- Auth required: GET works logged out; POST requires login and same-origin.
- KV used: `AUTH_KV`.
- Data stored: per-user collected paper slugs and update timestamp.
- Rate limit: none in repo.
- Failure mode: JSON `login_required`, `auth_kv_missing`, invalid JSON, or
  forbidden origin.
- User-visible behavior: sync succeeds or collection remains local/unsynced.

### `/api/leaderboard/flap`

- Route file: `functions/api/leaderboard/flap.js`
- Method: `GET`, `POST`
- Auth required: No.
- KV used: `AUTH_KV`.
- Data stored: top 25 score records with name, score, timestamp.
- Rate limit: none in repo.
- Failure mode: bad JSON/score returns 400; missing KV returns empty board and
  drops writes.
- User-visible behavior: leaderboard JSON.

### Gary Routes

- Route files:
  - `functions/api/gary-memory.js`
  - `functions/api/gary-write.js`
  - `functions/api/broke-gary.js`
  - `functions/api/browse.js`
- Auth required:
  - Gary memory requires logged-in user.
  - Gary write requires logged-in owner matching `OWNER_LOGIN`.
  - Broke Gary is public after origin check and signed cookie gate.
  - Browse is public after origin/referrer check.
- KV/storage used:
  - `GARY_MEMORY` for Gary memory.
  - GitHub Contents API for Gary write.
  - signed cookies for free-call/write counters.
  - no persistence for browse.
- Rate limit:
  - Gary write: 15 writes/day by signed cookie.
  - Broke Gary: 3 calls per signed cookie.
  - Browse: timeout and response-size caps.
- Failure mode: JSON auth/config/upstream/path errors.
- User-visible behavior: JSON status or upstream model response.

### `/api/anchorforge/gate`

- Route file: `functions/api/anchorforge/gate.js`
- Method: `POST`
- Auth required: logged-in GitHub session.
- KV used: `ANCHORFORGE_KV` for usage limit; `AUTH_KV` for session/pro lookup.
- Data stored: usage marker in KV; markdown log in GitHub log repo.
- Rate limit: 1/week free and 1/day pro when `ANCHORFORGE_KV` exists.
- Failure mode: JSON login, rate, config, GitHub, or model error.
- User-visible behavior: JSON result with commit URL on success.

### Commerce Routes

- Route files:
  - `functions/api/download.js`
  - `functions/api/verify-purchase.js`
  - `functions/api/stripe/webhook.js`
- Methods: download/verify use `GET`; webhook uses `POST`.
- Auth required: Stripe Checkout session for download/verify; Stripe signature
  for webhook.
- KV/storage used: webhook writes pro records to `AUTH_KV`.
- Data stored: pro/subscription status, customer/subscription ids.
- Rate limit: Stripe retry/API limits.
- Failure mode: invalid session, unpaid session, missing file, invalid webhook
  signature, missing webhook secret.
- User-visible behavior: file download, redirect, or webhook status.
