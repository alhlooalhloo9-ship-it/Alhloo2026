"use strict";
const { randomBytes } = require("crypto");
const { GridFSBucket } = require("mongodb");
const { getDatabase } = require("../server/mongodb");
const { authenticate, setCors, methodNotAllowed } = require("../server/http");

const MAX_BYTES = 2.8 * 1024 * 1024;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function matches(buffer, type) {
  if (type === "image/jpeg") return buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
  if (type === "image/png") return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (type === "image/webp") return buffer.length >= 12 && buffer.toString("ascii",0,4) === "RIFF" && buffer.toString("ascii",8,12) === "WEBP";
  if (type === "image/gif") return buffer.length >= 6 && ["GIF87a","GIF89a"].includes(buffer.toString("ascii",0,6));
  return false;
}
async function bucket() {
  return new GridFSBucket(await getDatabase(), { bucketName: "product_images" });
}

module.exports = async function handler(req, res) {
  setCors(req,res);
  if (req.method === "OPTIONS") return res.status(204).end();
  try {
    if (req.method === "GET") {
      const id = String(req.query && req.query.id || "");
      if (!/^[a-f0-9]{32}$/.test(id)) return res.status(400).end();
      const store = await bucket();
      const file = (await store.find({ _id: id }).limit(1).toArray())[0];
      if (!file) return res.status(404).end();
      const type = TYPES.has(file.metadata && file.metadata.contentType) ? file.metadata.contentType : "image/jpeg";
      res.status(200);
      res.setHeader("Content-Type",type);
      res.setHeader("Content-Length",String(file.length));
      res.setHeader("X-Content-Type-Options","nosniff");
      res.setHeader("Cache-Control","public, max-age=31536000, immutable");
      const stream = store.openDownloadStream(id);
      stream.on("error",e=>{ console.error("Image read error",e); if(!res.headersSent)res.status(404).end(); else res.destroy(e); });
      stream.pipe(res);
      return;
    }
    if (req.method === "POST") {
      const user = await authenticate(req,res);
      if (!user) return;
      const body = req.body || {};
      const productId = String(body.productId || "");
      const type = String(body.mimeType || "").toLowerCase();
      const encoded = String(body.data || "");
      if (!productId || productId.length > 160 || !TYPES.has(type)) return res.status(400).json({ok:false,error:"Invalid image metadata"});
      if (!encoded || encoded.length > Math.ceil(MAX_BYTES * 4 / 3) + 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return res.status(413).json({ok:false,error:"Image too large"});
      const data = Buffer.from(encoded,"base64");
      if (!data.length || data.length > MAX_BYTES || !matches(data,type)) return res.status(400).json({ok:false,error:"Invalid image data"});
      const id = randomBytes(16).toString("hex");
      const store = await bucket();
      const stream = store.openUploadStreamWithId(id,"product-"+productId,{metadata:{userId:user.uid,productId,contentType:type,uploadedAt:new Date()}});
      await new Promise((resolve,reject)=>{stream.once("finish",resolve);stream.once("error",reject);stream.end(data);});
      return res.status(201).json({ok:true,id,url:"https://alhloo2026.vercel.app/api/images?id="+id,size:data.length});
    }
    return methodNotAllowed(res,["GET","POST","OPTIONS"]);
  } catch (e) {
    console.error("Image API error",e);
    return res.status(e.statusCode || 500).json({ok:false,error:e.statusCode ? e.message : "Image storage unavailable"});
  }
};
module.exports.config = { api: { bodyParser: { sizeLimit: "4mb" } } };
