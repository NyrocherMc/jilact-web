import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const appOrigin = (Deno.env.get("APP_ORIGIN") || "").replace(/\/+$/, "");
const cors = {
  "Access-Control-Allow-Origin": appOrigin || "null",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Vary": "Origin",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const clientKey = Deno.env.get("TIKTOK_CLIENT_KEY");
  if (!appOrigin || !supabaseUrl || !anonKey || !serviceKey || !clientKey) {
    return json({ error: "TikTok OAuth server configuration is incomplete" }, 503);
  }

  const authorization = req.headers.get("Authorization") || "";
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return json({ error: "Authentication required" }, 401);

  const body = await req.json().catch(() => ({}));
  const workspaceId = body?.workspace_id;
  if (typeof workspaceId !== "string") return json({ error: "workspace_id required" }, 400);

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: membership } = await admin.from("workspace_members")
    .select("role").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle();
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return json({ error: "Workspace permission denied" }, 403);
  }

  const state = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  const stateHash = await sha256(state);
  const { error: stateError } = await admin.from("oauth_states").insert({
    state_hash: stateHash,
    user_id: user.id,
    workspace_id: workspaceId,
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  if (stateError) {
    console.error("Could not store TikTok OAuth state", stateError);
    return json({ error: "Could not start TikTok authorization" }, 500);
  }

  const redirectUri = `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/tiktok-oauth-callback`;
  const authorize = new URL("https://www.tiktok.com/v2/auth/authorize/");
  authorize.searchParams.set("client_key", clientKey);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", "user.info.basic,video.publish");
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("state", state);
  return json({ url: authorize.toString() });
});
