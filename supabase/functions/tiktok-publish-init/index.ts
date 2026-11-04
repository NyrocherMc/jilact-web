import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const origin=(Deno.env.get("APP_ORIGIN")||"").replace(/\/+$/,"");
const headers={"Access-Control-Allow-Origin":origin||"null","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json","Vary":"Origin"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
function unb64(s:string){return Uint8Array.from(atob(s),c=>c.charCodeAt(0))}
function b64(a:Uint8Array){let x="";for(const b of a)x+=String.fromCharCode(b);return btoa(x)}
async function freshToken(admin:ReturnType<typeof createClient>,workspaceId:string,account:{encrypted_refresh_token:string;token_iv:string}){
  const keyBytes=unb64(Deno.env.get("YOUTUBE_TOKEN_ENCRYPTION_KEY")||"");if(keyBytes.length!==32)throw new Error("Token encryption key is not configured");
  const key=await crypto.subtle.importKey("raw",keyBytes,{name:"AES-GCM"},false,["decrypt","encrypt"]);
  const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:unb64(account.token_iv)},key,unb64(account.encrypted_refresh_token));
  const oldRefresh=new TextDecoder().decode(plain);
  const response=await fetch("https://open.tiktokapis.com/v2/oauth/token/",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","Cache-Control":"no-cache"},body:new URLSearchParams({client_key:Deno.env.get("TIKTOK_CLIENT_KEY")||"",client_secret:Deno.env.get("TIKTOK_CLIENT_SECRET")||"",grant_type:"refresh_token",refresh_token:oldRefresh})});
  const payload=await response.json().catch(()=>({}));if(!response.ok||payload?.error||!payload?.access_token)throw new Error("TikTok access token refresh failed");
  if(payload.refresh_token&&payload.refresh_token!==oldRefresh){const iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,new TextEncoder().encode(payload.refresh_token));await admin.from("tiktok_accounts").update({encrypted_refresh_token:b64(new Uint8Array(encrypted)),token_iv:b64(iv),refresh_expires_at:Number(payload.refresh_expires_in)>0?new Date(Date.now()+Number(payload.refresh_expires_in)*1000).toISOString():null}).eq("workspace_id",workspaceId)}
  return String(payload.access_token);
}
function plan(size:number){const MB=1024*1024;if(size<5*MB)return{chunkSize:size,totalChunks:1};const totalChunks=Math.max(1,Math.ceil(size/(16*MB)));return{chunkSize:Math.ceil(size/totalChunks),totalChunks}}
Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers});if(req.method!=="POST")return json({error:"POST required"},405);
  const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!anon||!service)return json({error:"Server configuration incomplete"},503);
  const auth=req.headers.get("Authorization")||"";const client=createClient(url,anon,{global:{headers:{Authorization:auth}}});const {data:{user}}=await client.auth.getUser();if(!user)return json({error:"Authentication required"},401);
  const body=await req.json().catch(()=>({}));const workspaceId=body?.workspace_id,postId=body?.post_id,privacyLevel=body?.privacy_level,confirmed=body?.confirmed,videoSize=Number(body?.video_size);
  if(typeof workspaceId!=="string"||typeof postId!=="string")return json({error:"workspace_id and post_id are required"},400);
  if(confirmed!==true)return json({error:"Explicit user confirmation is required"},400);
  if(!Number.isSafeInteger(videoSize)||videoSize<=0||videoSize>512*1024*1024)return json({error:"Video size is invalid or exceeds Jilact's 512 MB media limit"},400);
  const admin=createClient(url,service);const {data:member}=await admin.from("workspace_members").select("role").eq("workspace_id",workspaceId).eq("user_id",user.id).maybeSingle();if(!member||!["owner","admin","editor"].includes(member.role))return json({error:"Workspace permission denied"},403);
  const {data:post,error:postError}=await admin.from("posts").select("id,workspace_id,scheduled_at,status,networks,media_path,platform_content,youtube_video_id").eq("id",postId).eq("workspace_id",workspaceId).maybeSingle();
  if(postError||!post)return json({error:"TikTok post not found"},404);
  if(!Array.isArray(post.networks)||!post.networks.includes("TikTok"))return json({error:"This post is not scheduled for TikTok"},400);
  if(!post.media_path||!String(post.media_path).startsWith(`${workspaceId}/`))return json({error:"A saved video is required for this TikTok post"},400);
  if(new Date(post.scheduled_at).getTime()>Date.now())return json({error:"This TikTok reminder is not due yet"},409);
  if(post.status==="paused"||post.status==="published")return json({error:"This TikTok reminder is paused or already completed"},409);
  const platformContent=post.platform_content||{};
  if(platformContent._tiktokPublishId&&!['FAILED','UPLOAD_ERROR'].includes(platformContent._tiktokStatus))return json({error:"A TikTok publishing task already exists for this post",publish_id:platformContent._tiktokPublishId,status:platformContent._tiktokStatus||"PROCESSING"},409);
  const {data:account}=await admin.from("tiktok_accounts").select("encrypted_refresh_token,token_iv").eq("workspace_id",workspaceId).maybeSingle();if(!account)return json({error:"TikTok account is not connected"},404);
  const tikTokContent=platformContent.TikTok||{};const tags=Array.isArray(tikTokContent.hashtags)?tikTokContent.hashtags.join(" "):"";const caption=[String(tikTokContent.caption||post.caption||"").trim(),tags].filter(Boolean).join(" ").trim();
  if(!caption)return json({error:"A TikTok caption is required"},400);if(caption.length>2200)return json({error:"TikTok caption exceeds 2200 characters"},400);
  try{
    const accessToken=await freshToken(admin,workspaceId,account);
    const creatorResponse=await fetch("https://open.tiktokapis.com/v2/post/publish/creator_info/query/",{method:"POST",headers:{Authorization:`Bearer ${accessToken}`,"Content-Type":"application/json; charset=UTF-8"},body:"{}"});
    const creatorPayload=await creatorResponse.json().catch(()=>({}));const creator=creatorPayload?.data;
    if(!creatorResponse.ok||creatorPayload?.error?.code&&creatorPayload.error.code!=="ok"||!creator)return json({error:creatorPayload?.error?.message||"Could not refresh TikTok creator permissions"},502);
    if(creator.can_post_video===false)return json({error:"TikTok currently does not allow this account to publish a video. Try again later."},409);
    if(!Array.isArray(creator.privacy_level_options)||!creator.privacy_level_options.includes(privacyLevel))return json({error:"Choose a privacy option returned by TikTok before publishing"},400);
    const {chunkSize,totalChunks}=plan(videoSize);
    const initResponse=await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/",{method:"POST",headers:{Authorization:`Bearer ${accessToken}`,"Content-Type":"application/json; charset=UTF-8"},body:JSON.stringify({post_info:{title:caption,privacy_level:privacyLevel},source_info:{source:"FILE_UPLOAD",video_size:videoSize,chunk_size:chunkSize,total_chunk_count:totalChunks}})});
    const initPayload=await initResponse.json().catch(()=>({}));const initError=initPayload?.error;
    if(!initResponse.ok||initError&&initError.code!=="ok"||!initPayload?.data?.publish_id||!initPayload?.data?.upload_url){console.error("TikTok publish init failed",initError?.code||initResponse.status);return json({error:initError?.message||"TikTok could not initialize this post"},502)}
    const publishId=String(initPayload.data.publish_id);const updated={...platformContent,_tiktokPublishId:publishId,_tiktokStatus:"PROCESSING_UPLOAD",_tiktokPrivacy:privacyLevel,_tiktokVideoSize:videoSize,_tiktokChunkSize:chunkSize,_tiktokTotalChunks:totalChunks,_tiktokStartedAt:new Date().toISOString()};
    const {error:saveError}=await admin.from("posts").update({platform_content:updated}).eq("id",postId).eq("workspace_id",workspaceId);if(saveError){console.error("Could not save TikTok publish id",saveError);return json({error:"TikTok started, but Jilact could not save its status"},500)}
    return json({upload_url:initPayload.data.upload_url,publish_id:publishId,chunk_size:chunkSize,total_chunk_count:totalChunks,creator_nickname:creator.creator_nickname||"TikTok creator"});
  }catch(e){console.error("TikTok publish initialization failed",e);return json({error:"Could not prepare the TikTok post. Reconnect the account if needed."},502)}
});
