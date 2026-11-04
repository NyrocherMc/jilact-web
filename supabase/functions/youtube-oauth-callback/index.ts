import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
async function sha256(v:string){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,"0")).join("")}
function b64(a:Uint8Array){return btoa(String.fromCharCode(...a))}
Deno.serve(async req=>{
  const app=Deno.env.get("APP_ORIGIN")||"https://localhost";const u=new URL(req.url);const code=u.searchParams.get("code"),state=u.searchParams.get("state"),err=u.searchParams.get("error");
  const go=(status:string)=>Response.redirect(`${app}/?youtube=${encodeURIComponent(status)}`,302);
  if(err||!code||!state)return go("error");
  const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const state_hash=await sha256(state);
  const {data:record}=await admin.from("oauth_states").select("user_id,workspace_id,expires_at").eq("state_hash",state_hash).maybeSingle();
  await admin.from("oauth_states").delete().eq("state_hash",state_hash);
  if(!record||new Date(record.expires_at).getTime()<Date.now())return go("expired");
  const supa=Deno.env.get("SUPABASE_URL")!;
  const tokenRes=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({code,client_id:Deno.env.get("GOOGLE_CLIENT_ID")!,client_secret:Deno.env.get("GOOGLE_CLIENT_SECRET")!,redirect_uri:`${supa}/functions/v1/youtube-oauth-callback`,grant_type:"authorization_code"})});
  const tokens=await tokenRes.json();if(!tokenRes.ok||!tokens.refresh_token)return go("token_error");
  const profileRes=await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",{headers:{Authorization:`Bearer ${tokens.access_token}`}});const profile=await profileRes.json();
  const channel=profile.items?.[0];if(!profileRes.ok||!channel)return go("channel_error");
  const keyBytes=Uint8Array.from(atob(Deno.env.get("YOUTUBE_TOKEN_ENCRYPTION_KEY")||""),c=>c.charCodeAt(0));
  if(keyBytes.length!==32)return go("server_config_error");
  const iv=crypto.getRandomValues(new Uint8Array(12));const key=await crypto.subtle.importKey("raw",keyBytes,{name:"AES-GCM"},false,["encrypt"]);
  const encrypted=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,new TextEncoder().encode(tokens.refresh_token));
  const {error}=await admin.from("youtube_accounts").upsert({workspace_id:record.workspace_id,channel_id:channel.id,channel_title:channel.snippet?.title||"YouTube",encrypted_refresh_token:b64(new Uint8Array(encrypted)),token_iv:b64(iv),connected_at:new Date().toISOString()});
  if(error)return go("save_error");
  return go("connected");
});
