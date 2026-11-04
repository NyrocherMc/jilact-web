import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const appOrigin = (Deno.env.get("APP_ORIGIN") || "").replace(/\/+$/, "");
const headers = {
  "Access-Control-Allow-Origin": appOrigin || "null",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Vary": "Origin",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "Server configuration incomplete" }, 503);
  const authorization = req.headers.get("Authorization") || "";
  const client = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: { user } } = await client.auth.getUser();
  if (!user) return json({ error: "Authentication required" }, 401);
  const body = await req.json().catch(() => ({}));
  const workspaceId = body?.workspace_id;
  if (typeof workspaceId !== "string") return json({ error: "workspace_id required" }, 400);
  const admin = createClient(supabaseUrl, serviceKey);
  const { data: member } = await admin.from("workspace_members")
    .select("role").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle();
  if (!member) return json({ error: "Workspace permission denied" }, 403);
  const { data, error } = await admin.from("tiktok_accounts")
    .select("open_id,display_name,avatar_url,scopes,connected_at,refresh_expires_at")
    .eq("workspace_id", workspaceId).maybeSingle();
  if (error) return json({ error: "Could not read TikTok connection" }, 500);
  return json({
    connected: !!data,
    open_id: data?.open_id || null,
    display_name: data?.display_name || null,
    avatar_url: data?.avatar_url || null,
    scopes: data?.scopes || [],
    connected_at: data?.connected_at || null,
    refresh_expires_at: data?.refresh_expires_at || null,
  });
});
