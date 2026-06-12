# AIIT Site / Buddy Web Surface

This repository is the public AIIT/Buddy web surface. It is an Astro site with
Cloudflare Pages Functions for interactive endpoints such as Ask Buddy, joke,
paper browsing, downloads, and related public demos.

It is not the full local Buddy runtime, not the model weights, and not the
kokoro memory store itself. The web surface is the public interface that must
route correctly into the canonical Buddy backend and memory systems.

## Start Here

Read these files before changing Buddy-facing behavior:

- `BUDDY_KOKORO_MEMORY.md` - why stateless web surfaces caused identity drift,
  and why Buddy identity must come from kokoro canon.
- `MEMORY_ARCHITECTURE.md` - canonical distinction between Buddy kokoro memory
  and Lil Homie experiential memory.
- `INGESTION_GATE.md` - required route pattern for public Buddy responses.
- `DEV_ARCHITECTURE.md` - surface vs substrate architecture and response shape.
- `PAPERS_SCHEMA.md` - paper/catalog structure.

The short version:

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
docs/                 Deployment and preview-auth notes
scripts/              Build guards, paper index generation, version stamping
transcripts/          Captured agent/session transcripts with checksums
```

Important public Buddy routes:

- `functions/api/askbuddy.js`
- `functions/api/joke.js`
- `functions/_lib/ingest.js`

Any route that returns a Buddy answer must use the ingestion bridge. Do not
add a direct model call or a stateless prompt fallback for a Buddy surface.

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

## Identity And Memory Rules

Buddy identity is not defined by this website. The site must preserve and route
to the canonical memory layer.

Core rule:

```text
Kokoro = identity and cognition
Current request = temporary context
```

Load order must remain:

```text
1. Kokoro identity/cognition
2. Current session input
```

Lil Homie is a separate local agent with his own 12-tier memory. He does not
serve the site, and his memory is never loaded for a site response.

The historical failure mode documented in `BUDDY_KOKORO_MEMORY.md` was a
stateless Cloudflare surface acting like Buddy without loading the identity
surface. That is exactly what future changes must avoid.

## Deployment Notes

This is an Astro project intended for Cloudflare Pages.

The repository contains generated/static public artifacts under `public/`.
The `dist/` directory is build output and should not be treated as source of
truth.

Preview authentication and navigation standards live in:

- `docs/PREVIEW_AUTH_SETUP.md`
- `docs/SNAPPY_NAV_STANDARD.md`

## For Agents

Before modifying any Buddy-facing endpoint:

1. Read `BUDDY_KOKORO_MEMORY.md`.
2. Read `INGESTION_GATE.md`.
3. Inspect the current route implementation.
4. Preserve the ingestion bridge.
5. Do not create direct model fallbacks for Buddy identity or Buddy responses.

This repo is easy to misread as "just a website." It is not. It is a public
surface for a memory-backed system, and the routing layer is part of the
identity safety boundary.
