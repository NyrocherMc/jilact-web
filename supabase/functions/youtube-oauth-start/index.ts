import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":Deno.env.get("APP_ORIGIN")||"null","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
async function sha256(v:string){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,"0")).join("")}
Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return json({error:"POST required"},405);
  const url=Deno.env.get("SUPABASE_URL")!, anon=Deno.env.get("SUPABASE_ANON_KEY")!, service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const auth=req.headers.get("Authorization")||"";
  const userClient=createClient(url,anon,{global:{headers:{Authorization:auth}}});
  const {data:{user},error}=await userClient.auth.getUser();
  if(error||!user)return json({error:"Authentication required"},401);
  const {workspace_id}=await req.json().catch(()=>({workspace_id:null}));
  if(typeof workspace_id!=="string")return json({error:"workspace_id required"},400);
  const admin=createClient(url,service);
  const {data:membership}=await admin.from("workspace_members").select("role").eq("workspace_id",workspace_id).eq("user_id",user.id).maybeSingle();
  if(!membership||!['owner','admin'].includes(membership.role))return json({error:"Workspace permission denied"},403);
  const clientId=Deno.env.get("GOOGLE_CLIENT_ID");
  const redirectUri=`${url}/functions/v1/youtube-oauth-callback`;
  if(!clientId)return json({error:"Google OAuth is not configured"},503);
  const state=[...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,"0")).join("");
  const state_hash=await sha256(state);
  const {error:saveError}=await admin.from("oauth_states").insert({state_hash,user_id:user.id,workspace_id,expires_at:new Date(Date.now()+10*60_000).toISOString()});
  if(saveError)return json({error:"Could not start OAuth"},500);
  const scopes=["https://www.googleapis.com/auth/youtube.upload","https://www.googleapis.com/auth/youtube.readonly"].join(" ");
  const google=new URL("https://accounts.google.com/o/oauth2/v2/auth");
  google.searchParams.set("client_id",clientId);google.searchParams.set("redirect_uri",redirectUri);google.searchParams.set("response_type","code");google.searchParams.set("scope",scopes);google.searchParams.set("access_type","offline");google.searchParams.set("prompt","consent");google.searchParams.set("state",state);
  return json({url:google.toString()});
});
