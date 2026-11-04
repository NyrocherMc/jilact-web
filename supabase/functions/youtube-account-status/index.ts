import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":Deno.env.get("APP_ORIGIN")||"null","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});if(req.method!=="POST")return json({error:"POST required"},405);
  const url=Deno.env.get("SUPABASE_URL")!,anon=Deno.env.get("SUPABASE_ANON_KEY")!,service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;const auth=req.headers.get("Authorization")||"";
  const client=createClient(url,anon,{global:{headers:{Authorization:auth}}});const {data:{user}}=await client.auth.getUser();if(!user)return json({error:"Authentication required"},401);
  const {workspace_id}=await req.json().catch(()=>({workspace_id:null}));if(typeof workspace_id!=="string")return json({error:"workspace_id required"},400);
  const admin=createClient(url,service);const {data:member}=await admin.from("workspace_members").select("role").eq("workspace_id",workspace_id).eq("user_id",user.id).maybeSingle();if(!member)return json({error:"Workspace permission denied"},403);
  const {data}=await admin.from("youtube_accounts").select("channel_id,channel_title,connected_at").eq("workspace_id",workspace_id).maybeSingle();return json({connected:!!data,channel_id:data?.channel_id||null,channel_title:data?.channel_title||null,connected_at:data?.connected_at||null});
});
