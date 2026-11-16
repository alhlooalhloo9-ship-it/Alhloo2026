"use strict";
const {db,token,hash,setSession,clearSession,checkOrigin,init,auth,requireRole,fail}=require("../server/nadwa-shared");
module.exports=async function handler(req,res){
 res.setHeader("Cache-Control","no-store");
 try{
  const action=String(req.query?.action||req.body?.action||"");
  if(req.method==="POST") checkOrigin(req);
  const d=await db(); await init(d);
  if(action==="bootstrap"){
   if(req.method!=="POST") return res.status(405).json({ok:false});
   const key=String(req.body?.setupKey||"");
   if(!process.env.NADWA_OWNER_SETUP_KEY||key.length<24||key!==process.env.NADWA_OWNER_SETUP_KEY) fail("رمز التأسيس غير صحيح",403);
   if(await d.collection("workspaces").findOne({workspaceId:"nadwa-main"})) fail("تم إنشاء حساب المالك مسبقاً",409);
   const memberId=token(12),sessionToken=token();
   await d.collection("workspaces").insertOne({workspaceId:"nadwa-main",createdAt:new Date(),name:"بضاعة الندوة"});
   await d.collection("members").insertOne({workspaceId:"nadwa-main",memberId,displayName:"المالك",role:"owner",permissions:["*"],active:true,createdAt:new Date()});
   await d.collection("sessions").insertOne({workspaceId:"nadwa-main",memberId,tokenHash:hash(sessionToken),createdAt:new Date(),expiresAt:new Date(Date.now()+30*86400000),revokedAt:null});
   setSession(res,sessionToken); return res.status(201).json({ok:true,member:{memberId,displayName:"المالك",role:"owner"}});
  }
  if(action==="accept"){
   if(req.method!=="POST") return res.status(405).json({ok:false});
   const inviteToken=String(req.body?.inviteToken||""); if(inviteToken.length<20) fail("رمز الدعوة غير صالح");
   const invite=await d.collection("invites").findOneAndUpdate({tokenHash:hash(inviteToken),usedAt:null,expiresAt:{$gt:new Date()},revokedAt:null},{$set:{usedAt:new Date()}},{returnDocument:"after"});
   if(!invite) fail("الدعوة منتهية أو مستخدمة أو ملغاة",410);
   const memberId=token(12),sessionToken=token();
   await d.collection("members").insertOne({workspaceId:invite.workspaceId,memberId,displayName:String(req.body?.displayName||"شريك").slice(0,60),role:"partner",permissions:["catalog:read","sales:create","invoices:read"],active:true,createdAt:new Date()});
   await d.collection("sessions").insertOne({workspaceId:invite.workspaceId,memberId,tokenHash:hash(sessionToken),createdAt:new Date(),expiresAt:new Date(Date.now()+30*86400000),revokedAt:null});
   setSession(res,sessionToken); return res.status(201).json({ok:true,member:{memberId,role:"partner"}});
  }
  const {member}=await auth(req);
  if(action==="me"&&req.method==="GET") return res.status(200).json({ok:true,member:{memberId:member.memberId,displayName:member.displayName,role:member.role,permissions:member.permissions}});
  if(action==="invite"&&req.method==="POST"){
   requireRole(member,["owner"]); const inviteToken=token(); const expiresAt=new Date(Date.now()+15*60*1000);
   await d.collection("invites").insertOne({workspaceId:member.workspaceId,tokenHash:hash(inviteToken),createdBy:member.memberId,createdAt:new Date(),expiresAt,usedAt:null,revokedAt:null});
   return res.status(201).json({ok:true,inviteToken,expiresAt});
  }
  if(action==="members"&&req.method==="GET"){
   requireRole(member,["owner"]); const members=await d.collection("members").find({workspaceId:member.workspaceId},{projection:{_id:0,memberId:1,displayName:1,role:1,active:1,createdAt:1}}).toArray();
   return res.status(200).json({ok:true,members});
  }
  if(action==="revoke"&&req.method==="POST"){
   requireRole(member,["owner"]); const id=String(req.body?.memberId||""); if(!id||id===member.memberId) fail("لا يمكن إلغاء حساب المالك");
   await d.collection("members").updateOne({workspaceId:member.workspaceId,memberId:id,role:"partner"},{$set:{active:false,revokedAt:new Date()}});
   await d.collection("sessions").updateMany({workspaceId:member.workspaceId,memberId:id},{$set:{revokedAt:new Date(),expiresAt:new Date()}});
   return res.status(200).json({ok:true});
  }
  if(action==="logout"&&req.method==="POST"){
   const raw=require("../server/nadwa-shared").cookie(req,"nadwa_session");
   if(raw) await d.collection("sessions").updateOne({tokenHash:hash(raw)},{$set:{revokedAt:new Date(),expiresAt:new Date()}});
   clearSession(res); return res.status(200).json({ok:true});
  }
  fail("عملية غير معروفة",404);
 }catch(e){res.status(e.statusCode||500).json({ok:false,error:e.statusCode?e.message:"حدث خطأ بالخادم"});}
};
