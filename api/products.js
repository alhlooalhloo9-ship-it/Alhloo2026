"use strict";
const {getDatabase}=require("../server/mongodb");
const {authenticate,methodNotAllowed}=require("../server/http");
module.exports=async function(req,res){
 const user=await authenticate(req,res); if(!user)return;
 try{
  const db=await getDatabase(), col=db.collection("products"), userId=user.uid;
  if(req.method==="GET"){
   const rows=await col.find({userId}).toArray();
   return res.status(200).json({ok:true,products:rows.map(({_id,...x})=>x)});
  }
  if(req.method==="POST"){
   const list=req.body&&req.body.products;
   if(!Array.isArray(list)||list.length>5000)return res.status(400).json({ok:false,error:"Invalid products payload"});
   const now=new Date().toISOString();
   const ops=list.filter(p=>p&&p.id!=null).map(p=>({
    updateOne:{filter:{userId,id:String(p.id)},update:{$set:{...p,id:String(p.id),userId,updatedAt:now},$setOnInsert:{createdAt:now}},upsert:true}
   }));
   if(ops.length)await col.bulkWrite(ops,{ordered:false});
   return res.status(200).json({ok:true,saved:ops.length});
  }
  return methodNotAllowed(res,["GET","POST","OPTIONS"]);
 }catch(e){console.error("products API:",e);return res.status(e.statusCode||500).json({ok:false,error:"Products service unavailable"});}
};
