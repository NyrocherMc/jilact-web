import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const origin=(Deno.env.get("APP_ORIGIN")||"").replace(/\/+$/,"");
const headers={"Access-Control-Allow-Origin":origin||"null","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json","Vary":"Origin"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
function unb64(s:string){return Uint8Array.from(atob(s),c=>c.charCodeAt(0))}
function b64(a:Uint8Array){let x="";for(const b of a)x+=String.fromCharCode(b);return btoa(x)}
async function freshToken(admin:ReturnType<typeof createClient>,workspaceId:string,account:{encrypted_refresh_token:string;token_iv:string}){
  const keyBytes=unb64(Deno.env.get("YOUTUBE_TOKEN_ENCRYPTION_KEY")||"");if(keyBytes.length!==32)throw new Error("Token encryption key is not configured");
  const key=await crypto.subtle.importKey("raw",keyBytes,{name:"AES-GCM"},false,["decrypt","encrypt"]);
  const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:unb64(account.token_iv)},key,unb64(account.encrypted_refresh_token));const oldRefresh=new TextDecoder().decode(plain);
  const response=await fetch("https://open.tiktokapis.com/v2/oauth/token/",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","Cache-Control":"no-cache"},body:new URLSearchParams({client_key:Deno.env.get("TIKTOK_CLIENT_KEY")||"",client_secret:Deno.env.get("TIKTOK_CLIENT_SECRET")||"",grant_type:"refresh_token",refresh_token:oldRefresh})});
  const payload=await response.json().catch(()=>({}));if(!response.ok||payload?.error||!payload?.access_token)throw new Error("TikTok access token refresh failed");
  if(payload.refresh_token&&payload.refresh_token!==oldRefresh){const iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,new TextEncoder().encode(payload.refresh_token));await admin.from("tiktok_accounts").update({encrypted_refresh_token:b64(new Uint8Array(encrypted)),token_iv:b64(iv),refresh_expires_at:Number(payload.refresh_expires_in)>0?new Date(Date.now()+Number(payload.refresh_expires_in)*1000).toISOString():null}).eq("workspace_id",workspaceId)}
  return String(payload.access_token);
}
Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers});if(req.method!=="POST")return json({error:"POST required"},405);
  const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!anon||!service)return json({error:"Server configuration incomplete"},503);
  const auth=req.headers.get("Authorization")||"";const client=createClient(url,anon,{global:{headers:{Authorization:auth}}});const {data:{user}}=await client.auth.getUser();if(!user)return json({error:"Authentication required"},401);
  const body=await req.json().catch(()=>({}));const workspaceId=body?.workspace_id,publishId=body?.publish_id;if(typeof workspaceId!=="string"||typeof publishId!=="string")return json({error:"workspace_id and publish_id are required"},400);
  const admin=createClient(url,service);const {data:member}=await admin.from("workspace_members").select("role").eq("workspace_id",workspaceId).eq("user_id",user.id).maybeSingle();if(!member)return json({error:"Workspace permission denied"},403);
  const {data:post}=await admin.from("posts").select("id,status,networks,youtube_video_id,platform_content").eq("workspace_id",workspaceId).contains("platform_content",{_tiktokPublishId:publishId}).maybeSingle();if(!post)return json({error:"TikTok publishing task not found"},404);
  const {data:account}=await admin.from("tiktok_accounts").select("encrypted_refresh_token,token_iv").eq("workspace_id",workspaceId).maybeSingle();if(!account)return json({error:"TikTok account is not connected"},404);
  try{
    const accessToken=await freshToken(admin,workspaceId,account);
    const response=await fetch("https://open.tiktokapis.com/v2/post/publish/status/fetch/",{method:"POST",headers:{Authorization:`Bearer ${accessToken}`,"Content-Type":"application/json; charset=UTF-8"},body:JSON.stringify({publish_id:publishId})});
    const payload=await response.json().catch(()=>({}));if(!response.ok||payload?.error?.code&&payload.error.code!=="ok")return json({error:payload?.error?.message||"TikTok status request failed"},502);
    const data=payload?.data||{};const state=String(data.status||"UNKNOWN");const failReason=data.fail_reason||null;
    const pc={...(post.platform_content||{}),_tiktokStatus:state,_tiktokFailReason:failReason};
    const networks=Array.isArray(post.networks)?post.networks:[];
    const onlyHandledHere=networks.every((n:string)=>n==="TikTok"||(n==="YouTube"&&!!post.youtube_video_id));
    const update:any={platform_content:pc};
    if(state==="PUBLISH_COMPLETE"&&onlyHandledHere)update.status="published";
    else if(state==="FAILED"&&onlyHandledHere)update.status="failed";
    const {error:updateError}=await admin.from("posts").update(update).eq("id",post.id);
    if(updateError)console.error("Could not save TikTok publishing status",updateError);
    return json({status:state,fail_reason:failReason,post_id:data.publicaly_available_post_id||null});
  }catch(e){console.error("TikTok publish status failed",e);return json({error:"Could not check TikTok publishing status. Reconnect the account if needed."},502)}
});
