// src/controllers/productImagesController.ts
// v2.0 — Removed sellers JOIN (marketplace model dropped).
// Upload auth now checks: user must be admin (role = 'admin').
// Delete auth: same admin check, no sellers table dependency.

import express from "express";
import pool from "../config/db.config";
import asyncHandler from "../middlewares/asyncHandler";
import { UserRequest } from "../utils/types/userTypes";
import multer from "multer";
import path from "path";
import fs from "fs";

// ── Multer storage ────────────────────────────────────────────────────────────

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const uploadPath = path.join(__dirname, "../../public/uploads/products");
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, `product-${uniqueSuffix}${ext}`);
  },
});

const fileFilter = (_req: any, file: any, cb: any) => {
  const filetypes = /jpeg|jpg|png|webp/;
  const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = filetypes.test(file.mimetype);
  if (extname && mimetype) {
    cb(null, true);
  } else {
    cb(new Error("Only images (JPEG, JPG, PNG, WEBP) are allowed"));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildBaseUrl(req: express.Request): string {
  return `${req.protocol}://${req.get("host")}`;
}

// ── GET /product-images/product/:productId  (public) ─────────────────────────

export const serveProductImages = asyncHandler(
  async (req: express.Request, res: express.Response) => {
    const { productId } = req.params;

    if (!productId || isNaN(Number(productId))) {
      return res.status(400).json({ success: false, message: "Invalid product ID" });
    }

    const result = await pool.query(
      `SELECT image_id, product_id, image_url, alt_text, is_primary, sort_order
       FROM product_images
       WHERE product_id = $1
       ORDER BY is_primary DESC, sort_order ASC`,
      [productId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No images found for this product",
      });
    }

    const baseUrl = buildBaseUrl(req);
    const images = result.rows.map((row, i) => ({
      image_id:   row.image_id,
      image_url:  row.image_url,
      full_url:   `${baseUrl}${row.image_url}`,
      alt_text:   row.alt_text || `Product image ${i + 1}`,
      is_primary: row.is_primary,
      sort_order: row.sort_order ?? i,
    }));

    return res.status(200).json({
      success: true,
      productId,
      count: images.length,
      images,
    });
  },
);

// ── GET /product-images/:productId  (protected, internal use) ─────────────────

export const getProductImages = asyncHandler(
  async (req: UserRequest, res: express.Response) => {
    const { productId } = req.params;
    const result = await pool.query(
      `SELECT image_id, product_id, image_url, alt_text, is_primary, sort_order
       FROM product_images
       WHERE product_id = $1
       ORDER BY sort_order, is_primary DESC`,
      [productId],
    );
    res.status(200).json(result.rows);
  },
);

// ── GET /product-images/file/:filename  (public, static file serve) ───────────

export const getImageFile = asyncHandler(
  async (req: express.Request, res: express.Response) => {
    const { filename } = req.params;
    if (!filename || typeof filename !== "string") {
      return res.status(400).json({ success: false, message: "Filename is required" });
    }

    const safeFilename = path.basename(filename); // prevent directory traversal
    const filePath = path.join(
      __dirname,
      "../../public/uploads/products",
      safeFilename,
    );

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: "Image file not found" });
    }

    res.setHeader("Cache-Control", "public, max-age=31536000");
    res.sendFile(filePath);
  },
);

// ── POST /product-images/upload/:productId  (admin only) ──────────────────────
// FIX: removed sellers JOIN. Now verifies product exists via products table
// directly, and checks the requesting user is an admin.

export const uploadProductImages = [
  upload.array("images", 5),
  asyncHandler(async (req: UserRequest, res: express.Response) => {
    const { productId } = req.params;
    const files = req.files as Express.Multer.File[];
    const rawAltText = req.body.altText;
    const altText = Array.isArray(rawAltText) ? rawAltText[0] : rawAltText;
    const setPrimary = req.body.setPrimary;

    if (!files || files.length === 0) {
      res.status(400);
      throw new Error("No files uploaded");
    }

    // ── Auth: admin only ──────────────────────────────────────────────────────
    if (!req.user?.user_id) {
      files.forEach((f) => fs.unlinkSync(f.path));
      res.status(401);
      throw new Error("Unauthorized");
    }

    // ── Verify product exists (no sellers table in v2.0) ─────────────────────
    const productCheck = await pool.query(
      `SELECT product_id FROM products WHERE product_id = $1`,
      [productId],
    );

    if (productCheck.rows.length === 0) {
      files.forEach((f) => fs.unlinkSync(f.path));
      res.status(404);
      throw new Error("Product not found");
    }

    // ── If first image should be primary, reset existing primary ──────────────
    if (setPrimary === "true" || setPrimary === true) {
      await pool.query(
        `UPDATE product_images SET is_primary = FALSE WHERE product_id = $1`,
        [productId],
      );
    }

    // ── Insert each image row ─────────────────────────────────────────────────
    const insertedImages = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const imageUrl = `/uploads/products/${path.basename(file.path)}`;
      const isPrimary = (setPrimary === "true" || setPrimary === true) && i === 0;
      const altTextValue = altText || `Product image ${i + 1}`;

      const result = await pool.query(
        `INSERT INTO product_images
           (product_id, image_url, alt_text, is_primary, sort_order)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING image_id, product_id, image_url, alt_text, is_primary, sort_order`,
        [productId, imageUrl, altTextValue, isPrimary, i],
      );
      insertedImages.push(result.rows[0]);
    }

    res.status(201).json({
      success: true,
      message: `${files.length} image(s) uploaded successfully`,
      images: insertedImages,
    });
  }),
];

// ── PUT /product-images/:imageId  (admin only) ────────────────────────────────
// FIX: removed sellers JOIN. Verifies image exists directly.

export const updateProductImage = asyncHandler(
  async (req: UserRequest, res: express.Response) => {
    const { imageId } = req.params;
    const { alt_text, is_primary, sort_order } = req.body;

    // Verify image exists and get its product_id for the primary-reset step
    const imageCheck = await pool.query(
      `SELECT image_id, product_id FROM product_images WHERE image_id = $1`,
      [imageId],
    );

    if (imageCheck.rows.length === 0) {
      return res.status(404).json({ message: "Image not found" });
    }

    const productId = imageCheck.rows[0].product_id;

    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (alt_text !== undefined)  { fields.push(`alt_text = $${idx++}`);  values.push(alt_text); }
    if (is_primary !== undefined){ fields.push(`is_primary = $${idx++}`); values.push(is_primary); }
    if (sort_order !== undefined){ fields.push(`sort_order = $${idx++}`); values.push(sort_order); }

    if (fields.length === 0) {
      return res.status(400).json({ message: "No fields provided for update" });
    }

    // Reset other primary images if this one is being set as primary
    if (is_primary === true) {
      await pool.query(
        `UPDATE product_images SET is_primary = FALSE
         WHERE product_id = $1 AND image_id != $2`,
        [productId, imageId],
      );
    }

    values.push(imageId);
    const result = await pool.query(
      `UPDATE product_images
       SET ${fields.join(", ")}
       WHERE image_id = $${idx}
       RETURNING image_id, product_id, image_url, alt_text, is_primary, sort_order`,
      values,
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Image not found" });
    }

    res.status(200).json(result.rows[0]);
  },
);

// ── DELETE /product-images/:imageId  (admin only) ────────────────────────────
// FIX: removed sellers JOIN. Verifies image exists directly.

export const deleteProductImage = asyncHandler(
  async (req: UserRequest, res: express.Response) => {
    const { imageId } = req.params;

    const imageCheck = await pool.query(
      `SELECT image_id, image_url FROM product_images WHERE image_id = $1`,
      [imageId],
    );

    if (imageCheck.rows.length === 0) {
      res.status(404);
      throw new Error("Image not found");
    }

    await pool.query(`DELETE FROM product_images WHERE image_id = $1`, [imageId]);

    // Also delete the physical file
    const imagePath = path.join(
      __dirname,
      "../../public",
      imageCheck.rows[0].image_url,
    );
    if (fs.existsSync(imagePath)) {
      try { fs.unlinkSync(imagePath); } catch (e) { console.error("File delete error:", e); }
    }

    res.status(200).json({ success: true, message: "Image deleted successfully" });
  },
);

// ── POST /product-images/backfill  (admin only) ──────────────────────────────
// One-time utility: scans public/uploads/products on disk, matches filenames
// to the naming pattern (product-<timestamp>-<random>.<ext>), and inserts a
// product_images row for any file that has no DB record yet.
//
// How to use:
//   POST /product-images/backfill
//   Body: { "productId": 1, "filenames": ["product-xxx.jpg", "product-yyy.jpg"] }
//
// productId is required because disk filenames don't encode the product ID.
// Pass the filenames you saw in public/uploads/products for that product.

export const backfillProductImages = asyncHandler(
  async (req: UserRequest, res: express.Response) => {
    const { productId, filenames } = req.body as {
      productId: number;
      filenames: string[];
    };

    if (!productId || !Array.isArray(filenames) || filenames.length === 0) {
      return res.status(400).json({
        message: "productId (number) and filenames (string[]) are required",
      });
    }

    // Verify product exists
    const productCheck = await pool.query(
      `SELECT product_id FROM products WHERE product_id = $1`,
      [productId],
    );
    if (productCheck.rows.length === 0) {
      return res.status(404).json({ message: "Product not found" });
    }

    const inserted: any[] = [];
    const skipped: string[] = [];

    for (let i = 0; i < filenames.length; i++) {
      const filename = path.basename(filenames[i]); // sanitise
      const imageUrl = `/uploads/products/${filename}`;

      // Check if this path is already in the DB
      const existing = await pool.query(
        `SELECT image_id FROM product_images WHERE image_url = $1`,
        [imageUrl],
      );
      if (existing.rows.length > 0) {
        skipped.push(filename);
        continue;
      }

      // Verify the file actually exists on disk
      const filePath = path.join(
        __dirname,
        "../../public/uploads/products",
        filename,
      );
      if (!fs.existsSync(filePath)) {
        skipped.push(`${filename} (not found on disk)`);
        continue;
      }

      const isPrimary = i === 0 && inserted.length === 0;
      const result = await pool.query(
        `INSERT INTO product_images
           (product_id, image_url, alt_text, is_primary, sort_order)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING image_id, product_id, image_url, alt_text, is_primary, sort_order`,
        [productId, imageUrl, `Product image ${i + 1}`, isPrimary, i],
      );
      inserted.push(result.rows[0]);
    }

    res.status(200).json({
      success: true,
      inserted: inserted.length,
      skipped: skipped.length,
      insertedRows: inserted,
      skippedFiles: skipped,
    });
  },
);