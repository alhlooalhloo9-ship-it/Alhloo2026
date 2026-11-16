"use strict";
const {issueSession,COOKIE,cookieOptions,verify,setCors}=require("../server/auth");
module.exports=async function(req,res){
 setCors(req,res);res.setHeader("Cache-Control","no-store");
 if(req.method==="OPTIONS")return res.status(204).end();
 if(req.method==="POST"){
  const expected=String(process.env.NADWA_OWNER_USERNAME||"").trim();
  const supplied=String(req.body&&req.body.username||"").trim();
  if(!expected)return res.status(503).json({ok:false,error:"لم يتم إعداد اسم المالك على الخادم"});
  if(!supplied||supplied!==expected)return res.status(401).json({ok:false,error:"اسم الدخول غير صحيح"});
  const token=issueSession(supplied);
  res.setHeader("Set-Cookie",COOKIE+"="+encodeURIComponent(token)+"; "+cookieOptions());
  return res.status(200).json({ok:true,user:{username:supplied,role:"owner"}});
 }
 if(req.method==="GET"){
  const cookie=(req.headers.cookie||"").match(/(?:^|;\\s*)nadwa_session=([^;]+)/);
  const user=cookie?verify(decodeURIComponent(cookie[1])):null;
  return res.status(200).json({ok:true,authenticated:!!user,user:user?{username:user.username,role:user.role}:null});
 }
 if(req.method==="DELETE"){
  res.setHeader("Set-Cookie",COOKIE+"=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  return res.status(200).json({ok:true});
 }
 res.setHeader("Allow","GET, POST, DELETE, OPTIONS");return res.status(405).json({ok:false,error:"Method not allowed"});
};