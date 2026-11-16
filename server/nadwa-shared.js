"use strict";
const crypto = require("crypto");
const { MongoClient } = require("mongodb");
const DB_NAME = "NadwaShared";
let clientPromise;
function fail(message, status=400){ const e=new Error(message); e.statusCode=status; throw e; }
async function db(){
  const uri=String(process.env.NADWA_MONGODB_URI||"").trim();
  if(!/^mongodb(?:\+srv)?:\/\//i.test(uri)) fail("Shared database is not configured",503);
  if(!clientPromise){ const c=new MongoClient(uri,{serverSelectionTimeoutMS:10000,maxPoolSize:8}); clientPromise=c.connect().catch(e=>{clientPromise=null;throw e;}); }
  return (await clientPromise).db(DB_NAME);
}
function token(bytes=32){ return crypto.randomBytes(bytes).toString("base64url"); }
function hash(v){ return crypto.createHash("sha256").update(String(v)).digest("hex"); }
function cookie(req,name){
  const raw=String(req.headers.cookie||"");
  const part=raw.split(";").map(x=>x.trim()).find(x=>x.startsWith(name+"="));
  return part?decodeURIComponent(part.slice(name.length+1)):"";
}
function setSession(res,value,maxAge=60*60*24*30){
  res.setHeader("Set-Cookie","nadwa_session="+encodeURIComponent(value)+"; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age="+maxAge);
}
function clearSession(res){res.setHeader("Set-Cookie","nadwa_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");}
function checkOrigin(req){
  const origin=req.headers.origin;
  if(!origin) return;
  const host=String(req.headers.host||"").toLowerCase();
  let oh=""; try{oh=new URL(origin).host.toLowerCase()}catch(_){fail("Invalid origin",403)}
  if(oh!==host) fail("Cross-origin request blocked",403);
}
async function init(dbx){
  await Promise.all([
    dbx.collection("members").createIndex({workspaceId:1,memberId:1},{unique:true}),
    dbx.collection("sessions").createIndex({tokenHash:1},{unique:true}),
    dbx.collection("sessions").createIndex({expiresAt:1},{expireAfterSeconds:0}),
    dbx.collection("invites").createIndex({tokenHash:1},{unique:true}),
    dbx.collection("invites").createIndex({expiresAt:1},{expireAfterSeconds:0}),
    dbx.collection("products").createIndex({workspaceId:1,productId:1},{unique:true}),
    dbx.collection("invoices").createIndex({workspaceId:1,invoiceId:1},{unique:true}),
    dbx.collection("sales").createIndex({workspaceId:1,saleId:1},{unique:true}),
    dbx.collection("workspaces").createIndex({workspaceId:1},{unique:true})
  ]);
}
async function auth(req){
  const raw=cookie(req,"nadwa_session"); if(!raw) fail("يلزم تسجيل الدخول",401);
  const d=await db(); const session=await d.collection("sessions").findOne({tokenHash:hash(raw),revokedAt:null,expiresAt:{$gt:new Date()}});
  if(!session) fail("انتهت الجلسة، أعد ربط الجهاز",401);
  const member=await d.collection("members").findOne({workspaceId:session.workspaceId,memberId:session.memberId,active:true});
  if(!member) fail("تم تعطيل هذا الحساب",401);
  return {db:d,session,member};
}
function requireRole(member,roles){if(!roles.includes(member.role))fail("ما عندك صلاحية لهالعملية",403);}
module.exports={db,token,hash,cookie,setSession,clearSession,checkOrigin,init,auth,requireRole,fail};
