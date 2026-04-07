// src/routes/productImagesRoutes.ts
// v2.0 — Removed sellers guard. All mutations require admin role.
// Added: POST /backfill for one-time DB recovery of orphaned disk images.

import express from "express";
import {
  serveProductImages,
  getProductImages,
  getImageFile,
  uploadProductImages,
  updateProductImage,
  deleteProductImage,
  backfillProductImages,
} from "../controllers/productImagesController";
import { protect } from "../middlewares/auth/protect";
import { adminGuard } from "../middlewares/auth/roleMiddleWare";

const router = express.Router();

// ── Public routes ─────────────────────────────────────────────────────────────
router.get("/product/:productId", serveProductImages);   // storefront image fetch
router.get("/file/:filename",     getImageFile);          // static file fallback

// ── Admin-only mutations ──────────────────────────────────────────────────────
router.get(  "/:productId",              protect, adminGuard, getProductImages);
router.post( "/upload/:productId",       protect, adminGuard, uploadProductImages);
router.post( "/backfill",                protect, adminGuard, backfillProductImages);
router.put(  "/:imageId",               protect, adminGuard, updateProductImage);
router.delete("/:imageId",              protect, adminGuard, deleteProductImage);

export default router;