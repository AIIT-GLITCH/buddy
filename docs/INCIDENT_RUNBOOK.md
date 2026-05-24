# Incident Runbook

This runbook covers the public AIIT site, Cloudflare Pages Functions, and the
Cloudflare dashboard configuration required by this repo. Do not paste secrets
into terminals, commits, issue comments, prompts, or screenshots.

## AskBuddy Public Route Failing

Symptoms:

- `/ask-buddy/` loads but answers return "buddy is offline" or
  `buddy_not_configured`.
- `/api/askbuddy` returns `forbidden_origin`, `rate_limited`,
  `traffic_surge`, `corpus_write_failed`, or backend missing.

Likely causes:

- Missing `BUDDY_BACKEND_URL`, `BUDDY_CF_ACCESS_CLIENT_ID`, or
  `BUDDY_CF_ACCESS_CLIENT_SECRET`.
- Buddy backend is down or unreachable through Cloudflare Access.
- Backend responded without `corpus_written:true`.
- `ASKBUDDY_USAGE`/`JOKE_KV` throttling is blocking traffic.
- Origin/referrer mismatch from a preview or native wrapper.

Checks:

```bash
npm run build
curl -I https://aiit-threshold.com/ask-buddy/
curl -s https://aiit-threshold.com/api/auth/me
```

Also check Cloudflare Pages Function logs for the deployment and confirm the
Buddy backend health from the backend host, not from this repo.

Rollback/safe action:

- If source changed, roll back the last Cloudflare Pages deployment or revert
  the bad commit.
- If dashboard config changed, restore the last known-good Cloudflare env vars
  and KV bindings.
- If Buddy backend is unhealthy, show the honest offline path and fix backend
  health separately.

What not to do:

- Do not add a direct Anthropic/model fallback for Buddy.
- Do not bypass the ingestion gate.
- Do not disable corpus write confirmation to make the UI look healthy.

## Buddy Backend Reachable But Not Generating

Symptoms:

- Cloudflare Function reaches the backend but returns empty answer,
  `corpus_write_failed`, `buddy_bad_response`, or queue states never resolve.

Likely causes:

- Backend queue pressure.
- Backend auth token mismatch.
- Backend route contract changed.
- Buddy generated but did not confirm corpus ingestion.

Checks:

- Confirm Cloudflare Access service token values are current in dashboard.
- Confirm optional `BUDDY_BACKEND_TOKEN` matches backend policy if required.
- Inspect backend logs for the request id returned by `/api/askbuddy`.
- Verify backend `/ask` and `/ask_poll` response shape includes
  `corpus_written:true` for completed answers.

Rollback/safe action:

- Roll back backend changes if the route contract changed.
- Keep public route fail-closed until corpus write confirmation is restored.

What not to do:

- Do not treat a response as successful without `corpus_written:true`.
- Do not start or restart Buddy from this site repo.

## Cloudflare Pages Deploy Failed

Symptoms:

- Cloudflare Pages build fails.
- Production stays on an older deployment.
- Preview deploy never appears or shows a build error.

Likely causes:

- `npm ci` failure.
- `npm run build` failure.
- Build output directory mismatch.
- Cloudflare project build command drifted from repo docs.

Checks:

```bash
git status -sb
npm ci
npm run build
git diff --check
```

Confirm Cloudflare Pages settings:

- build command: `npm run build`
- output directory: `dist`
- production branch: `master`

Rollback/safe action:

- Leave the last successful Cloudflare deployment active.
- Revert the bad commit or push a fix.
- If the Cloudflare dashboard command drifted, restore it to this runbook.

What not to do:

- Do not commit `dist/`, `node_modules/`, local logs, `.env`, or screenshots.
- Do not edit unrelated dirty files to force a deploy.

## GitHub OAuth Login Broken

Symptoms:

- Login redirects fail.
- Callback returns missing code/state, token exchange failed, or loops back to
  login.
- `/api/auth/me` always returns `{"user":null}` after login.

Likely causes:

- Missing `GITHUB_CLIENT_ID` or `GITHUB_CLIENT_SECRET`.
- Missing `AUTH_KV`.
- GitHub OAuth callback URL mismatch.
- Preview and production OAuth apps are mixed.

Checks:

```bash
curl -s https://aiit-threshold.com/api/auth/me
```

Verify dashboard settings and GitHub OAuth callback:

- Production: `https://aiit-threshold.com/api/auth/github/callback`
- Preview: see `docs/PREVIEW_AUTH_SETUP.md`

Rollback/safe action:

- Restore the previous OAuth app settings or Cloudflare env values.
- Roll back only if source redirect normalization changed.

What not to do:

- Do not commit OAuth client secrets.
- Do not loosen redirect target validation.

## AUTH_KV Missing

Symptoms:

- Login sessions do not persist.
- Paper Game collection returns `auth_kv_missing` or cannot sync.
- Buddy thread export/report fails.
- Pro tier lookup fails.

Likely causes:

- `AUTH_KV` binding absent in production or preview.
- Binding points to the wrong namespace.
- Preview environment lacks bindings that production has.

Checks:

- Inspect Cloudflare Pages project `buddy-bb4` Functions bindings.
- Confirm `AUTH_KV` exists separately for production and preview.
- Use `/api/auth/me` while logged out and logged in.

Rollback/safe action:

- Re-bind `AUTH_KV` to the last known-good namespace.
- If a namespace was deleted, restore from Cloudflare/account backup if
  available and treat session loss as an account incident.

What not to do:

- Do not create a new empty namespace and call the incident fixed without
  accepting session/data loss.
- Do not store session data in source files.

## Paper Game Sync Broken

Symptoms:

- Collection does not save.
- User sees login required or `auth_kv_missing`.
- Collected slugs vanish between sessions.

Likely causes:

- User is not logged in.
- `AUTH_KV` missing or wrong namespace.
- Browser is blocking cookies.
- Preview OAuth not configured.

Checks:

```bash
curl -I https://aiit-threshold.com/paper-game/
curl -s https://aiit-threshold.com/api/auth/me
```

In browser, confirm login state and watch network calls to
`/api/paper-game/collection`.

Rollback/safe action:

- Restore `AUTH_KV` binding or OAuth settings.
- Roll back only if the paper-game page or collection endpoint changed.

What not to do:

- Do not write collection state to localStorage as the only source of truth for
  logged-in users.
- Do not merge a fix that bypasses auth.

## Stripe Webhook Failed

Symptoms:

- Stripe dashboard shows webhook failures.
- Pro tier is not activated.
- Paid download verification fails.
- Webhook returns invalid signature or secret not configured.

Likely causes:

- Missing `STRIPE_WEBHOOK_SECRET`.
- Wrong webhook secret for production versus preview/test.
- Missing `AUTH_KV`.
- Stripe secret key mismatch for paid download verification.

Checks:

- Inspect Stripe webhook event delivery status.
- Confirm Cloudflare Function logs for `/api/stripe/webhook`.
- Confirm `STRIPE_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY`, and `AUTH_KV` in
  Cloudflare dashboard.

Rollback/safe action:

- Restore previous Stripe webhook secret or endpoint config.
- Replay failed Stripe events after fixing the root cause.
- If source changed, roll back the deployment before replaying.

What not to do:

- Do not disable signature verification.
- Do not paste Stripe secrets into logs or prompts.

## Text/SMS Alert Lane Failed

Symptoms:

- Expected sale/report/incident text alerts do not arrive.
- Email notifications work but SMS gateway delivery does not.

Likely causes:

- Alert lane is outside this repo and not documented.
- MailChannels/Cloudflare Email sending is unavailable.
- Carrier gateway addresses or sender policy changed.

Checks:

- Confirm whether alert-lane secrets are configured in Cloudflare or another
  automation host.
- Check Cloudflare Function logs for report/payment notification errors.
- Verify email delivery provider status.

Rollback/safe action:

- Restore previous notification env values in the owning service.
- Keep payment/report storage active even if notification delivery is degraded.

What not to do:

- Do not hard-code private phone numbers, tokens, or alert credentials into new
  source files.
- Do not block checkout/report success solely because alert delivery failed.

## Emergency Rollback

Use this when production is user-visible broken and a source change is the
likely cause.

Steps:

1. Open Cloudflare Pages project `buddy-bb4`.
2. Go to Deployments.
3. Promote the last known-good production deployment.
4. Run smoke checks from `docs/DEPLOYMENT.md`.
5. Create a git revert PR for the bad commit.

Safe command path:

```bash
git status -sb
git revert <bad-commit-sha>
npm run build
git diff --check
git push origin <rollback-branch>
```

What not to do:

- Do not use `git reset --hard` in a dirty working tree.
- Do not delete KV namespaces.
- Do not rotate secrets unless compromise is suspected.
- Do not modify Buddy runtime/tunnel wiring from this site repo.
