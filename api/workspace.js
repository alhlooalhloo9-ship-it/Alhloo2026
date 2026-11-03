"use strict";

const { getDatabase } = require("../server/mongodb");
const { authenticate, methodNotAllowed } = require("../server/http");

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

module.exports = async function workspaceHandler(req, res) {
  const user = await authenticate(req, res);
  if (!user) return;

  try {
    const collection = (await getDatabase()).collection("workspaces");
    const userId = user.uid;

    if (req.method === "GET") {
      const row = await collection.findOne({ userId });
      if (!row) return res.status(200).json({ ok: true, workspace: null });
      const { _id, userId: ignoredUserId, ...workspace } = row;
      return res.status(200).json({ ok: true, workspace });
    }

    if (req.method === "PUT") {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const suppliers = Array.isArray(body.suppliers) ? body.suppliers : [];
      const invoiceArchive = Array.isArray(body.invoiceArchive) ? body.invoiceArchive : [];
      const supplierCarts = body.supplierCarts && typeof body.supplierCarts === "object" && !Array.isArray(body.supplierCarts)
        ? body.supplierCarts : {};
      const activeSupplierId = String(body.activeSupplierId || "general");
      // Keep permanent deletion markers so older workspace snapshots cannot resurrect deleted stores.
      const canonicalStoreId = id => String(id == null ? "" : id) === "general" ? "main" : String(id == null ? "" : id);
      // اجمع علامات الحذف مع السجل الموجود في قاعدة البيانات؛ لا تسمح لنسخة جهاز قديمة
      // أو طلب متزامن أن يمحو علامة حذف سبق تسجيلها.
      const existing = await collection.findOne({ userId }, { projection: { deletedSupplierIds: 1 } });
      const deletedSupplierIds = Array.from(new Set([
        ...(Array.isArray(existing?.deletedSupplierIds) ? existing.deletedSupplierIds : []),
        ...(Array.isArray(body.deletedSupplierIds) ? body.deletedSupplierIds : [])
      ].filter(id => id != null).map(canonicalStoreId).filter(Boolean)));
      const deletedStoreSet = new Set(deletedSupplierIds);
      const cleanSuppliers = suppliers
        .filter(x => x && x.id != null && !deletedStoreSet.has(canonicalStoreId(x.id)))
        .map(x => ({ ...x, id: canonicalStoreId(x.id) }));
      const cleanSupplierCarts = {};
      for (const [storeId, items] of Object.entries(supplierCarts)) {
        const canonicalId = canonicalStoreId(storeId);
        if (!deletedStoreSet.has(canonicalId) && items && typeof items === "object" && !Array.isArray(items)) {
          cleanSupplierCarts[canonicalId] = items;
        }
      }

      if (cleanSuppliers.length > 2000 || invoiceArchive.length > 5000 ||
          Object.keys(cleanSupplierCarts).length > 2000 || deletedSupplierIds.length > 5000) {
        return res.status(413).json({ ok: false, error: "Workspace exceeds allowed record limits" });
      }
      if (suppliers.some(x => !x || typeof x !== "object" || x.id == null) ||
          invoiceArchive.some(x => !x || typeof x !== "object" || x.id == null)) {
        return res.status(400).json({ ok: false, error: "Invalid workspace records" });
      }

      const workspace = { suppliers: cleanSuppliers, supplierCarts: cleanSupplierCarts, invoiceArchive, activeSupplierId, deletedSupplierIds };
      const bytes = Buffer.byteLength(JSON.stringify(workspace), "utf8");
      if (bytes > MAX_DOCUMENT_BYTES) {
        return res.status(413).json({ ok: false, error: "Workspace data is too large; export a backup before reducing archived records" });
      }

      const now = new Date().toISOString();
      await collection.updateOne(
        { userId },
        { $set: { ...workspace, updatedAt: now }, $setOnInsert: { userId, createdAt: now } },
        { upsert: true }
      );
      return res.status(200).json({ ok: true, savedBytes: bytes });
    }

    return methodNotAllowed(res, ["GET", "PUT", "OPTIONS"]);
  } catch (error) {
    console.error("Workspace API error:", error);
    return res.status(error.statusCode || 500).json({
      ok: false,
      error: "Workspace service unavailable"
    });
  }
};
