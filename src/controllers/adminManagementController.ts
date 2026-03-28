import { Request, Response } from "express";
import pool from "../config/db.config";
import asyncHandler from "../middlewares/asyncHandler";
import { UserRequest } from "../utils/types/userTypes";
import bcrypt from "bcryptjs";

// ============================================================
// ADMIN MANAGEMENT CONTROLLER — v2.0
// Removed: updateSellerStatus, getSellerDetails, seller references
// Added:   getAgentDetails (delegates to agentsController)
// Fixed:   changeUserRole — removed 'seller', added 'agent'
// Fixed:   getOrderDetails — removed sellers JOIN
// Fixed:   getProductDetails — removed sellers JOIN
// ============================================================

export const bulkUpdateUsers = asyncHandler(async (req: UserRequest, res: Response) => {
    const { userIds, action } = req.body;
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0)
        return res.status(400).json({ message: "userIds array required" });
    if (!action) return res.status(400).json({ message: "action required" });

    let query = "";
    const values: any[] = [userIds];
    switch (action) {
        case "delete":
            query = "DELETE FROM users WHERE user_id = ANY($1::int[]) RETURNING user_id";
            break;
        default:
            return res.status(400).json({ message: "Invalid action" });
    }
    const result = await pool.query(query, values);
    res.status(200).json({ success: true, affected: result.rows.length });
});

// Valid roles: admin, agent, customer — seller removed
export const changeUserRole = asyncHandler(async (req: UserRequest, res: Response) => {
    const { id } = req.params;
    const { role } = req.body;
    if (!role || !["admin", "agent", "customer"].includes(role)) {
        return res.status(400).json({ message: "Valid role is required (admin, agent, customer)" });
    }
    const result = await pool.query(
        `UPDATE users SET role = $1, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $2 RETURNING user_id, name, email, role`,
        [role, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: "User not found" });
    res.status(200).json({ success: true, user: result.rows[0] });
});

export const resetUserPassword = asyncHandler(async (req: UserRequest, res: Response) => {
    const { id } = req.params;
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6)
        return res.status(400).json({ message: "Password must be at least 6 characters" });
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(newPassword, salt);
    const result = await pool.query(
        `UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $2 RETURNING user_id, name, email`,
        [hash, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: "User not found" });
    res.status(200).json({ success: true, message: "Password reset", user: result.rows[0] });
});

export const bulkUpdateOrders = asyncHandler(async (req: UserRequest, res: Response) => {
    const { orderIds, status } = req.body;
    const valid = ["pending","paid","processing","shipped","delivered","cancelled","failed"];
    if (!orderIds?.length) return res.status(400).json({ message: "orderIds required" });
    if (!status || !valid.includes(status)) return res.status(400).json({ message: "Invalid status" });
    const result = await pool.query(
        `UPDATE orders SET status = $1, updated_at = CURRENT_TIMESTAMP
         WHERE order_id = ANY($2::int[]) RETURNING order_id, status`,
        [status, orderIds]
    );
    res.status(200).json({ success: true, updated: result.rows.length });
});

// Seller JOIN removed — products now owned by admin (created_by)
export const getOrderDetails = asyncHandler(async (req: UserRequest, res: Response) => {
    const { id } = req.params;
    const orderQuery = await pool.query(
        `SELECT o.order_id, o.total_amount, o.status, o.payment_method,
                o.commission_total, o.referral_code, o.notes, o.created_at,
                o.refund_status, o.refund_amount, o.refund_notes,
                u.user_id, u.name as customer_name, u.email, u.phone,
                a.city, a.street, a.building, a.postal_code,
                ag.full_name as agent_name, ag.agent_code
         FROM orders o
         JOIN users u ON o.user_id = u.user_id
         JOIN addresses a ON o.address_id = a.address_id
         LEFT JOIN agents ag ON o.agent_id = ag.agent_id
         WHERE o.order_id = $1`,
        [id]
    );
    if (orderQuery.rows.length === 0) return res.status(404).json({ message: "Order not found" });

    const itemsQuery = await pool.query(
        `SELECT oi.order_item_id, oi.quantity, oi.unit_price, oi.discount, oi.subtotal,
                p.product_id, p.title as product_title,
                c.name as category_name
         FROM order_items oi
         JOIN products p ON oi.product_id = p.product_id
         JOIN categories c ON oi.category_id = c.category_id
         WHERE oi.order_id = $1`,
        [id]
    );

    const paymentQuery = await pool.query(
        `SELECT payment_id, method, amount, mpesa_code, mpesa_phone,
                is_confirmed, confirmed_at, created_at
         FROM payments WHERE order_id = $1`,
        [id]
    );

    res.status(200).json({
        success: true,
        data: { order: orderQuery.rows[0], items: itemsQuery.rows, payment: paymentQuery.rows[0] || null },
    });
});

export const bulkUpdateProducts = asyncHandler(async (req: UserRequest, res: Response) => {
    const { productIds, action, value } = req.body;
    if (!productIds?.length) return res.status(400).json({ message: "productIds required" });
    let query = "";
    let values: any[] = [];
    switch (action) {
        case "delete":
            // Soft delete
            query = "UPDATE products SET is_active = FALSE WHERE product_id = ANY($1::int[]) RETURNING product_id";
            values = [productIds];
            break;
        case "updateStock":
            if (value === undefined) return res.status(400).json({ message: "value required" });
            query = "UPDATE products SET stock = $2 WHERE product_id = ANY($1::int[]) RETURNING product_id, stock";
            values = [productIds, value];
            break;
        case "updatePrice":
            if (value === undefined) return res.status(400).json({ message: "value required" });
            query = "UPDATE products SET price = $2 WHERE product_id = ANY($1::int[]) RETURNING product_id, price";
            values = [productIds, value];
            break;
        default:
            return res.status(400).json({ message: "Invalid action" });
    }
    const result = await pool.query(query, values);
    res.status(200).json({ success: true, products: result.rows });
});

// Seller JOIN removed
export const getProductDetails = asyncHandler(async (req: UserRequest, res: Response) => {
    const { id } = req.params;
    const productQuery = await pool.query(
        `SELECT p.*, c.name as category_name, u.name as created_by_name
         FROM products p
         JOIN categories c ON p.category_id = c.category_id
         JOIN users u ON p.created_by = u.user_id
         WHERE p.product_id = $1`,
        [id]
    );
    if (productQuery.rows.length === 0) return res.status(404).json({ message: "Product not found" });

    const imagesQuery  = await pool.query("SELECT * FROM product_images WHERE product_id = $1 ORDER BY is_primary DESC, sort_order", [id]);
    const reviewsQuery = await pool.query(
        `SELECT r.*, u.name FROM reviews r JOIN users u ON r.user_id = u.user_id
         WHERE r.product_id = $1 ORDER BY r.created_at DESC`, [id]
    );
    const salesQuery   = await pool.query(
        `SELECT COUNT(oi.order_item_id) as times_ordered,
                SUM(oi.quantity) as units_sold, SUM(oi.subtotal) as revenue
         FROM order_items oi WHERE oi.product_id = $1`, [id]
    );

    res.status(200).json({
        success: true,
        data: {
            product: productQuery.rows[0], images: imagesQuery.rows,
            reviews: reviewsQuery.rows, sales: salesQuery.rows[0],
        },
    });
});

export const manualPaymentConfirmation = asyncHandler(async (req: UserRequest, res: Response) => {
    const { id } = req.params;
    const { isConfirmed, notes } = req.body;
    if (typeof isConfirmed !== "boolean")
        return res.status(400).json({ message: "isConfirmed (boolean) required" });

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const paymentResult = await client.query(
            `UPDATE payments SET is_confirmed = $1,
                confirmed_at = ${isConfirmed ? "NOW()" : "NULL"},
                confirmed_by = $2
             WHERE payment_id = $3 RETURNING payment_id, order_id, is_confirmed`,
            [isConfirmed, req.user?.user_id, id]
        );
        if (paymentResult.rows.length === 0) { await client.query("ROLLBACK"); return res.status(404).json({ message: "Payment not found" }); }

        const orderId = paymentResult.rows[0].order_id;
        const orderStatus = isConfirmed ? "paid" : "failed";
        await client.query(
            `UPDATE orders SET status = $1, updated_at = NOW() WHERE order_id = $2`,
            [orderStatus, orderId]
        );
        await client.query("COMMIT");
        res.status(200).json({ success: true, message: `Payment ${isConfirmed ? "confirmed" : "rejected"}`, payment: paymentResult.rows[0] });
    } catch (err) {
        await client.query("ROLLBACK");
        throw err;
    } finally {
        client.release();
    }
});

export const getPendingPayments = asyncHandler(async (req: UserRequest, res: Response) => {
    const result = await pool.query(
        `SELECT p.*, o.total_amount as order_total, o.status as order_status, o.payment_method,
                u.name as customer_name, u.email, u.phone
         FROM payments p
         JOIN orders o ON p.order_id = o.order_id
         JOIN users u ON o.user_id = u.user_id
         WHERE p.is_confirmed = false
         ORDER BY p.created_at DESC`
    );
    res.status(200).json({ success: true, data: result.rows });
});

export const mergeCategories = asyncHandler(async (req: UserRequest, res: Response) => {
    const { sourceCategoryId, targetCategoryId } = req.body;
    if (!sourceCategoryId || !targetCategoryId)
        return res.status(400).json({ message: "sourceCategoryId and targetCategoryId required" });
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const moved = await client.query(
            `UPDATE products SET category_id = $1, updated_at = CURRENT_TIMESTAMP
             WHERE category_id = $2 RETURNING product_id`,
            [targetCategoryId, sourceCategoryId]
        );
        await client.query("DELETE FROM categories WHERE category_id = $1", [sourceCategoryId]);
        await client.query("COMMIT");
        res.status(200).json({ success: true, movedProducts: moved.rows.length });
    } catch (err) {
        await client.query("ROLLBACK"); throw err;
    } finally { client.release(); }
});

export const bulkDeleteReviews = asyncHandler(async (req: UserRequest, res: Response) => {
    const { reviewIds } = req.body;
    if (!reviewIds?.length) return res.status(400).json({ message: "reviewIds required" });
    const result = await pool.query(
        "DELETE FROM reviews WHERE review_id = ANY($1::int[]) RETURNING review_id", [reviewIds]
    );
    res.status(200).json({ success: true, deleted: result.rows.length });
});

export const getFlaggedReviews = asyncHandler(async (req: UserRequest, res: Response) => {
    const result = await pool.query(
        `SELECT r.*, u.name as user_name, p.title as product_title
         FROM reviews r
         JOIN users u ON r.user_id = u.user_id
         JOIN products p ON r.product_id = p.product_id
         WHERE r.rating <= 2
            OR r.comment ILIKE '%scam%'
            OR r.comment ILIKE '%fake%'
            OR r.comment ILIKE '%fraud%'
         ORDER BY r.created_at DESC`
    );
    res.status(200).json({ success: true, data: result.rows });
});

export default {
    bulkUpdateUsers, changeUserRole, resetUserPassword,
    bulkUpdateOrders, getOrderDetails,
    bulkUpdateProducts, getProductDetails,
    manualPaymentConfirmation, getPendingPayments,
    mergeCategories, bulkDeleteReviews, getFlaggedReviews,
};