# INGESTION_GATE.md

## Gate statement

Every public interaction that produces a Buddy or Lil Homie response must
pass through the shared ingestion pipeline before completion. No response
path is allowed to bypass write, triage, indexing, and judge eligibility.

## Enforcement

- The sole bridge from Cloudflare Functions to the Lil Homie backend is
  `functions/_lib/ingest.js`, specifically `callLilHomie(...)`.
- Any CF route handler that produces a Buddy or Lil Homie response MUST
  call `callLilHomie` and MUST NOT `fetch` the Lil Homie URL, Anthropic,
  or any other model backend directly.
- Strategy: **strict fail-closed**. If the backend does not return
  `corpus_written: true`, the helper returns a structured failure and the
  route returns a controlled error to the visitor. No silent success.

## Current public surfaces (Cycle 5 audit)

| Surface             | File                                 | Endpoint              | Status       |
|---------------------|--------------------------------------|-----------------------|--------------|
| ask                 | `functions/api/askbuddy.js`          | Lil Homie `/ask`      | Gated        |
| joke                | `functions/api/joke.js`              | Lil Homie `/joke`     | Gated        |

No other CF function produces a Buddy or Lil Homie response.

`functions/api/broke-gary.js` calls Anthropic directly — this is **Gary**
(pressure-test Layer 4, locked separate via `gary_layer_4_permanent`), not
Buddy. Gary is out of scope for the Buddy/Lil Homie ingestion gate.

`functions/api/anchorforge/gate.js` calls Anthropic for an epistemic read
on third-party AI output. Not a Buddy surface. Out of scope.

## Backend contract

The Lil Homie backend is expected to:

1. Receive `{ request_id, timestamp, surface, session_id, user_input, ...extras }`.
2. Generate the response.
3. Write the turn (raw user input + raw model output + triage metadata) to
   the conversation corpus.
4. Append a line to the anomaly index.
5. Set the judge-eligible flag.
6. Return a JSON body with `corpus_written: true` alongside the
   surface-specific answer fields.

If any of steps 3–5 fail, the backend must NOT return `corpus_written: true`.

## Adding a new surface

When adding a new public surface that produces a Buddy or Lil Homie
response, the route handler MUST:

1. `import { callLilHomie } from '../_lib/ingest.js';`
2. Pass a stable, descriptive `surface` string (e.g. `'daily'`, `'hero'`).
3. Pass the raw user input via `userInput`.
4. Pass `sessionId` when available.
5. On `!ingest.ok`, return a controlled error. Do not synthesize an answer.
