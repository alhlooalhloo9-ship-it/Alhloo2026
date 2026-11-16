"use strict";
const { MongoClient } = require("mongodb");
let clientPromise;
async function getMongoClient(){
 const uri=String(process.env.NADWA_MONGODB_URI||"").trim();
 if(!uri){const e=new Error("NADWA_MONGODB_URI is not configured");e.statusCode=503;throw e;}
 if(!/^mongodb(?:\\+srv)?:\\/\\//i.test(uri)){const e=new Error("Invalid NADWA_MONGODB_URI");e.statusCode=503;throw e;}
 if(!clientPromise){const client=new MongoClient(uri,{serverSelectionTimeoutMS:10000,maxPoolSize:5});clientPromise=client.connect().catch(e=>{clientPromise=undefined;throw e;});}
 return clientPromise;
}
async function getDatabase(){const client=await getMongoClient();return client.db("NadwaShared");}
module.exports={getMongoClient,getDatabase};