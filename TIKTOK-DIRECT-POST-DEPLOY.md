# Jilact TikTok Direct Post — deployment and Sandbox test

This package adds **TikTok Direct Post** to the existing Jilact TikTok OAuth connection. It does not use `video.upload`, does not schedule unattended TikTok publishing, and does not change the Production app from Draft.

## What the user flow does

1. A creator schedules a TikTok video reminder in Jilact with an uploaded video.
2. At or after its scheduled local time, Jilact surfaces an in-app reminder (and a browser notification only if permission was already granted) and the card offers **Publier sur TikTok**. If the app was closed, the due reminder is surfaced the next time it is opened. Nothing is sent before the user acts.
3. On click, Jilact fetches fresh TikTok creator permissions, checks `can_post_video`, reads the saved video duration, and checks TikTok's duration limit.
4. Jilact shows the TikTok creator nickname, caption, scheduled time, and a privacy selector with **no preselected value**. The user must choose a privacy setting and then click **Confirmer et envoyer**.
5. Only that confirmation initializes Direct Post. Video chunks are transferred server-side through a Supabase Edge Function to avoid browser CORS restrictions, then Jilact checks the TikTok publish status.

There is no background job or automatic scheduler for TikTok.

## Files to deploy

### Jilact website (Vercel/GitHub)

Replace the production site's `index.html` and `sw.js` with these files from this package. Keep the existing `config.js`, legal pages, icons, and other site assets. The service-worker cache key is bumped to `jilact-shell-tiktok-v6` so clients receive the updated interface.

### Four new Supabase Edge Functions

Create/deploy each folder from `supabase/functions/` in the Supabase dashboard (or the team's existing deployment workflow):

| Function | Source file | Verify JWT |
|---|---|---|
| `tiktok-creator-info` | `supabase/functions/tiktok-creator-info/index.ts` | On |
| `tiktok-publish-init` | `supabase/functions/tiktok-publish-init/index.ts` | On |
| `tiktok-publish-status` | `supabase/functions/tiktok-publish-status/index.ts` | On |
| `tiktok-upload-chunk` | `supabase/functions/tiktok-upload-chunk/index.ts` | On |

The matching `supabase/config.toml` entries are included. All four use the existing `APP_ORIGIN`, which must remain exactly `https://jilact-vercel-v2.vercel.app`.

## Secrets and database

- Keep `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET` set to the **Sandbox** values for this test. Never put either in the website, GitHub, or a chat.
- The existing `YOUTUBE_TOKEN_ENCRYPTION_KEY`, Supabase URL, anon key, and service-role key are also used by the functions. Do not expose the service-role key.
- No new SQL migration is required: this code uses the existing `posts.platform_content`, `posts.media_path`, `posts.scheduled_at`, `workspace_members`, and `tiktok_accounts` schema.
- Leave TikTok Production in Draft. Do not submit it for review yet.

## Safe Sandbox test checklist

1. Deploy the website files and all four functions. Confirm all four functions are active and JWT verification is on.
2. Open Jilact, sign in, and confirm TikTok still shows **Synchronisé**.
3. Create a one-off TikTok reminder with a small, non-sensitive video, a caption, and a scheduled time a few minutes ahead. Keep TikTok selected; do not rely on a YouTube reminder or a background task.
4. After the scheduled time, open the post and click **Publier sur TikTok**.
5. Confirm the dialog shows the connected creator nickname and video duration. Manually select the privacy level returned by TikTok; then choose **Confirmer et envoyer**. Canceling the dialog must not initiate a post.
6. Wait for the transfer and status check. If TikTok is still processing, use **Vérifier TikTok** on the post. Record the status and any returned error without sharing tokens or secrets.

Sandbox does not allow public Content Posting API videos; a successful Sandbox call is not proof of public visibility or Production approval. Test only within the Sandbox account's restrictions. The Production app remains Draft until integration and a genuine demo are ready.

## Validation completed locally

- Frontend inline JavaScript passed `node --check`.
- All four Edge Function TypeScript files passed an esbuild parse/transpile check.
- These are static checks only. The functions have **not** been deployed or called against TikTok from this workspace, and the end-to-end Sandbox Direct Post remains to be tested after deployment.
