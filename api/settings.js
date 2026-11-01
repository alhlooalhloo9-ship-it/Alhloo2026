"use strict";
const {getDatabase}=require("../server/mongodb");
const {authenticate,methodNotAllowed}=require("../server/http");
module.exports=async function(req,res){
 const user=await authenticate(req,res); if(!user)return;
 try{
  const col=(await getDatabase()).collection("settings"),userId=user.uid;
  if(req.method==="GET"){const row=await col.findOne({userId});return res.status(200).json({ok:true,settings:row?.settings||null});}
  if(req.method==="PUT"){
   const settings=req.body&&req.body.settings;
   if(!settings||typeof settings!=="object"||Array.isArray(settings))return res.status(400).json({ok:false,error:"Invalid settings payload"});
   await col.updateOne({userId},{$set:{settings,updatedAt:new Date().toISOString()},$setOnInsert:{userId,createdAt:new Date().toISOString()}},{upsert:true});
   return res.status(200).json({ok:true});
  }
  return methodNotAllowed(res,["GET","PUT","OPTIONS"]);
 }catch(e){console.error("settings API:",e);return res.status(e.statusCode||500).json({ok:false,error:"Settings service unavailable"});}
};
