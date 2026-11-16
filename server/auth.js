"use strict";
const crypto=require("crypto");
const COOKIE="nadwa_session";
function secret(){const s=String(process.env.NADWA_SESSION_SECRET||"");if(s.length<32)throw new Error("NADWA_SESSION_SECRET is not configured");return s;}
function sign(payload){const body=Buffer.from(JSON.stringify(payload)).toString("base64url");const mac=crypto.createHmac("sha256",secret()).update(body).digest("base64url");return body+"."+mac;}
function verify(token){try{const parts=String(token||"").split(".");const body=parts[0],mac=parts[1];if(!body||!mac)return null;const expected=crypto.createHmac("sha256",secret()).update(body).digest();const actual=Buffer.from(mac,"base64url");if(actual.length!==expected.length||!crypto.timingSafeEqual(actual,expected))return null;const p=JSON.parse(Buffer.from(body,"base64url").toString("utf8"));if(!p.exp||p.exp<Date.now()||p.uid!=="owner")return null;return {uid:p.uid,username:p.username||"owner",role:"owner"};}catch(_){return null;}}
function cookieOptions(){return "Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800";}
function readCookie(req,name){for(const part of String(req.headers.cookie||"").split(";")){const i=part.trim().indexOf("=");if(i>0&&part.trim().slice(0,i)===name)return decodeURIComponent(part.trim().slice(i+1));}return "";}
async function requireFirebaseUser(req){const token=readCookie(req,COOKIE)||String(req.headers.authorization||"").replace(/^Bearer\s+/i,"");const user=verify(token);if(!user){const e=new Error("يلزم تسجيل الدخول للمتابعة");e.statusCode=401;throw e;}return user;}
function issueSession(username){return sign({uid:"owner",username,iat:Date.now(),exp:Date.now()+7*24*60*60*1000});}
module.exports={requireFirebaseUser,issueSession,COOKIE,cookieOptions,verify,readCookie};