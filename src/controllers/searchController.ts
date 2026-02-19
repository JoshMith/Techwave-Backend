// ============================================
// searchController.ts
// Full-text product search with PostgreSQL
// ============================================

import express from "express";
import pool from "../config/db.config";
import asyncHandler from "../middlewares/asyncHandler";
import { UserRequest } from "../utils/types/userTypes";

// @desc    Search products with full-text search + filters
// @route   GET /api/products/search?q=iphone&category=Phones&minPrice=5000&maxPrice=100000&brand=Apple&sort=price-low&page=1&limit=12
// @access  Public
export const searchProducts = asyncHandler(async (req: UserRequest, res: express.Response) => {
    const {
        q = '',
        category,
        minPrice,
        maxPrice,
        brand,
        sort = 'relevance',
        page = '1',
        limit = '12'
    } = req.query as Record<string, string>;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const conditions: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    // Full-text search across title, description, and specs
    if (q.trim()) {
        conditions.push(`
            (
                to_tsvector('english', p.title || ' ' || COALESCE(p.description, '') || ' ' || COALESCE(p.specs::text, ''))
                @@ plainto_tsquery('english', $${paramIndex})
                OR p.title ILIKE $${paramIndex + 1}
            )
        `);
        values.push(q.trim());
        values.push(`%${q.trim()}%`);
        paramIndex += 2;
    }

    // Category filter
    if (category && category !== 'all') {
        conditions.push(`c.name ILIKE $${paramIndex}`);
        values.push(`%${category}%`);
        paramIndex++;
    }

    // Price filters
    if (minPrice) {
        conditions.push(`(COALESCE(p.sale_price, p.price)) >= $${paramIndex}`);
        values.push(parseFloat(minPrice));
        paramIndex++;
    }
    if (maxPrice) {
        conditions.push(`(COALESCE(p.sale_price, p.price)) <= $${paramIndex}`);
        values.push(parseFloat(maxPrice));
        paramIndex++;
    }

    // Brand filter (from specs JSONB)
    if (brand && brand !== 'all') {
        conditions.push(`p.specs->>'brand' ILIKE $${paramIndex}`);
        values.push(`%${brand}%`);
        paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Sorting
    let orderClause = 'ORDER BY p.created_at DESC';
    if (q.trim()) {
        // When searching, sort by relevance first
        orderClause = `ORDER BY 
            ts_rank(
                to_tsvector('english', p.title || ' ' || COALESCE(p.description, '') || ' ' || COALESCE(p.specs::text, '')),
                plainto_tsquery('english', '${q.trim().replace(/'/g, "''")}')
            ) DESC,
            p.review_count DESC`;
    }

    switch (sort) {
        case 'price-low':
            orderClause = 'ORDER BY COALESCE(p.sale_price, p.price) ASC';
            break;
        case 'price-high':
            orderClause = 'ORDER BY COALESCE(p.sale_price, p.price) DESC';
            break;
        case 'rating':
            orderClause = 'ORDER BY p.rating DESC, p.review_count DESC';
            break;
        case 'newest':
            orderClause = 'ORDER BY p.created_at DESC';
            break;
        case 'popularity':
            orderClause = 'ORDER BY p.review_count DESC, p.rating DESC';
            break;
    }

    // Main query
    const query = `
        SELECT 
            p.product_id, 
            p.title, 
            p.description, 
            p.price, 
            p.sale_price, 
            p.stock, 
            p.specs, 
            p.rating, 
            p.review_count, 
            c.name AS category_name,
            c.category_id,
            u.name AS seller_name,
            p.created_at
        FROM products p
        JOIN categories c ON p.category_id = c.category_id
        JOIN sellers s ON p.seller_id = s.seller_id
        JOIN users u ON s.seller_id = u.user_id
        ${whereClause}
        ${orderClause}
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    values.push(limitNum, offset);

    // Count query for pagination
    const countQuery = `
        SELECT COUNT(*) AS total
        FROM products p
        JOIN categories c ON p.category_id = c.category_id
        JOIN sellers s ON p.seller_id = s.seller_id
        JOIN users u ON s.seller_id = u.user_id
        ${whereClause}
    `;
    const countValues = values.slice(0, -2); // exclude LIMIT and OFFSET

    const [result, countResult] = await Promise.all([
        pool.query(query, values),
        pool.query(countQuery, countValues)
    ]);

    const total = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(total / limitNum);

    res.status(200).json({
        products: result.rows,
        pagination: {
            total,
            page: pageNum,
            limit: limitNum,
            totalPages,
            hasNext: pageNum < totalPages,
            hasPrev: pageNum > 1
        },
        query: q,
        filters: { category, minPrice, maxPrice, brand, sort }
    });
});

// @desc    Get search suggestions/autocomplete
// @route   GET /api/products/search/suggestions?q=iph
// @access  Public
export const getSearchSuggestions = asyncHandler(async (req: UserRequest, res: express.Response) => {
    const { q = '' } = req.query as Record<string, string>;

    if (!q.trim() || q.trim().length < 2) {
        return res.status(200).json({ suggestions: [] });
    }

    const query = `
        SELECT DISTINCT
            p.product_id,
            p.title,
            p.review_count,
            c.name AS category_name,
            p.specs->>'brand' AS brand,
            COALESCE(p.sale_price, p.price) AS display_price
        FROM products p
        JOIN categories c ON p.category_id = c.category_id
        WHERE 
            p.title ILIKE $1
            OR p.specs->>'brand' ILIKE $1
        ORDER BY p.review_count DESC
        LIMIT 8
    `;

    const result = await pool.query(query, [`%${q.trim()}%`]);

    // Also get matching category suggestions
    const categoryQuery = `
        SELECT DISTINCT c.name AS category_name, COUNT(p.product_id) AS count
        FROM categories c
        JOIN products p ON p.category_id = c.category_id
        WHERE c.name ILIKE $1
        GROUP BY c.name
        LIMIT 3
    `;
    const categoryResult = await pool.query(categoryQuery, [`%${q.trim()}%`]);

    res.status(200).json({
        products: result.rows,
        categories: categoryResult.rows
    });
});