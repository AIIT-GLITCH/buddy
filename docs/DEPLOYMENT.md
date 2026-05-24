# Deployment

This repo is the public AIIT/Buddy web surface. It is intended to deploy on
Cloudflare Pages as a static Astro site with Cloudflare Pages Functions.

## Cloudflare Pages Target

- Cloudflare Pages project: `buddy-bb4`
- Production domain: `https://aiit-threshold.com`
- Production branch: `master`
- Build command: `npm run build`
- Output directory: `dist`
- Runtime: Cloudflare Pages static hosting plus Pages Functions under
  `functions/`

The Cloudflare dashboard must provide the environment variables and KV bindings
documented in `docs/ENVIRONMENT.md`. The repo does not contain secret values.

## Required Runtime Configuration

Required KV bindings for normal production behavior:

- `AUTH_KV`
- `ASKBUDDY_USAGE` or `JOKE_KV`
- `GARY_MEMORY` if Gary memory is enabled
- `ANCHORFORGE_KV` if AnchorForge rate limits are enabled

Required secrets/env vars for core public behavior:

- `BUDDY_BACKEND_URL`
- `BUDDY_CF_ACCESS_CLIENT_ID`
- `BUDDY_CF_ACCESS_CLIENT_SECRET`
- `BUDDY_BACKEND_TOKEN` when required by the Buddy backend
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`

Required secrets/env vars for optional paid or tool surfaces:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `ANTHROPIC_API_KEY`
- `BROKE_GARY_SECRET`
- `GITHUB_PAT`
- `GITHUB_WRITE_TOKEN`
- `OWNER_LOGIN`

See `docs/ENVIRONMENT.md` for purpose, preview requirements, and missing-value
symptoms for each item.

## Local Build

```bash
npm ci
npm run build
```

`npm run build` runs the Buddy route guard, rebuilds the paper index, runs
Astro, injects paper-game sync assets, and writes the version stamp.

## Expected Cloudflare Behavior

Cloudflare Pages should:

- install dependencies from `package-lock.json`
- run `npm run build`
- publish `dist/`
- serve static assets through Cloudflare CDN
- serve API routes from `functions/api/`
- apply cache and redirect rules from `public/_headers` and `public/_redirects`

Cloudflare Pages does not rebuild or repair dashboard configuration. Missing
KV bindings, OAuth secrets, Stripe secrets, or Buddy backend access credentials
will produce runtime failures after a successful static build.

## Preview Deploys

Preview deploys are expected for pull requests and non-production branches if
the Cloudflare Pages GitHub integration is enabled.

Preview auth requires separate preview values for:

- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `AUTH_KV`

See `docs/PREVIEW_AUTH_SETUP.md` for the preview OAuth callback and setup
notes. Preview and production dashboard settings are separate.

## Production Deploys

Production deploys are expected from `master`.

Before merging to `master`:

```bash
npm ci
npm run build
git diff --check
```

After merge, confirm the Cloudflare Pages deployment completed and that the
commit SHA in Cloudflare matches the merged commit.

## Post-Deploy Smoke Checks

Use a browser for page checks and `curl` for API checks. Do not include secrets
in terminal history.

```bash
curl -I https://aiit-threshold.com/
curl -I https://aiit-threshold.com/ask-buddy/
curl -I https://aiit-threshold.com/paper-game/
curl -I https://aiit-threshold.com/agentic/
curl -I https://aiit-threshold.com/data-policy/
curl -s https://aiit-threshold.com/api/auth/me
curl -s https://aiit-threshold.com/api/leaderboard/flap
```

Expected results:

- `/` returns 200.
- `/ask-buddy/` returns 200 and the UI loads without console boot errors.
- `/paper-game/` returns 200 and does not show sync/auth errors before login.
- `/agentic/` returns 200 and media assets load.
- `/data-policy/` returns 200.
- `/api/auth/me` returns JSON, normally `{"user":null}` when logged out.
- `/api/leaderboard/flap` returns JSON with a `scores` array.

For AskBuddy behavior, use the site UI after verifying the Buddy backend is
healthy. Avoid load testing the public route from a shell.

## Rollback

Preferred rollback:

1. Open Cloudflare Pages project `buddy-bb4`.
2. Go to Deployments.
3. Select the last known-good production deployment.
4. Use Cloudflare Pages rollback/promote controls to restore it.
5. Run the smoke checks above.

Git rollback:

```bash
git revert <bad-commit-sha>
git push origin master
```

Only use git rollback when the problem is in committed source. If the problem
is a dashboard secret, KV binding, OAuth callback, or Cloudflare Access policy,
fix the dashboard setting instead of reverting source.

What not to do during rollback:

- Do not edit Buddy runtime or tunnel wiring from this repo.
- Do not paste secrets into commits, issues, prompts, or logs.
- Do not disable the Buddy ingestion gate to make a page look healthy.
- Do not replace a failing Buddy route with a direct model fallback.
