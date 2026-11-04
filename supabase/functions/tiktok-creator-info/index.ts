import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const origin=(Deno.env.get("APP_ORIGIN")||"").replace(/\/+$/,"");
const headers={"Access-Control-Allow-Origin":origin||"null","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json","Vary":"Origin"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
function unb64(s:string){return Uint8Array.from(atob(s),c=>c.charCodeAt(0))}
function b64(a:Uint8Array){let x="";for(const b of a)x+=String.fromCharCode(b);return btoa(x)}
async function refreshAccessToken(admin:ReturnType<typeof createClient>,workspaceId:string,account:{encrypted_refresh_token:string;token_iv:string}){
  const keyBytes=unb64(Deno.env.get("YOUTUBE_TOKEN_ENCRYPTION_KEY")||"");if(keyBytes.length!==32)throw new Error("Token encryption key is not configured");
  const key=await crypto.subtle.importKey("raw",keyBytes,{name:"AES-GCM"},false,["decrypt","encrypt"]);
  const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:unb64(account.token_iv)},key,unb64(account.encrypted_refresh_token));
  const refreshToken=new TextDecoder().decode(plain);
  const response=await fetch("https://open.tiktokapis.com/v2/oauth/token/",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","Cache-Control":"no-cache"},body:new URLSearchParams({client_key:Deno.env.get("TIKTOK_CLIENT_KEY")||"",client_secret:Deno.env.get("TIKTOK_CLIENT_SECRET")||"",grant_type:"refresh_token",refresh_token:refreshToken})});
  const payload=await response.json().catch(()=>({}));if(!response.ok||payload?.error||!payload?.access_token)throw new Error("TikTok token refresh failed");
  if(payload.refresh_token&&payload.refresh_token!==refreshToken){const iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,new TextEncoder().encode(payload.refresh_token));await admin.from("tiktok_accounts").update({encrypted_refresh_token:b64(new Uint8Array(encrypted)),token_iv:b64(iv),refresh_expires_at:Number(payload.refresh_expires_in)>0?new Date(Date.now()+Number(payload.refresh_expires_in)*1000).toISOString():null}).eq("workspace_id",workspaceId)}
  return payload.access_token as string;
}
Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers});if(req.method!=="POST")return json({error:"POST required"},405);
  const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!anon||!service)return json({error:"Server configuration incomplete"},503);
  const auth=req.headers.get("Authorization")||"";const userClient=createClient(url,anon,{global:{headers:{Authorization:auth}}});const {data:{user}}=await userClient.auth.getUser();if(!user)return json({error:"Authentication required"},401);
  const body=await req.json().catch(()=>({}));const workspaceId=body?.workspace_id;if(typeof workspaceId!=="string")return json({error:"workspace_id required"},400);
  const admin=createClient(url,service);const {data:member}=await admin.from("workspace_members").select("role").eq("workspace_id",workspaceId).eq("user_id",user.id).maybeSingle();if(!member||!["owner","admin","editor"].includes(member.role))return json({error:"Workspace permission denied"},403);
  const {data:account,error:accountError}=await admin.from("tiktok_accounts").select("encrypted_refresh_token,token_iv").eq("workspace_id",workspaceId).maybeSingle();if(accountError||!account)return json({error:"TikTok account is not connected"},404);
  try{
    const accessToken=await refreshAccessToken(admin,workspaceId,account);
    const response=await fetch("https://open.tiktokapis.com/v2/post/publish/creator_info/query/",{method:"POST",headers:{Authorization:`Bearer ${accessToken}`,"Content-Type":"application/json; charset=UTF-8"},body:"{}"});
    const payload=await response.json().catch(()=>({}));if(!response.ok||payload?.error?.code&&payload.error.code!=="ok")return json({error:payload?.error?.message||"TikTok creator information request failed"},502);
    const c=payload?.data;if(!c)return json({error:"TikTok did not return creator information"},502);
    return json({creator_nickname:c.creator_nickname||"TikTok creator",creator_username:c.creator_username||null,creator_avatar_url:c.creator_avatar_url||null,privacy_level_options:Array.isArray(c.privacy_level_options)?c.privacy_level_options:[],comment_disabled:!!c.comment_disabled,duet_disabled:!!c.duet_disabled,stitch_disabled:!!c.stitch_disabled,max_video_post_duration_sec:Number(c.max_video_post_duration_sec)||null,can_post_video:c.can_post_video!==false});
  }catch(e){console.error("TikTok creator info failed",e);return json({error:"Could not retrieve TikTok creator information. Reconnect the account if needed."},502)}
});
