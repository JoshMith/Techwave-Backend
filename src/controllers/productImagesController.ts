// CRUD operations for product images, upload images for production access. using multer for file uploads

// -- Product images
// CREATE TABLE product_images (
//     image_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
//     product_id UUID NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
//     image_url VARCHAR(255) NOT NULL,
//     alt_text VARCHAR(100),
//     is_primary BOOLEAN DEFAULT false,
//     sort_order INTEGER DEFAULT 0
// );

// src/controllers/productImagesController.ts
import express from "express";
import pool from "../config/db.config";
import asyncHandler from "../middlewares/asyncHandler";
import { UserRequest } from "../utils/types/userTypes";
import multer from "multer";
import path from "path";
import fs from "fs";

// Configure Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, "../../public/uploads/products");
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, `product-${uniqueSuffix}${ext}`);
  },
});

// File filter for image files only
const fileFilter = (req: any, file: any, cb: any) => {
  const filetypes = /jpeg|jpg|png|webp/;
  const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = filetypes.test(file.mimetype);

  if (extname && mimetype) {
    return cb(null, true);
  } else {
    cb(new Error("Only images (JPEG, JPG, PNG, WEBP) are allowed"));
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

// @desc    Get all images for a product
// @route   GET /api/product-images/:productId
// @access  Public
export const getProductImages = asyncHandler(
  async (req: UserRequest, res: express.Response) => {
    const { productId } = req.params;

    const query = `
    SELECT 
      image_id, 
      product_id,
      image_url, 
      alt_text, 
      is_primary, 
      sort_order
    FROM product_images
    WHERE product_id = $1
    ORDER BY sort_order, is_primary DESC
  `;

    const result = await pool.query(query, [productId]);

    res.status(200).json(result.rows);
  },
);

// @desc    Upload product images
// @route   POST /api/product-images/upload/:productId
// @access  Private/Seller
export const uploadProductImages = [
  upload.array("images", 5), // Max 5 images per upload
  asyncHandler(async (req: UserRequest, res: express.Response) => {
    const { productId } = req.params;
    const files = req.files as Express.Multer.File[];
    const { altText: rawAltText, setPrimary } = req.body;
    const altText = Array.isArray(rawAltText) ? rawAltText[0] : rawAltText;

    if (!files || files.length === 0) {
      res.status(400);
      throw new Error("No files uploaded");
    }

    if (req.user?.user_id === undefined) {
      res.status(401);
      throw new Error("Unauthorized");
    }

    // Verify product exists and belongs to the requesting seller
    const productCheck = await pool.query(
      `SELECT p.product_id, s.seller_id
       FROM products p
       JOIN sellers s ON p.seller_id = s.seller_id
       WHERE p.product_id = $1 AND s.user_id = $2`,
      [productId, req.user?.user_id],
    );

    if (productCheck.rows.length === 0) {
      // Clean up uploaded files if product doesn't exist
      files.forEach((file) => {
        fs.unlinkSync(file.path);
      });
      res.status(404);
      throw new Error("Product not found or unauthorized");
    }

    // If setting primary, first reset any existing primary image
    if (setPrimary === "true" || setPrimary === true) {
      await pool.query(
        `UPDATE product_images 
         SET is_primary = false 
         WHERE product_id = $1`,
        [productId],
      );
    }

    // Process each uploaded file
    const insertedImages = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const imageUrl = `/uploads/products/${path.basename(file.path)}`;
      const isPrimary =
        (setPrimary === "true" || setPrimary === true) && i === 0;
      const altTextValue = altText || `Product image ${i + 1}`;

      const result = await pool.query(
        `INSERT INTO product_images (
          product_id, 
          image_url, 
          alt_text,
          is_primary,
          sort_order
        ) VALUES ($1, $2, $3, $4, $5)
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

// @desc    Update product image details
// @route   PUT /api/product-images/:imageId
// @access  Private/Seller
export const updateProductImage = asyncHandler(
  async (req: UserRequest, res: express.Response) => {
    const { imageId } = req.params;
    const { alt_text, is_primary, sort_order } = req.body;

    // Verify image belongs to seller's product
    const imageCheck = await pool.query(
      `SELECT pi.image_id, pi.product_id
     FROM product_images pi
     JOIN products p ON pi.product_id = p.product_id
     JOIN sellers s ON p.seller_id = s.seller_id
     WHERE pi.image_id = $1 AND s.user_id = $2`,
      [imageId, req.user?.user_id],
    );

    if (imageCheck.rows.length === 0) {
      return res
        .status(404)
        .json({ message: "Image not found or unauthorized" });
    }

    const productId = imageCheck.rows[0].product_id;

    const fieldsToUpdate: string[] = [];
    const values: any[] = [];
    let index = 1;

    if (alt_text !== undefined) {
      fieldsToUpdate.push(`alt_text = $${index++}`);
      values.push(alt_text);
    }
    if (is_primary !== undefined) {
      fieldsToUpdate.push(`is_primary = $${index++}`);
      values.push(is_primary);
    }
    if (sort_order !== undefined) {
      fieldsToUpdate.push(`sort_order = $${index++}`);
      values.push(sort_order);
    }

    if (fieldsToUpdate.length === 0) {
      return res.status(400).json({ message: "No fields provided for update" });
    }

    values.push(imageId);

    // If setting as primary, first reset existing primary image
    if (is_primary === true) {
      await pool.query(
        `UPDATE product_images 
       SET is_primary = false 
       WHERE product_id = $1 AND image_id != $2`,
        [productId, imageId],
      );
    }

    const query = `
    UPDATE product_images
    SET ${fieldsToUpdate.join(", ")}
    WHERE image_id = $${index}
    RETURNING image_id, product_id, image_url, alt_text, is_primary, sort_order
  `;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Image not found" });
    }

    res.status(200).json(result.rows[0]);
  },
);

// @desc    Delete a product image
// @route   DELETE /api/product-images/:imageId
// @access  Private/Seller
export const deleteProductImage = asyncHandler(
  async (req: UserRequest, res: express.Response) => {
    const { imageId } = req.params;

    // Verify image belongs to seller's product and get image URL
    const imageCheck = await pool.query(
      `SELECT pi.image_url, pi.product_id
     FROM product_images pi
     JOIN products p ON pi.product_id = p.product_id
     JOIN sellers s ON p.seller_id = s.seller_id
     WHERE pi.image_id = $1 AND s.user_id = $2`,
      [imageId, req.user?.user_id],
    );

    if (imageCheck.rows.length === 0) {
      res.status(404);
      throw new Error("Image not found or unauthorized");
    }

    // Delete from database
    await pool.query(
      `DELETE FROM product_images 
     WHERE image_id = $1`,
      [imageId],
    );

    // Delete the actual file
    const imagePath = path.join(
      __dirname,
      "../../public",
      imageCheck.rows[0].image_url,
    );
    if (fs.existsSync(imagePath)) {
      try {
        fs.unlinkSync(imagePath);
      } catch (error) {
        console.error("Error deleting file:", error);
      }
    }

    res.status(200).json({
      success: true,
      message: "Image deleted successfully",
    });
  },
);

// @desc    Serve product images statically by productId
// @route   GET /api/product-images/product/:productId
// @access  Public
export const serveProductImages = asyncHandler(
  async (req: express.Request, res: express.Response) => {
    try {
      const { productId } = req.params;

      // Validate productId
      if (!productId || isNaN(Number(productId))) {
        return res.status(400).json({
          success: false,
          message: "Invalid product ID",
        });
      }

      const query = `
      SELECT image_url, alt_text, is_primary, sort_order 
      FROM product_images 
      WHERE product_id = $1 
      ORDER BY is_primary DESC, sort_order ASC
    `;

      const result = await pool.query(query, [productId]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "No images found for this product",
        });
      }

      // Construct full URLs for the images
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const imagesWithFullUrls = result.rows.map((row, index) => ({
        image_id: row.image_id,
        image_url: row.image_url,
        full_url: `${baseUrl}${row.image_url}`, // This will be accessible via static serving
        alt_text: row.alt_text || `Product image ${index + 1}`,
        is_primary: row.is_primary,
        sort_order: row.sort_order || index,
      }));

      return res.status(200).json({
        success: true,
        productId: productId,
        count: imagesWithFullUrls.length,
        images: imagesWithFullUrls,
      });
    } catch (error) {
      console.error("Error serving product images:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  },
);

// @desc    Get individual image file
// @route   GET /api/product-images/file/:filename
// @access  Public
export const getImageFile = asyncHandler(
  async (req: express.Request, res: express.Response) => {
    try {
      const { filename } = req.params;

      if (!filename || typeof filename !== "string") {
        return res.status(400).json({
          success: false,
          message: "Filename is required",
        });
      }

      // Security: Prevent directory traversal
      const safeFilename = path.basename(filename);
      const filePath = path.join(
        __dirname,
        "../../public/uploads/products",
        safeFilename,
      );

      // Check if file exists
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({
          success: false,
          message: "Image file not found",
        });
      }

      // Set cache headers for better performance
      res.setHeader("Cache-Control", "public, max-age=31536000"); // 1 year cache
      res.sendFile(filePath);
    } catch (error) {
      console.error("Error serving image file:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  },
);
