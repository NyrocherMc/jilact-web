import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function b64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function appRedirect(status: string) {
  const origin = (Deno.env.get("APP_ORIGIN") || "https://jilact-vercel-v2.vercel.app").replace(/\/+$/, "");
  return Response.redirect(`${origin}/?tiktok=${encodeURIComponent(status)}`, 302);
}

Deno.serve(async (req) => {
  const params = new URL(req.url).searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const providerError = params.get("error");
  if (!code || !state || providerError) return appRedirect(providerError ? "denied" : "error");

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const clientKey = Deno.env.get("TIKTOK_CLIENT_KEY");
  const clientSecret = Deno.env.get("TIKTOK_CLIENT_SECRET");
  const encryptionSecret = Deno.env.get("YOUTUBE_TOKEN_ENCRYPTION_KEY");
  if (!supabaseUrl || !serviceKey || !clientKey || !clientSecret || !encryptionSecret) {
    console.error("TikTok callback server configuration is incomplete");
    return appRedirect("server_config_error");
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const stateHash = await sha256(state);
  const { data: stateRecord } = await admin.from("oauth_states")
    .select("user_id,workspace_id,expires_at").eq("state_hash", stateHash).maybeSingle();
  // Consume state even when expired, so it cannot be replayed.
  await admin.from("oauth_states").delete().eq("state_hash", stateHash);
  if (!stateRecord || new Date(stateRecord.expires_at).getTime() < Date.now()) return appRedirect("expired");

  const redirectUri = `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/tiktok-oauth-callback`;
  const tokenResponse = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  const tokenPayload = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || tokenPayload?.error || !tokenPayload?.access_token || !tokenPayload?.refresh_token || !tokenPayload?.open_id) {
    console.error("TikTok token exchange failed", tokenPayload?.error || tokenResponse.status);
    return appRedirect("token_error");
  }

  const profileUrl = new URL("https://open.tiktokapis.com/v2/user/info/");
  profileUrl.searchParams.set("fields", "open_id,display_name,avatar_url");
  const profileResponse = await fetch(profileUrl, {
    headers: { Authorization: `Bearer ${tokenPayload.access_token}` },
  });
  const profilePayload = await profileResponse.json().catch(() => ({}));
  const profile = profilePayload?.data?.user;
  if (!profileResponse.ok || !profile || profile.open_id !== tokenPayload.open_id) {
    console.error("TikTok profile request failed", profilePayload?.error?.code || profileResponse.status);
    return appRedirect("profile_error");
  }

  let keyBytes: Uint8Array;
  try {
    keyBytes = Uint8Array.from(atob(encryptionSecret), (c) => c.charCodeAt(0));
  } catch {
    return appRedirect("server_config_error");
  }
  if (keyBytes.length !== 32) return appRedirect("server_config_error");

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv }, key, new TextEncoder().encode(tokenPayload.refresh_token),
  );
  const scopes = String(tokenPayload.scope || "").split(",").map((s: string) => s.trim()).filter(Boolean);
  const expiresAt = Number(tokenPayload.refresh_expires_in) > 0
    ? new Date(Date.now() + Number(tokenPayload.refresh_expires_in) * 1000).toISOString()
    : null;

  const { error: saveError } = await admin.from("tiktok_accounts").upsert({
    workspace_id: stateRecord.workspace_id,
    open_id: profile.open_id,
    display_name: profile.display_name || "TikTok account",
    avatar_url: profile.avatar_url || null,
    encrypted_refresh_token: b64(new Uint8Array(ciphertext)),
    token_iv: b64(iv),
    scopes,
    refresh_expires_at: expiresAt,
    connected_at: new Date().toISOString(),
  });
  if (saveError) {
    console.error("Could not save TikTok connection", saveError);
    return appRedirect("save_error");
  }
  return appRedirect("connected");
});
