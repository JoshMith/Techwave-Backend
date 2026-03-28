import express from "express";
import pool from "../config/db.config";
import asyncHandler from "../middlewares/asyncHandler";
import { UserRequest } from "../utils/types/userTypes";

// ============================================================
// PRODUCTS CONTROLLER — v2.0
// Removed: seller_id, sellers JOIN
// Added:   created_by (admin user_id), is_active filter
// ============================================================

export const getProducts = asyncHandler(async (req: UserRequest, res: express.Response) => {
    const result = await pool.query(
        `SELECT
             p.product_id, p.title, p.description, p.price, p.sale_price,
             p.is_on_sale, p.stock, p.specs, p.rating, p.review_count,
             p.condition, p.condition_notes, p.warranty_info, p.is_active,
             p.created_at, p.updated_at,
             c.name AS category_name,
             u.name AS created_by_name
         FROM products p
         JOIN categories c ON p.category_id = c.category_id
         JOIN users u ON p.created_by = u.user_id
         WHERE p.is_active = TRUE
         ORDER BY p.created_at DESC`
    );
    res.status(200).json(result.rows);
});

export const getProductById = asyncHandler(async (req: UserRequest, res: express.Response) => {
    const { id } = req.params;
    const result = await pool.query(
        `SELECT
             p.product_id, p.title, p.description, p.price, p.sale_price,
             p.is_on_sale, p.stock, p.specs, p.rating, p.review_count,
             p.condition, p.condition_notes, p.warranty_info, p.is_active,
             p.created_at, p.updated_at,
             c.name AS category_name, c.category_id,
             u.name AS created_by_name
         FROM products p
         JOIN categories c ON p.category_id = c.category_id
         JOIN users u ON p.created_by = u.user_id
         WHERE p.product_id = $1`,
        [id]
    );
    if (result.rows.length === 0) {
        return res.status(404).json({ message: "Product not found" });
    }
    res.status(200).json(result.rows[0]);
});

export const getProductsByCategoryName = asyncHandler(async (req: UserRequest, res: express.Response) => {
    const { name } = req.params;
    const result = await pool.query(
        `SELECT
             p.product_id, p.title, p.description, p.price, p.sale_price,
             p.is_on_sale, p.stock, p.specs, p.rating, p.review_count,
             p.condition, p.condition_notes, p.created_at,
             c.name AS category_name
         FROM products p
         JOIN categories c ON p.category_id = c.category_id
         WHERE c.name ILIKE $1 AND p.is_active = TRUE
         ORDER BY p.created_at DESC`,
        [`%${name}%`]
    );
    if (result.rows.length === 0) {
        return res.status(404).json({ message: "No products found for this category" });
    }
    res.status(200).json(result.rows);
});

// @desc    Create product — Admin only. created_by = logged-in admin.
export const createProduct = asyncHandler(async (req: UserRequest, res: express.Response) => {
    const adminId = req.user?.user_id;
    if (!adminId) return res.status(401).json({ message: "Unauthorized" });

    const {
        category_id, title, description, price, sale_price,
        is_on_sale, stock, specs, condition, condition_notes, warranty_info
    } = req.body;

    if (!category_id || !title || !price) {
        return res.status(400).json({ message: "category_id, title, and price are required" });
    }

    const result = await pool.query(
        `INSERT INTO products
             (created_by, category_id, title, description, price, sale_price,
              is_on_sale, stock, specs, condition, condition_notes, warranty_info)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING product_id`,
        [
            adminId, category_id, title, description, price,
            sale_price || null, is_on_sale || false,
            stock || 0, specs || null,
            condition || "new", condition_notes || null, warranty_info || null
        ]
    );
    res.status(201).json({ message: "Product created", productId: result.rows[0].product_id });
});

export const updateProduct = asyncHandler(async (req: UserRequest, res: express.Response) => {
    const { id } = req.params;
    const {
        title, description, price, sale_price, is_on_sale,
        stock, specs, category_id, rating, review_count,
        condition, condition_notes, warranty_info, is_active
    } = req.body;

    const fields: string[] = [];
    const values: any[] = [];
    let i = 1;

    const addField = (col: string, val: any) => {
        if (val !== undefined) { fields.push(`${col} = $${i++}`); values.push(val); }
    };
    addField("title",           title);
    addField("description",     description);
    addField("price",           price);
    addField("sale_price",      sale_price);
    addField("is_on_sale",      is_on_sale);
    addField("stock",           stock);
    addField("specs",           specs);
    addField("category_id",     category_id);
    addField("rating",          rating);
    addField("review_count",    review_count);
    addField("condition",       condition);
    addField("condition_notes", condition_notes);
    addField("warranty_info",   warranty_info);
    addField("is_active",       is_active);

    if (fields.length === 0) return res.status(400).json({ message: "No fields provided" });
    fields.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);

    const result = await pool.query(
        `UPDATE products SET ${fields.join(", ")} WHERE product_id = $${i++} RETURNING product_id`,
        values
    );
    if (result.rows.length === 0) return res.status(404).json({ message: "Product not found" });
    res.status(200).json({ message: "Product updated", productId: result.rows[0].product_id });
});

export const deleteProduct = asyncHandler(async (req: UserRequest, res: express.Response) => {
    const { id } = req.params;
    // Soft delete — set is_active = FALSE to preserve order history
    const result = await pool.query(
        `UPDATE products SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
         WHERE product_id = $1 RETURNING product_id`,
        [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: "Product not found" });
    res.status(200).json({ message: "Product removed from storefront", productId: result.rows[0].product_id });
});

export const getProductsCountByCategoryId = asyncHandler(async (req: UserRequest, res: express.Response) => {
    const { id } = req.params;
    const result = await pool.query(
        `SELECT COUNT(*) AS count FROM products WHERE category_id = $1 AND is_active = TRUE`,
        [id]
    );
    res.status(200).json({ count: parseInt(result.rows[0].count, 10) });
});