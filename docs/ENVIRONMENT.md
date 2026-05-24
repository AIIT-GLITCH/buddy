# Environment Inventory

This file lists Cloudflare Pages bindings and secrets by name only. Do not
commit values. Configure values in Cloudflare Pages dashboard for project
`buddy-bb4`.

Production and preview have separate environment settings. A variable present
in production is not automatically present in preview.

## Core Bindings And Secrets

| Name | Purpose | Production | Preview | Missing Symptom |
| --- | --- | --- | --- | --- |
| `AUTH_KV` | GitHub OAuth sessions, pro status, Buddy thread records, reports, paper-game collection, leaderboard fallback storage | Required for account features | Required for preview auth/account testing | Login loops, `auth_kv_missing`, paper-game sync fails, thread export fails |
| `JOKE_KV` | Joke route per-minute throttle; fallback AskBuddy throttle/log KV when `ASKBUDDY_USAGE` is absent | Recommended | Optional | Joke route still works if Buddy is configured, but edge throttling/logging is reduced |
| `ASKBUDDY_USAGE` | AskBuddy per-client and global throttle plus short-lived usage logs | Recommended | Optional | AskBuddy can run without edge throttle if no fallback KV exists |
| `BUDDY_BACKEND_URL` | Cloudflare Tunnel/Access URL for Buddy backend | Required for AskBuddy/Joke | Required for preview AskBuddy/Joke | `buddy_not_configured` or "buddy backend missing" |
| `BUDDY_CF_ACCESS_CLIENT_ID` | Cloudflare Access service token client id for Buddy backend | Required for AskBuddy/Joke | Required for preview AskBuddy/Joke | Buddy backend rejects or route returns not configured |
| `BUDDY_CF_ACCESS_CLIENT_SECRET` | Cloudflare Access service token client secret for Buddy backend | Required for AskBuddy/Joke | Required for preview AskBuddy/Joke | Buddy backend rejects or route returns not configured |
| `BUDDY_BACKEND_TOKEN` | Optional backend bearer token when Buddy requires a second auth check | Depends on backend policy | Depends on backend policy | Buddy may return auth failure even when Cloudflare Access succeeds |
| `BUDDY_WEB_ASK_TOKEN` | Legacy Buddy web ask token name, not read by current source | No, unless legacy backend still expects it outside this repo | No | No current repo symptom; document external use before relying on it |
| `DEV_BYPASS` | Optional admin bypass for AskBuddy/Joke route throttles | Optional | Optional | Admin bypass header/body token has no effect |

## GitHub OAuth

| Name | Purpose | Production | Preview | Missing Symptom |
| --- | --- | --- | --- | --- |
| `GITHUB_CLIENT_ID` | GitHub OAuth app client id | Required for login | Required for preview login | `/api/auth/github/login` returns OAuth not configured |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth app client secret | Required for login callback | Required for preview login callback | Callback token exchange fails |

Preview OAuth callback setup is documented in `docs/PREVIEW_AUTH_SETUP.md`.

## Commerce And Stripe

| Name | Purpose | Production | Preview | Missing Symptom |
| --- | --- | --- | --- | --- |
| `STRIPE_SECRET_KEY` | Verifies Checkout sessions for download and purchase success routes | Required for paid flows | Optional unless testing paid flows | Download/verify purchase routes reject or redirect |
| `STRIPE_WEBHOOK_SECRET` | Verifies Stripe webhook signatures | Required for webhook | Optional unless testing webhook | Webhook returns `webhook secret not configured` |
| `NOTIFY_FROM` | Sender address for payment/report notifications | Optional | Optional | Defaults to source-defined sender address |

## Gary And AnchorForge

| Name | Purpose | Production | Preview | Missing Symptom |
| --- | --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | Gary free-call bridge and AnchorForge adjudication model access | Required for those routes | Optional unless testing those routes | `broke-gary not configured` or AnchorForge server misconfigured |
| `BROKE_GARY_SECRET` | HMAC secret for Gary free-call and Gary write cookies | Required for Gary free-call/write routes | Optional unless testing those routes | Gary gate/write routes return not configured |
| `GARY_MEMORY` | KV namespace for per-user Gary memory | Required for Gary memory | Optional unless testing Gary memory | `gary-memory not configured` |
| `GITHUB_PAT` | Fine-grained GitHub token for `/api/gary-write` repository writes | Required for Gary write | Usually disabled in preview | `gary-write not configured` |
| `OWNER_LOGIN` | GitHub login allowed to use `/api/gary-write` | Required for Gary write | Usually disabled in preview | `auth not configured` or owner-only rejection |
| `GITHUB_WRITE_TOKEN` | GitHub token used by AnchorForge to write site-gated logs | Required for AnchorForge gate | Optional unless testing AnchorForge | AnchorForge returns `server_misconfigured` |
| `ANCHORFORGE_KV` | KV namespace for AnchorForge rate limits | Recommended | Optional | AnchorForge still runs but per-period rate limiting is not enforced |

## Reports And Email

| Name | Purpose | Production | Preview | Missing Symptom |
| --- | --- | --- | --- | --- |
| `REPORTS_TO` | Comma-separated Buddy report recipients | Optional | Optional | Uses source default recipient |
| `REPORTS_FROM` | Sender address for Buddy reports | Optional | Optional | Uses `NOTIFY_FROM` or source default |
| `REPORTS_DELIVERY_TO` | Verified destination for report mailer service binding | Optional | Optional | Uses source default |
| `REPORT_MAILER` | Cloudflare service binding to internal report mailer Worker | Optional | Optional | Falls back to other email methods or reports stored without mail delivery |
| `CF_EMAIL_API_TOKEN` | Cloudflare Email Sending token | Optional | Optional | Cloudflare email fallback unavailable |
| `CLOUDFLARE_EMAIL_API_TOKEN` | Alternate Cloudflare Email Sending token name | Optional | Optional | Cloudflare email fallback unavailable |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account id for Email Sending | Optional | Optional | Uses source default if present |
| `MAILCHANNELS_API_KEY` | MailChannels Email API key for Buddy reports | Optional | Optional | MailChannels report delivery unavailable |

## Lil Homie Legacy Bridge

| Name | Purpose | Production | Preview | Missing Symptom |
| --- | --- | --- | --- | --- |
| `LIL_HOMIE_URL` | Optional override for Lil Homie backend URL in the shared ingestion helper | Legacy/conditional | Legacy/conditional | Only affects routes intentionally using `callLilHomie` |
| `LIL_HOMIE_TOKEN` | Bearer token for Lil Homie ingestion helper | Legacy/conditional | Legacy/conditional | `lilhomie_not_configured` for routes intentionally using `callLilHomie` |

Current guarded Buddy surfaces should route through `callBuddy`, not direct
Lil Homie calls.

## Text/SMS Alert Lane

No `TEXTNOW_*` or equivalent alert-lane secrets are referenced by this repo at
the time of this inventory. If the alert lane is configured outside this repo,
document the exact variable names and owner in this file before treating it as
rebuildable.
