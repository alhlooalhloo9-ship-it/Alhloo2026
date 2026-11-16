"use strict";
const {getDatabase}=require("../server/mongodb");
module.exports=async function(req,res){
 res.setHeader("Cache-Control","no-store");
 if(req.method!=="GET"){res.setHeader("Allow","GET");return res.status(405).json({ok:false,error:"Method not allowed"});}
 const checks={ownerConfigured:Boolean(process.env.NADWA_OWNER_USERNAME),sessionSecretConfigured:String(process.env.NADWA_SESSION_SECRET||"").length>=32,mongoConfigured:Boolean(process.env.NADWA_MONGODB_URI),mongoReachable:false,mongoError:null};
 try{const db=await getDatabase();await db.command({ping:1});checks.mongoReachable=true;}catch(e){checks.mongoError=e.message;console.error("Nadwa health check:",e);}
 const ready=checks.ownerConfigured&&checks.sessionSecretConfigured&&checks.mongoConfigured&&checks.mongoReachable;
 return res.status(ready?200:503).json({ok:ready,service:"badaat-alnadwa-api",storage:"NadwaShared",authentication:"username-session",checks});
};