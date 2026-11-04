# Jilact — TikTok OAuth connection (phase 1)

This package adds the secure TikTok account connection flow to the existing Jilact site. It does **not** yet implement Direct Post publishing. Keep the TikTok app in Draft and do not submit it for review until the complete publishing UX and demo video are ready.

## Files in this package

- `index.html`, `sw.js`: updated front end with TikTok Connect/Disconnect status in Settings.
- `supabase/migrations/20261103_tiktok_accounts.sql`: private table for encrypted TikTok refresh tokens.
- `supabase/functions/tiktok-oauth-start/index.ts`: authenticated OAuth start; owner/admin only.
- `supabase/functions/tiktok-oauth-callback/index.ts`: public callback; validates one-time state and encrypts refresh token.
- `supabase/functions/tiktok-account-status/index.ts`: returns safe account status only.
- `supabase/functions/tiktok-disconnect/index.ts`: removes the local token record; user should also revoke access in TikTok settings.
- `supabase/config.toml`: JWT settings; callback is the only public function.

## 1. Apply the database migration

In Supabase Dashboard → SQL Editor → New query, run the complete contents of `supabase/migrations/20261103_tiktok_accounts.sql` once.

## 2. Add Supabase Function secrets

In Supabase Dashboard → Edge Functions → Secrets (or Project Settings → Edge Functions → Secrets), add:

- `TIKTOK_CLIENT_KEY` — TikTok app Client Key.
- `TIKTOK_CLIENT_SECRET` — TikTok app Client Secret.

Do not paste either value into GitHub, the browser code, or this chat. `APP_ORIGIN` and `YOUTUBE_TOKEN_ENCRYPTION_KEY` are already used by the existing YouTube integration; the TikTok callback reuses the same AES-256 key. Keep its value backed up and private. The platform-provided `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` must remain available to Edge Functions; never expose the service-role key.

Set/confirm `APP_ORIGIN` is exactly:

`https://jilact-vercel-v2.vercel.app`

## 3. Deploy the four functions

In Edge Functions, create/deploy these function names with the corresponding `index.ts` from this package:

1. `tiktok-oauth-start` — JWT verification **ON**.
2. `tiktok-oauth-callback` — JWT verification **OFF** (TikTok redirects here without a Supabase session).
3. `tiktok-account-status` — JWT verification **ON**.
4. `tiktok-disconnect` — JWT verification **ON**.

The callback must be deployed at exactly:

`https://drnuprrxyoeqmyjrisyc.supabase.co/functions/v1/tiktok-oauth-callback`

This must exactly match the URI already entered in TikTok Login Kit → Web.

## 4. Update the GitHub website

On the same branch Vercel deploys, replace only the existing `index.html` and `sw.js` with the versions in this package. Keep `terms.html`, `privacy.html`, the TikTok verification file, `icon.svg`, and all media assets. Wait until the Vercel deployment says Ready.

## 5. Test the connection

After the database migration, secrets, and functions are ready, open Jilact, sign in, go to Settings → TikTok → Connect, and authorize only the scopes displayed in TikTok. Check that the TikTok display name appears in Jilact and that Disconnect removes the local connection record. Do not test Direct Post yet: publishing endpoints and the final user-consent flow are a separate phase.

Because this app is not yet audited, TikTok may limit test posts to private visibility. Do not submit the app for review yet.
