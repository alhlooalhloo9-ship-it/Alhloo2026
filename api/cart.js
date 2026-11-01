"use strict";
const {getDatabase}=require("../server/mongodb");
const {authenticate,methodNotAllowed}=require("../server/http");
module.exports=async function(req,res){
 const user=await authenticate(req,res); if(!user)return;
 try{
  const col=(await getDatabase()).collection("carts"),userId=user.uid;
  if(req.method==="GET"){const row=await col.findOne({userId});return res.status(200).json({ok:true,items:row?.items||{}});}
  if(req.method==="PUT"){
   const items=req.body&&req.body.items;
   if(!items||typeof items!=="object"||Array.isArray(items))return res.status(400).json({ok:false,error:"Invalid cart payload"});
   const clean={};for(const [k,v] of Object.entries(items)){const n=Number(v);if(Number.isFinite(n)&&n>0)clean[String(k)]=n;}
   await col.updateOne({userId},{$set:{items:clean,updatedAt:new Date().toISOString()},$setOnInsert:{userId,createdAt:new Date().toISOString()}},{upsert:true});
   return res.status(200).json({ok:true});
  }
  return methodNotAllowed(res,["GET","PUT","OPTIONS"]);
 }catch(e){console.error("cart API:",e);return res.status(e.statusCode||500).json({ok:false,error:"Cart service unavailable"});}
};
