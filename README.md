# AIIT Site / Buddy Web Surface

This repository is the public AIIT/Buddy web surface. It is an Astro site with
Cloudflare Pages Functions for interactive endpoints such as Ask Buddy, joke,
paper browsing, downloads, and public demos.

It is not the full local Buddy runtime, not the model weights, and not the
Kokoro memory store. The web surface routes into the canonical Buddy/Lil Homie
backend and memory systems.

## Start Here

Read these files before changing Buddy-facing behavior:

- `BUDDY_KOKORO_MEMORY.md` - why stateless web surfaces caused identity drift.
- `MEMORY_ARCHITECTURE.md` - Buddy Kokoro memory versus Lil Homie experiential
  memory.
- `INGESTION_GATE.md` - required route pattern for public Buddy/Lil Homie
  responses.
- `DEV_ARCHITECTURE.md` - surface versus substrate architecture and response
  shape.
- `PAPERS_SCHEMA.md` - paper/catalog structure.

Core identity rule:

```text
Rhet Wike built Buddy.
AIIT-THRESHOLD is the house, site, and system context.
It is not the builder.
```

If a Buddy web surface answers otherwise, the surface is broken.

## What This Repo Contains

```text
src/                  Astro pages and UI components
functions/api/        Cloudflare Pages API routes
functions/_lib/       Shared route helpers, including ingestion bridge
public/               Static assets, downloads, papers, flyers, icons
docs/                 Deployment, environment, API, and incident docs
scripts/              Build guards, paper index generation, version stamping
transcripts/          Captured agent/session transcripts with checksums
```

Important public Buddy routes:

- `functions/api/askbuddy.js`
- `functions/api/askbuddy_poll.js`
- `functions/api/joke.js`
- `functions/_lib/ingest.js`

Any route that returns a Buddy or Lil Homie answer must use the ingestion
bridge. Do not add a direct model call or a stateless prompt fallback for a
Buddy surface.

## Local Development

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
```

The build runs route guards and paper indexing before `astro build`.

Useful scripts:

```bash
npm run guard:buddy
npm run index
npm run preview
```

## Deployment

This is an Astro project intended for Cloudflare Pages.

- Build command: `npm run build`
- Output directory: `dist`
- Production branch: `master`
- Production domain: `https://aiit-threshold.com`

Deployment docs live in:

- `docs/DEPLOYMENT.md`
- `docs/ENVIRONMENT.md`
- `docs/API_SURFACES.md`
- `docs/INCIDENT_RUNBOOK.md`
- `docs/PREVIEW_AUTH_SETUP.md`
- `docs/SNAPPY_NAV_STANDARD.md`

Cloudflare dashboard bindings and secrets are required for runtime behavior.
The static build can pass while AskBuddy, OAuth, Stripe, Gary, or Paper Game
features fail at runtime if dashboard configuration is missing.

Never commit `.env`, secret values, Cloudflare Access tokens, Stripe secrets,
GitHub tokens, local logs, `dist/`, or `node_modules/`.

## Identity And Memory Rules

Buddy identity is not defined by this website. The site must preserve and route
to the canonical memory layer.

Load order must remain:

```text
1. Kokoro identity/cognition
2. Lil Homie experience
3. Current session input
```

The historical failure mode documented in `BUDDY_KOKORO_MEMORY.md` was a
stateless Cloudflare surface acting like Buddy without loading the identity
surface. Future changes must not recreate that failure mode.

## For Agents

Before modifying any Buddy-facing endpoint:

1. Read `BUDDY_KOKORO_MEMORY.md`.
2. Read `INGESTION_GATE.md`.
3. Inspect the current route implementation.
4. Preserve the ingestion bridge.
5. Do not create direct model fallbacks for Buddy identity or Buddy responses.

This repo is a public surface for a memory-backed system, and the routing layer
is part of the identity safety boundary.
