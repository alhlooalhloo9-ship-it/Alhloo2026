"use strict";
const crypto=require("crypto");
const {ObjectId}=require("mongodb");
const {getDatabase}=require("../server/mongodb");
const {authenticate,methodNotAllowed,setCors}=require("../server/http");
const {hashLoginName}=require("../server/auth");
function makeLogin(){return "ndw-"+crypto.randomBytes(7).toString("hex");}
module.exports=async function(req,res){
 setCors(req,res);if(req.method==="OPTIONS")return res.status(204).end();
 const actor=await authenticate(req,res);if(!actor)return;
 if(actor.role!=="owner")return res.status(403).json({ok:false,error:"هذه الصفحة خاصة بمالك التطبيق"});
 try{
  const db=await getDatabase(),users=db.collection("users");
  if(req.method==="GET"){const rows=await users.find({ownerId:"owner"}).sort({createdAt:-1}).toArray();return res.status(200).json({ok:true,users:rows.map(u=>({id:String(u._id),label:u.label,active:!!u.active,permissions:u.permissions||{},sharing:u.sharing||{mode:"shared"},createdAt:u.createdAt}))});}
  if(req.method==="POST"){
   const label=String(req.body&&req.body.label||"").trim().slice(0,60);if(!label)return res.status(400).json({ok:false,error:"اكتب اسم الشريك للتعريف به"});
   const mode=req.body&&req.body.mode==="independent"?"independent":"shared",login=makeLogin(),now=new Date().toISOString();
   const permissions={viewProducts:true,viewStock:true,viewPurchasePrices:false,viewProfits:false,viewInvoices:true,viewSales:false,editProducts:false,deleteProducts:false,recordSales:true,manageInvoices:false,manageStock:false,manageSettings:false};
   const workspaceId=mode==="shared"?"owner":"user:"+crypto.randomUUID();
   const result=await users.insertOne({label,ownerId:"owner",loginHash:hashLoginName(login),workspaceId,active:true,permissions,sharing:{mode,shareProducts:mode==="shared",shareStock:mode==="shared",shareInvoices:mode==="shared",shareSales:false,partnerChangesVisibleToOwner:mode==="shared"},createdAt:now,updatedAt:now});
   return res.status(201).json({ok:true,user:{id:String(result.insertedId),label,loginName:login,active:true,permissions,sharing:{mode}}});
  }
  if(req.method==="PATCH"){
   const id=String(req.body&&req.body.id||""),action=req.body&&req.body.action;if(!ObjectId.isValid(id))return res.status(400).json({ok:false,error:"معرّف المستخدم غير صحيح"});
   const user=await users.findOne({_id:new ObjectId(id)});if(!user)return res.status(404).json({ok:false,error:"المستخدم غير موجود"});
   if(action==="toggle"){await users.updateOne({_id:user._id},{$set:{active:!user.active,updatedAt:new Date().toISOString()}});return res.status(200).json({ok:true,active:!user.active});}
   if(action==="permissions"){const p=req.body.permissions||{},keys=["viewProducts","viewStock","viewPurchasePrices","viewProfits","viewInvoices","viewSales","editProducts","deleteProducts","recordSales","manageInvoices","manageStock","manageSettings"],clean={};for(const k of keys)clean[k]=!!p[k];await users.updateOne({_id:user._id},{$set:{permissions:clean,updatedAt:new Date().toISOString()}});return res.status(200).json({ok:true});}
   if(action==="sharing"){const s=req.body.sharing||{},mode=s.mode==="independent"?"independent":"shared";await users.updateOne({_id:user._id},{$set:{workspaceId:mode==="shared"?"owner":"user:"+String(user._id),sharing:{mode,shareProducts:!!s.shareProducts,shareStock:!!s.shareStock,shareInvoices:!!s.shareInvoices,shareSales:!!s.shareSales,partnerChangesVisibleToOwner:!!s.partnerChangesVisibleToOwner},updatedAt:new Date().toISOString()}});return res.status(200).json({ok:true});}
   if(action==="reset-login"){const login=makeLogin();await users.updateOne({_id:user._id},{$set:{loginHash:hashLoginName(login),updatedAt:new Date().toISOString()}});return res.status(200).json({ok:true,loginName:login});}
   return res.status(400).json({ok:false,error:"إجراء غير معروف"});
  }
  return methodNotAllowed(res,["GET","POST","PATCH","OPTIONS"]);
 }catch(e){console.error("Users API:",e);return res.status(500).json({ok:false,error:"تعذر تنفيذ إدارة المستخدمين"});}
};