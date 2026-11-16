"use strict";
const crypto=require("crypto");
const {getDatabase}=require("./mongodb");
const COOKIE="nadwa_session";
function secret(){const s=String(process.env.NADWA_SESSION_SECRET||"");if(s.length<32)throw new Error("NADWA_SESSION_SECRET is not configured");return s;}
function sign(p){const b=Buffer.from(JSON.stringify(p)).toString("base64url");return b+"."+crypto.createHmac("sha256",secret()).update(b).digest("base64url");}
function verify(t){try{const [b,m]=String(t||"").split(".");if(!b||!m)return null;const e=crypto.createHmac("sha256",secret()).update(b).digest(),a=Buffer.from(m,"base64url");if(a.length!==e.length||!crypto.timingSafeEqual(a,e))return null;const p=JSON.parse(Buffer.from(b,"base64url").toString("utf8"));return p.exp>Date.now()&&p.uid&&p.workspaceId?p:null;}catch(_){return null;}}
function cookieOptions(){return "Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800";}
function readCookie(req,n){for(const x of String(req.headers.cookie||"").split(";")){const i=x.trim().indexOf("=");if(i>0&&x.trim().slice(0,i)===n)return decodeURIComponent(x.trim().slice(i+1));}return "";}
async function resolveSession(token){const p=verify(token);if(!p)return null;if(p.role==="owner"){const o=String(process.env.NADWA_OWNER_USERNAME||"").trim();return o&&p.uid==="owner"&&p.username===o?p:null;}const {ObjectId}=require("mongodb");if(!ObjectId.isValid(p.uid)||!p.loginHash)return null;const db=await getDatabase(),u=await db.collection("users").findOne({_id:new ObjectId(p.uid),active:true});if(!u||u.loginHash!==p.loginHash)return null;return {...p,username:u.label,workspaceId:u.workspaceId||"owner",permissions:u.permissions||{},sharing:u.sharing||{mode:"shared"}};}
async function requireFirebaseUser(req){const t=readCookie(req,COOKIE)||String(req.headers.authorization||"").replace(/^Bearer\\s+/i,"");const u=await resolveSession(t);if(!u){const e=new Error("يلزم تسجيل الدخول للمتابعة");e.statusCode=401;throw e;}return u;}
function issueSession(u){return sign({...u,iat:Date.now(),exp:Date.now()+7*24*60*60*1000});}
function hashLoginName(v){return crypto.createHash("sha256").update(String(v).trim().toLowerCase()).digest("hex");}
module.exports={requireFirebaseUser,issueSession,COOKIE,cookieOptions,verify,resolveSession,readCookie,hashLoginName};