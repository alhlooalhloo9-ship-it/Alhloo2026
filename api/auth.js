"use strict";
const {getDatabase}=require("../server/mongodb");
const {issueSession,COOKIE,cookieOptions,resolveSession,readCookie,hashLoginName}=require("../server/auth");
const {setCors}=require("../server/http");
module.exports=async function(req,res){
 setCors(req,res);res.setHeader("Cache-Control","no-store");if(req.method==="OPTIONS")return res.status(204).end();
 try{
  if(req.method==="POST"){const supplied=String(req.body&&req.body.username||"").trim(),owner=String(process.env.NADWA_OWNER_USERNAME||"").trim();if(!supplied)return res.status(400).json({ok:false,error:"اكتب اسم الدخول"});let s;
   if(owner&&supplied===owner)s={uid:"owner",username:owner,role:"owner",workspaceId:"owner",permissions:{all:true},sharing:{mode:"owner"}};
   else{const db=await getDatabase(),u=await db.collection("users").findOne({loginHash:hashLoginName(supplied),active:true});if(!u)return res.status(401).json({ok:false,error:"اسم الدخول غير صحيح أو تم تعطيله"});s={uid:String(u._id),username:u.label,role:"partner",workspaceId:u.workspaceId||"owner",loginHash:u.loginHash,permissions:u.permissions||{},sharing:u.sharing||{mode:"shared"}};}
   res.setHeader("Set-Cookie",COOKIE+"="+encodeURIComponent(issueSession(s))+"; "+cookieOptions());return res.status(200).json({ok:true,user:{username:s.username,role:s.role}});
  }
  if(req.method==="GET"){const u=await resolveSession(readCookie(req,COOKIE));return res.status(200).json({ok:true,authenticated:!!u,user:u?{username:u.username,role:u.role,permissions:u.permissions}:null});}
  if(req.method==="DELETE"){res.setHeader("Set-Cookie",COOKIE+"=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");return res.status(200).json({ok:true});}
  res.setHeader("Allow","GET, POST, DELETE, OPTIONS");return res.status(405).json({ok:false,error:"Method not allowed"});
 }catch(e){console.error("Auth API:",e);return res.status(e.statusCode||500).json({ok:false,error:"تعذر إتمام تسجيل الدخول حالياً"});}
};