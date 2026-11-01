"use strict";
const { requireFirebaseUser } = require("./auth");
function setCors(req,res){
  const origin=req.headers.origin||"";
  const allowed=["https://alhlooalhloo9-ship-it.github.io","https://alhloo2026.vercel.app"];
  if(allowed.includes(origin)){res.setHeader("Access-Control-Allow-Origin",origin);res.setHeader("Vary","Origin");}
  res.setHeader("Access-Control-Allow-Headers","Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods","GET, POST, PUT, OPTIONS");
}
async function authenticate(req,res){
  setCors(req,res);
  if(req.method==="OPTIONS"){res.status(204).end();return null;}
  try{return await requireFirebaseUser(req);}
  catch(e){res.status(e.statusCode||401).json({ok:false,error:e.message});return null;}
}
function methodNotAllowed(res,methods){res.setHeader("Allow",methods.join(", "));return res.status(405).json({ok:false,error:"Method not allowed"});}
module.exports={authenticate,methodNotAllowed,setCors};
