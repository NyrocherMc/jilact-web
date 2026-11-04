import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":Deno.env.get("APP_ORIGIN")||"null","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
function unb64(s:string){return Uint8Array.from(atob(s),c=>c.charCodeAt(0))}
Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});if(req.method!=="POST")return json({error:"POST required"},405);
  const url=Deno.env.get("SUPABASE_URL")!,anon=Deno.env.get("SUPABASE_ANON_KEY")!,service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;const auth=req.headers.get("Authorization")||"";
  const userClient=createClient(url,anon,{global:{headers:{Authorization:auth}}});const {data:{user}}=await userClient.auth.getUser();if(!user)return json({error:"Authentication required"},401);
  const {workspace_id}=await req.json().catch(()=>({workspace_id:null}));if(typeof workspace_id!=="string")return json({error:"workspace_id required"},400);
  const admin=createClient(url,service);const {data:member}=await admin.from("workspace_members").select("role").eq("workspace_id",workspace_id).eq("user_id",user.id).maybeSingle();if(!member||!['owner','admin','editor'].includes(member.role))return json({error:"Workspace permission denied"},403);
  const {data:account}=await admin.from("youtube_accounts").select("encrypted_refresh_token,token_iv,channel_id,channel_title").eq("workspace_id",workspace_id).maybeSingle();if(!account)return json({error:"YouTube account is not connected"},404);
  try{
    const keyBytes=unb64(Deno.env.get("YOUTUBE_TOKEN_ENCRYPTION_KEY")||"");if(keyBytes.length!==32)throw new Error("Missing token encryption key");
    const key=await crypto.subtle.importKey("raw",keyBytes,{name:"AES-GCM"},false,["decrypt"]);
    const refresh=await crypto.subtle.decrypt({name:"AES-GCM",iv:unb64(account.token_iv)},key,unb64(account.encrypted_refresh_token));
    const refresh_token=new TextDecoder().decode(refresh);
    const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:Deno.env.get("GOOGLE_CLIENT_ID")!,client_secret:Deno.env.get("GOOGLE_CLIENT_SECRET")!,refresh_token,grant_type:"refresh_token"})});
    const tokens=await r.json();if(!r.ok)return json({error:"Google token refresh failed; reconnect YouTube"},502);
    return json({access_token:tokens.access_token,expires_in:tokens.expires_in,channel_id:account.channel_id,channel_title:account.channel_title});
  }catch(e){console.error(e);return json({error:"Unable to unlock YouTube credentials"},500)}
});
