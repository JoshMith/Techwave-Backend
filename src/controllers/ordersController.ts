import express from "express";
import pool from "../config/db.config";
import asyncHandler from "../middlewares/asyncHandler";
import { UserRequest } from "../utils/types/userTypes";
import { resolveReferralCode, calculateAndStoreCommissions } from "../services/referralService";

// ============================================================
// ORDERS CONTROLLER — v2.0
// Added: agent_id, referral_code, payment_method, delivery_fee
// Order creation now resolves referral code and stores commissions
// ============================================================

export const getOrders = asyncHandler(async (req: UserRequest, res: express.Response) => {
    const result = await pool.query(
        `SELECT
             o.order_id, o.total_amount, o.delivery_fee, o.status,
             o.payment_method, o.referral_code, o.commission_total,
             o.notes, o.created_at, o.updated_at,
             u.name AS customer_name, u.email AS customer_email, u.phone AS customer_phone,
             a.full_name AS agent_name, a.agent_code,
             addr.city, addr.street, addr.building, addr.postal_code
         FROM orders o
         JOIN users u    ON o.user_id    = u.user_id
         JOIN addresses addr ON o.address_id = addr.address_id
         LEFT JOIN agents a ON o.agent_id = a.agent_id
         ORDER BY o.created_at DESC`
    );
    res.status(200).json(result.rows);
});

export const getOrderById = asyncHandler(async (req: UserRequest, res: express.Response) => {
    const { id } = req.params;
    const result = await pool.query(
        `SELECT
             o.order_id, o.total_amount, o.delivery_fee, o.status,
             o.payment_method, o.referral_code, o.commission_total,
             o.notes, o.created_at, o.updated_at,
             o.refund_status, o.refund_amount, o.refund_notes,
             u.name AS customer_name, u.email AS customer_email, u.phone AS customer_phone,
             a.full_name AS agent_name, a.agent_code,
             addr.city, addr.street, addr.building, addr.postal_code,
             json_agg(
                 json_build_object(
                     'order_item_id', oi.order_item_id,
                     'product_id',    oi.product_id,
                     'product_title', p.title,
                     'quantity',      oi.quantity,
                     'unit_price',    oi.unit_price,
                     'subtotal',      oi.subtotal,
                     'category',      cat.name
                 )
             ) AS items
         FROM orders o
         JOIN users u    ON o.user_id    = u.user_id
         JOIN addresses addr ON o.address_id = addr.address_id
         LEFT JOIN agents a   ON o.agent_id  = a.agent_id
         JOIN order_items oi  ON o.order_id  = oi.order_id
         JOIN products p      ON oi.product_id = p.product_id
         JOIN categories cat  ON oi.category_id = cat.category_id
         WHERE o.order_id = $1
         GROUP BY o.order_id, u.name, u.email, u.phone,
                  a.full_name, a.agent_code, addr.city, addr.street, addr.building, addr.postal_code`,
        [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: "Order not found" });
    res.status(200).json(result.rows[0]);
});

export const getOrdersByUserId = asyncHandler(async (req: UserRequest, res: express.Response) => {
    const userId = req.user?.user_id;
    const result = await pool.query(
        `SELECT
             o.order_id, o.total_amount, o.status, o.payment_method,
             o.notes, o.created_at,
             json_agg(
                 json_build_object(
                     'product_id',    oi.product_id,
                     'product_title', p.title,
                     'quantity',      oi.quantity,
                     'unit_price',    oi.unit_price
                 )
             ) AS items
         FROM orders o
         JOIN order_items oi ON o.order_id  = oi.order_id
         JOIN products p     ON oi.product_id = p.product_id
         WHERE o.user_id = $1
         GROUP BY o.order_id
         ORDER BY o.created_at DESC`,
        [userId]
    );
    res.status(200).json(result.rows);
});

// @desc    Create order — resolves referral code, stores commissions
// @route   POST /orders
// @access  Private/Customer
export const createOrder = asyncHandler(async (req: UserRequest, res: express.Response) => {
    const {
        address_id, total_amount, payment_method,
        delivery_fee = 0, notes, items,
        referral_code  // passed from Angular frontend (from sessionStorage)
    } = req.body;

    const userId = req.user?.user_id;

    if (!address_id || !total_amount || !payment_method || !items?.length) {
        return res.status(400).json({
            message: "address_id, total_amount, payment_method, and items are required"
        });
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        // Resolve referral code to agent_id (session-only — code passed from frontend)
        const agentRef = await resolveReferralCode(referral_code);

        // Create the order
        const orderResult = await client.query(
            `INSERT INTO orders
                 (user_id, address_id, total_amount, delivery_fee,
                  payment_method, status, notes, agent_id, referral_code)
             VALUES ($1, $2, $3, $4, $5,
                     $6,  -- pending for COD, pending for M-Pesa (updated by Daraja callback)
                     $7, $8, $9)
             RETURNING order_id`,
            [
                userId, address_id, total_amount, delivery_fee,
                payment_method,
                "pending",
                notes || null,
                agentRef?.agent_id || null,
                agentRef?.agent_code || null
            ]
        );
        const orderId = orderResult.rows[0].order_id;

        // Insert order items — capture category_id for commission calculation
        for (const item of items) {
            const product = await client.query(
                `SELECT price, sale_price, is_on_sale, category_id, stock FROM products WHERE product_id = $1`,
                [item.product_id]
            );
            if (product.rows.length === 0) {
                await client.query("ROLLBACK");
                return res.status(400).json({ message: `Product ${item.product_id} not found` });
            }
            const p = product.rows[0];
            if (p.stock < item.quantity) {
                await client.query("ROLLBACK");
                return res.status(400).json({ message: `Insufficient stock for product ${item.product_id}` });
            }
            const unitPrice = p.is_on_sale && p.sale_price ? p.sale_price : p.price;
            const subtotal  = parseFloat(unitPrice) * item.quantity - (item.discount || 0);

            await client.query(
                `INSERT INTO order_items
                     (order_id, product_id, category_id, quantity,
                      unit_price, sale_price_applied, discount, subtotal)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [
                    orderId, item.product_id, p.category_id, item.quantity,
                    unitPrice,
                    p.is_on_sale ? p.sale_price : null,
                    item.discount || 0,
                    subtotal.toFixed(2)
                ]
            );

            // Reduce stock
            await client.query(
                `UPDATE products SET stock = stock - $1 WHERE product_id = $2`,
                [item.quantity, item.product_id]
            );
        }

        // If agent referred this order, calculate category-based commissions
        if (agentRef) {
            await calculateAndStoreCommissions(orderId, agentRef.agent_id, client);
        }

        // Create payment record
        await client.query(
            `INSERT INTO payments (order_id, method, amount)
             VALUES ($1, $2, $3)`,
            [orderId, payment_method, total_amount]
        );

        await client.query("COMMIT");

        res.status(201).json({
            message: "Order created successfully",
            order_id: orderId,
            agent_attributed: !!agentRef,
        });
    } catch (err) {
        await client.query("ROLLBACK");
        throw err;
    } finally {
        client.release();
    }
});

export const updateOrder = asyncHandler(async (req: UserRequest, res: express.Response) => {
    const { id } = req.params;
    const { status, notes, refund_status, refund_amount, refund_notes } = req.body;
    const fields: string[] = [];
    const values: any[] = [];
    let i = 1;
    if (status)        { fields.push(`status = $${i++}`);        values.push(status); }
    if (notes)         { fields.push(`notes = $${i++}`);         values.push(notes); }
    if (refund_status) { fields.push(`refund_status = $${i++}`); values.push(refund_status); }
    if (refund_amount) { fields.push(`refund_amount = $${i++}`); values.push(refund_amount); }
    if (refund_notes)  { fields.push(`refund_notes = $${i++}`);  values.push(refund_notes); }
    if (fields.length === 0) return res.status(400).json({ message: "No fields provided" });
    fields.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);
    const result = await pool.query(
        `UPDATE orders SET ${fields.join(", ")} WHERE order_id = $${i++}
         RETURNING order_id, status, updated_at`,
        values
    );
    if (result.rows.length === 0) return res.status(404).json({ message: "Order not found" });
    res.status(200).json(result.rows[0]);
});

export const deleteOrder = asyncHandler(async (req: UserRequest, res: express.Response) => {
    const { id } = req.params;
    const result = await pool.query(
        `DELETE FROM orders WHERE order_id = $1 RETURNING order_id`, [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: "Order not found" });
    res.status(200).json({ message: "Order deleted", orderId: result.rows[0].order_id });
});

export const getOrdersCount = asyncHandler(async (req: UserRequest, res: express.Response) => {
    const result = await pool.query("SELECT COUNT(*) AS ordercount FROM orders");
    res.status(200).json({ orderCount: parseInt(result.rows[0].ordercount, 10) });
});