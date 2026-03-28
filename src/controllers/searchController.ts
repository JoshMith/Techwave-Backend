import express from "express";
import pool from "../config/db.config";
import asyncHandler from "../middlewares/asyncHandler";
import { UserRequest } from "../utils/types/userTypes";

// ============================================================
// SEARCH CONTROLLER — v2.0
// Removed: sellers JOIN (products are now admin-owned)
// ============================================================

export const searchProducts = asyncHandler(async (req: UserRequest, res: express.Response) => {
    const {
        q = "", category, minPrice, maxPrice, brand,
        sort = "relevance", page = "1", limit = "12"
    } = req.query as Record<string, string>;

    const pageNum    = Math.max(1, parseInt(page));
    const limitNum   = Math.min(50, Math.max(1, parseInt(limit)));
    const offset     = (pageNum - 1) * limitNum;
    const conditions: string[] = ["p.is_active = TRUE"];
    const values: any[] = [];
    let idx = 1;

    if (q.trim()) {
        conditions.push(`(
            to_tsvector('english', p.title || ' ' || COALESCE(p.description,'') || ' ' || COALESCE(p.specs::text,''))
            @@ plainto_tsquery('english', $${idx})
            OR p.title ILIKE $${idx + 1}
        )`);
        values.push(q.trim(), `%${q.trim()}%`);
        idx += 2;
    }
    if (category && category !== "all") {
        conditions.push(`c.name ILIKE $${idx++}`);
        values.push(`%${category}%`);
    }
    if (minPrice) { conditions.push(`COALESCE(p.sale_price, p.price) >= $${idx++}`); values.push(parseFloat(minPrice)); }
    if (maxPrice) { conditions.push(`COALESCE(p.sale_price, p.price) <= $${idx++}`); values.push(parseFloat(maxPrice)); }
    if (brand && brand !== "all") {
        conditions.push(`p.specs->>'brand' ILIKE $${idx++}`);
        values.push(`%${brand}%`);
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    let orderClause = "ORDER BY p.created_at DESC";
    switch (sort) {
        case "price-low":  orderClause = "ORDER BY COALESCE(p.sale_price, p.price) ASC";   break;
        case "price-high": orderClause = "ORDER BY COALESCE(p.sale_price, p.price) DESC";  break;
        case "rating":     orderClause = "ORDER BY p.rating DESC, p.review_count DESC";    break;
        case "newest":     orderClause = "ORDER BY p.created_at DESC";                     break;
        case "popularity": orderClause = "ORDER BY p.review_count DESC, p.rating DESC";    break;
    }

    const query = `
        SELECT
            p.product_id, p.title, p.description, p.price, p.sale_price,
            p.is_on_sale, p.stock, p.specs, p.rating, p.review_count,
            p.condition, p.created_at,
            c.name AS category_name, c.category_id
        FROM products p
        JOIN categories c ON p.category_id = c.category_id
        ${whereClause}
        ${orderClause}
        LIMIT $${idx} OFFSET $${idx + 1}
    `;
    values.push(limitNum, offset);

    const countQuery = `
        SELECT COUNT(*) AS total
        FROM products p
        JOIN categories c ON p.category_id = c.category_id
        ${whereClause}
    `;

    const [result, countResult] = await Promise.all([
        pool.query(query, values),
        pool.query(countQuery, values.slice(0, -2)),
    ]);

    const total      = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(total / limitNum);

    res.status(200).json({
        products: result.rows,
        pagination: { total, page: pageNum, limit: limitNum, totalPages,
                      hasNext: pageNum < totalPages, hasPrev: pageNum > 1 },
        query: q,
        filters: { category, minPrice, maxPrice, brand, sort },
    });
});

export const getSearchSuggestions = asyncHandler(async (req: UserRequest, res: express.Response) => {
    const { q = "" } = req.query as Record<string, string>;
    if (!q.trim() || q.trim().length < 2) return res.status(200).json({ suggestions: [] });

    const products = await pool.query(
        `SELECT DISTINCT p.product_id, p.title, p.review_count,
                c.name AS category_name,
                p.specs->>'brand' AS brand,
                COALESCE(p.sale_price, p.price) AS display_price
         FROM products p
         JOIN categories c ON p.category_id = c.category_id
         WHERE (p.title ILIKE $1 OR p.specs->>'brand' ILIKE $1) AND p.is_active = TRUE
         ORDER BY p.review_count DESC LIMIT 8`,
        [`%${q.trim()}%`]
    );

    const categories = await pool.query(
        `SELECT DISTINCT c.name AS category_name, COUNT(p.product_id) AS count
         FROM categories c
         JOIN products p ON p.category_id = c.category_id
         WHERE c.name ILIKE $1 AND p.is_active = TRUE
         GROUP BY c.name LIMIT 3`,
        [`%${q.trim()}%`]
    );

    res.status(200).json({ products: products.rows, categories: categories.rows });
});