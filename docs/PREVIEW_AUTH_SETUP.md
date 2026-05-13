# Preview Auth Setup

Paper Game collection sync uses the same account session model as the existing
GitHub auth flow. Cloudflare Pages Preview needs its own OAuth variables and KV
binding before the preview login flow can work.

The collection API reads the existing `aiit_session` cookie and loads the
matching `session:{id}` record from `AUTH_KV`; it does not use a separate auth
store.

## Required Cloudflare Pages Preview Environment Variables

- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`

## Required Cloudflare Pages Preview KV Binding

- `AUTH_KV`

## OAuth Callback URLs

Preview OAuth callback URL for the `feature/account-backed-paper-game` PR branch:

```text
https://feature-account-backed-paper-game.buddy-bb4.pages.dev/api/auth/github/callback
```

Production OAuth callback URL:

```text
https://aiit-threshold.com/api/auth/github/callback
```

## Setup Notes

- Do not commit the GitHub client secret.
- Do not put secrets in source files.
- Configure secrets in Cloudflare Dashboard under Workers & Pages -> `buddy-bb4`
  -> Settings -> Environment variables -> Preview.
- Preview and Production environment variables and bindings are separate in
  Cloudflare Pages.
- After the Preview environment variables are added, retry `LOGIN` on the
  preview deploy.
- If GitHub then reports a redirect URI mismatch, temporarily set the GitHub
  OAuth app callback URL to the preview callback above, or use a separate
  preview OAuth app.
