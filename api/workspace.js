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
      const deletedSupplierIds = Array.isArray(body.deletedSupplierIds)
        ? Array.from(new Set(body.deletedSupplierIds.filter(id => id != null).map(id => String(id))))
        : [];

      if (suppliers.length > 2000 || invoiceArchive.length > 5000 ||
          Object.keys(supplierCarts).length > 2000 || deletedSupplierIds.length > 5000) {
        return res.status(413).json({ ok: false, error: "Workspace exceeds allowed record limits" });
      }
      if (suppliers.some(x => !x || typeof x !== "object" || x.id == null) ||
          invoiceArchive.some(x => !x || typeof x !== "object" || x.id == null)) {
        return res.status(400).json({ ok: false, error: "Invalid workspace records" });
      }

      const workspace = { suppliers, supplierCarts, invoiceArchive, activeSupplierId, deletedSupplierIds };
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
