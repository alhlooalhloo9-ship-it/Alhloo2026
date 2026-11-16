"use strict";
const {requireFirebaseUser}=require("./auth");
const PREVIEW_HOST="alhloo2026-git-partner-sharing-alhlooalhloo2-5399s-projects.vercel.app";
function setCors(req,res){const origin=String(req.headers.origin||"");let allowed=false;try{const u=new URL(origin);allowed=u.protocol==="https:"&&(u.hostname==="alhlooalhloo9-ship-it.github.io"||u.hostname==="alhloo2026.vercel.app"||u.hostname===PREVIEW_HOST);}catch(_){}if(allowed){res.setHeader("Access-Control-Allow-Origin",origin);res.setHeader("Vary","Origin");res.setHeader("Access-Control-Allow-Credentials","true");}res.setHeader("Access-Control-Allow-Headers","Authorization, Content-Type");res.setHeader("Access-Control-Allow-Methods","GET, POST, PUT, PATCH, DELETE, OPTIONS");}
async function authenticate(req,res){setCors(req,res);if(req.method==="OPTIONS"){res.status(204).end();return null;}try{return await requireFirebaseUser(req);}catch(e){res.status(e.statusCode||401).json({ok:false,error:e.message});return null;}}
function methodNotAllowed(res,methods){res.setHeader("Allow",methods.join(", "));return res.status(405).json({ok:false,error:"Method not allowed"});}
module.exports={authenticate,methodNotAllowed,setCors};