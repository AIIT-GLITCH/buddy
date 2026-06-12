# INGESTION_GATE.md

## Gate statement

Every public interaction that produces a Buddy response must pass through the
shared ingestion pipeline before completion. No response path is allowed to
bypass write, triage, indexing, and judge eligibility.

## Enforcement

- The sole bridge from Cloudflare Functions to the Buddy backend is
  `functions/_lib/ingest.js`, specifically `callBuddy(...)` (and
  `callBuddyPoll(...)` for pending-answer polling).
- Any CF route handler that produces a Buddy response MUST call `callBuddy`
  and MUST NOT `fetch` the Buddy backend URL, Anthropic, or any other model
  backend directly.
- Buddy v4 is exposed only through Cloudflare Tunnel + Access
  (`BUDDY_BACKEND_URL` + `BUDDY_CF_ACCESS_CLIENT_ID/SECRET`).
- Lil Homie does NOT serve any site surface. He is a separate local agent
  with separate memory; no site route may call him. (Corrected 2026-06-12 —
  the old `callLilHomie` bridge was dead code and has been removed. The build
  guard `scripts/guard-buddy-routes.mjs` rejects any reintroduction.)
- Strategy: **strict fail-closed**. If the backend does not return
  `corpus_written: true`, the helper returns a structured failure and the
  route returns a controlled error to the visitor. No silent success.

## Current public surfaces

| Surface             | File                                 | Endpoint              | Status       |
|---------------------|--------------------------------------|-----------------------|--------------|
| ask                 | `functions/api/askbuddy.js`          | Buddy v4 `/ask`       | Gated        |
| ask_poll            | `functions/api/askbuddy_poll.js`     | Buddy v4 `/ask_poll`  | Gated (poll) |
| joke                | `functions/api/joke.js`              | Buddy v4 `/ask`       | Gated        |

`ask_poll` intentionally bypasses the `corpus_written` requirement for
`pending` responses only — a pending poll writes no new corpus data. `ready`
responses must still carry `corpus_written: true`.

No other CF function produces a Buddy response.

`functions/api/broke-gary.js` calls Anthropic directly — this is **Gary**
(pressure-test Layer 4, locked separate via `gary_layer_4_permanent`), not
Buddy. Gary is out of scope for the Buddy ingestion gate.

`functions/api/anchorforge/gate.js` calls Anthropic for an epistemic read
on third-party AI output. Not a Buddy surface. Out of scope.

## Backend contract

The Buddy v4 backend is expected to:

1. Receive `{ request_id, timestamp, surface, sessionId, userInput, extras }`.
2. Generate the response.
3. Write the turn (raw user input + raw model output + triage metadata) to
   the conversation corpus.
4. Append a line to the anomaly index.
5. Set the judge-eligible flag.
6. Return a JSON body with `corpus_written: true` alongside the
   surface-specific answer fields.

If any of steps 3–5 fail, the backend must NOT return `corpus_written: true`.

## Adding a new surface

When adding a new public surface that produces a Buddy response, the route
handler MUST:

1. `import { callBuddy } from '../_lib/ingest.js';`
2. Pass a stable, descriptive `surface` string (e.g. `'daily'`, `'hero'`).
3. Pass the raw user input via `userInput`.
4. Pass `sessionId` when available.
5. On `!ingest.ok`, return a controlled error. Do not synthesize an answer.
