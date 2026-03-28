import { Request, Response } from "express";
import pool from "../config/db.config";
import asyncHandler from "../middlewares/asyncHandler";
import { UserRequest } from "../utils/types/userTypes";
import bcrypt from "bcryptjs";

// ============================================================
// AGENTS CONTROLLER — v2.0 (replaces sellersController)
// Agents are internal TechWave sales staff.
// Created by Admin only. Each has a unique referral link.
// ============================================================

// ── Helper: generate sequential agent code ─────────────────
async function generateAgentCode(): Promise<string> {
    const result = await pool.query(
        `SELECT agent_code FROM agents ORDER BY agent_id DESC LIMIT 1`
    );
    if (result.rows.length === 0) return "AGT001";
    const last = result.rows[0].agent_code; // e.g. AGT007
    const num = parseInt(last.replace("AGT", ""), 10) + 1;
    return `AGT${String(num).padStart(3, "0")}`;
}

// ── ADMIN: Create agent account ─────────────────────────────
// @route   POST /agents
// @access  Private/Admin
export const createAgent = asyncHandler(async (req: UserRequest, res: Response) => {
    const { full_name, phone, id_number, email, password } = req.body;
    const adminId = req.user?.user_id;

    if (!full_name || !phone || !id_number || !email || !password) {
        return res.status(400).json({ message: "full_name, phone, id_number, email, and password are required" });
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        // Check email not already taken
        const emailCheck = await client.query(
            "SELECT user_id FROM users WHERE email = $1", [email]
        );
        if (emailCheck.rows.length > 0) {
            await client.query("ROLLBACK");
            return res.status(400).json({ message: "Email already in use" });
        }

        // Create user record with role=agent
        const salt = await bcrypt.genSalt(10);
        const hashedPw = await bcrypt.hash(password, salt);

        const newUser = await client.query(
            `INSERT INTO users (name, email, phone, password_hash, role, verified, terms)
             VALUES ($1, $2, $3, $4, 'agent', TRUE, TRUE)
             RETURNING user_id`,
            [full_name, email, phone, hashedPw]
        );
        const userId = newUser.rows[0].user_id;

        // Generate agent code and referral link
        const agentCode = await generateAgentCode();
        const referralLink = `https://techwaveelectronics.co.ke?ref=${agentCode}`;

        // Create agent record
        const newAgent = await client.query(
            `INSERT INTO agents (user_id, agent_code, full_name, phone, id_number, referral_link, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING agent_id, agent_code, full_name, phone, referral_link, is_active, created_at`,
            [userId, agentCode, full_name, phone, id_number, referralLink, adminId]
        );

        await client.query("COMMIT");

        res.status(201).json({
            message: "Agent account created successfully",
            agent: {
                ...newAgent.rows[0],
                user_id: userId,
                email,
            },
        });
    } catch (err) {
        await client.query("ROLLBACK");
        throw err;
    } finally {
        client.release();
    }
});

// ── ADMIN: Get all agents ───────────────────────────────────
// @route   GET /agents
// @access  Private/Admin
export const getAgents = asyncHandler(async (req: Request, res: Response) => {
    const result = await pool.query(
        `SELECT
             a.agent_id, a.agent_code, a.full_name, a.phone, a.referral_link,
             a.is_active, a.created_at, a.deactivated_at,
             u.email, u.user_id,
             COALESCE(stats.total_orders, 0)      AS total_orders,
             COALESCE(stats.total_revenue, 0)     AS total_revenue,
             COALESCE(stats.total_commission, 0)  AS total_commission
         FROM agents a
         JOIN users u ON u.user_id = a.user_id
         LEFT JOIN (
             SELECT o.agent_id,
                    COUNT(DISTINCT o.order_id)  AS total_orders,
                    SUM(o.total_amount)         AS total_revenue,
                    SUM(o.commission_total)     AS total_commission
             FROM orders o
             WHERE o.status NOT IN ('cancelled','failed')
             GROUP BY o.agent_id
         ) stats ON stats.agent_id = a.agent_id
         ORDER BY a.created_at DESC`
    );
    res.status(200).json(result.rows);
});

// ── ADMIN: Get single agent with performance detail ─────────
// @route   GET /agents/:id
// @access  Private/Admin
export const getAgentById = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const result = await pool.query(
        `SELECT a.agent_id, a.agent_code, a.full_name, a.phone, a.id_number,
                a.referral_link, a.is_active, a.created_at, a.deactivated_at,
                u.email, u.user_id
         FROM agents a
         JOIN users u ON u.user_id = a.user_id
         WHERE a.agent_id = $1`,
        [id]
    );
    if (result.rows.length === 0) {
        return res.status(404).json({ message: "Agent not found" });
    }
    res.status(200).json(result.rows[0]);
});

// ── ADMIN: Update agent details or commission rate ──────────
// @route   PUT /agents/:id
// @access  Private/Admin
export const updateAgent = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { full_name, phone, id_number } = req.body;
    const fields: string[] = [];
    const values: any[] = [];
    let i = 1;
    if (full_name) { fields.push(`full_name = $${i++}`); values.push(full_name); }
    if (phone)     { fields.push(`phone = $${i++}`);     values.push(phone); }
    if (id_number) { fields.push(`id_number = $${i++}`); values.push(id_number); }
    if (fields.length === 0) return res.status(400).json({ message: "No fields provided" });
    values.push(id);
    const result = await pool.query(
        `UPDATE agents SET ${fields.join(", ")} WHERE agent_id = $${i++}
         RETURNING agent_id, agent_code, full_name, phone, referral_link, is_active`,
        values
    );
    if (result.rows.length === 0) return res.status(404).json({ message: "Agent not found" });
    res.status(200).json(result.rows[0]);
});

// ── ADMIN: Deactivate agent ─────────────────────────────────
// Referral link goes dead immediately. Historical data retained.
// @route   PATCH /agents/:id/deactivate
// @access  Private/Admin
export const deactivateAgent = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        // Deactivate in agents table
        const result = await client.query(
            `UPDATE agents
             SET is_active = FALSE, deactivated_at = NOW()
             WHERE agent_id = $1
             RETURNING agent_id, agent_code, full_name, is_active, deactivated_at`,
            [id]
        );
        if (result.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ message: "Agent not found" });
        }

        // Also disable user login
        const agentUserId = await client.query(
            "SELECT user_id FROM agents WHERE agent_id = $1", [id]
        );
        await client.query(
            "UPDATE users SET verified = FALSE WHERE user_id = $1",
            [agentUserId.rows[0].user_id]
        );

        await client.query("COMMIT");
        res.status(200).json({
            message: "Agent deactivated. Referral link is now dead. Historical orders retained.",
            agent: result.rows[0],
        });
    } catch (err) {
        await client.query("ROLLBACK");
        throw err;
    } finally {
        client.release();
    }
});

// ── AGENT: Personal dashboard stats ────────────────────────
// @route   GET /agents/me/dashboard
// @access  Private/Agent
export const getAgentDashboard = asyncHandler(async (req: UserRequest, res: Response) => {
    const userId = req.user?.user_id;

    const agentQuery = await pool.query(
        `SELECT agent_id, agent_code, full_name, referral_link, is_active
         FROM agents WHERE user_id = $1`,
        [userId]
    );
    if (agentQuery.rows.length === 0) {
        return res.status(404).json({ message: "Agent profile not found" });
    }
    const agent = agentQuery.rows[0];
    const agentId = agent.agent_id;

    // All-time stats
    const allTime = await pool.query(
        `SELECT
             COUNT(DISTINCT o.order_id)        AS total_orders,
             COALESCE(SUM(o.total_amount), 0)  AS total_revenue,
             COALESCE(SUM(o.commission_total), 0) AS total_commission,
             COUNT(DISTINCT o.user_id)         AS unique_customers
         FROM orders o
         WHERE o.agent_id = $1 AND o.status NOT IN ('cancelled','failed')`,
        [agentId]
    );

    // This month stats
    const thisMonth = await pool.query(
        `SELECT
             COUNT(DISTINCT o.order_id)        AS total_orders,
             COALESCE(SUM(o.total_amount), 0)  AS total_revenue,
             COALESCE(SUM(o.commission_total), 0) AS total_commission
         FROM orders o
         WHERE o.agent_id = $1
           AND o.status NOT IN ('cancelled','failed')
           AND DATE_TRUNC('month', o.created_at) = DATE_TRUNC('month', NOW())`,
        [agentId]
    );

    res.status(200).json({
        agent: {
            agent_id: agent.agent_id,
            agent_code: agent.agent_code,
            full_name: agent.full_name,
            referral_link: agent.referral_link,
        },
        all_time: allTime.rows[0],
        this_month: thisMonth.rows[0],
    });
});

// ── AGENT: Personal orders list ─────────────────────────────
// @route   GET /agents/me/orders
// @access  Private/Agent
export const getAgentOrders = asyncHandler(async (req: UserRequest, res: Response) => {
    const userId = req.user?.user_id;
    const { page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, parseInt(limit));
    const offset = (pageNum - 1) * limitNum;

    const agentQuery = await pool.query(
        "SELECT agent_id FROM agents WHERE user_id = $1", [userId]
    );
    if (agentQuery.rows.length === 0) {
        return res.status(404).json({ message: "Agent not found" });
    }
    const agentId = agentQuery.rows[0].agent_id;

    const orders = await pool.query(
        `SELECT
             o.order_id, o.total_amount, o.commission_total, o.status,
             o.payment_method, o.created_at,
             u.name AS customer_name,
             -- Commission breakdown by category
             COALESCE(
                 json_agg(
                     json_build_object(
                         'category', cat.name,
                         'item_subtotal', c.item_subtotal,
                         'rate_applied', c.rate_applied,
                         'amount_earned', c.amount_earned
                     )
                 ) FILTER (WHERE c.commission_id IS NOT NULL), '[]'
             ) AS commission_breakdown
         FROM orders o
         JOIN users u ON u.user_id = o.user_id
         LEFT JOIN commissions c ON c.order_id = o.order_id
         LEFT JOIN categories cat ON cat.category_id = c.category_id
         WHERE o.agent_id = $1
         GROUP BY o.order_id, u.name
         ORDER BY o.created_at DESC
         LIMIT $2 OFFSET $3`,
        [agentId, limitNum, offset]
    );

    const total = await pool.query(
        "SELECT COUNT(*) FROM orders WHERE agent_id = $1", [agentId]
    );

    res.status(200).json({
        orders: orders.rows,
        pagination: {
            total: parseInt(total.rows[0].count),
            page: pageNum,
            limit: limitNum,
            totalPages: Math.ceil(parseInt(total.rows[0].count) / limitNum),
        },
    });
});

// ── ADMIN: Commission report for all agents ─────────────────
// @route   GET /agents/commissions/report
// @access  Private/Admin
export const getCommissionReport = asyncHandler(async (req: Request, res: Response) => {
    const { from, to, agent_id } = req.query;

    let conditions = ["c.is_bonus = FALSE"];
    const values: any[] = [];
    let i = 1;

    if (from)     { conditions.push(`c.created_at >= $${i++}`); values.push(from); }
    if (to)       { conditions.push(`c.created_at <= $${i++}`); values.push(to); }
    if (agent_id) { conditions.push(`a.agent_id = $${i++}`);    values.push(agent_id); }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await pool.query(
        `SELECT
             a.agent_id, a.agent_code, a.full_name,
             SUM(CASE WHEN cat.name = 'Accessories' THEN c.item_subtotal ELSE 0 END)  AS accessories_revenue,
             SUM(CASE WHEN cat.name = 'Accessories' THEN c.amount_earned ELSE 0 END)  AS accessories_commission,
             SUM(CASE WHEN cat.name != 'Accessories' THEN c.item_subtotal ELSE 0 END) AS electronics_revenue,
             SUM(CASE WHEN cat.name != 'Accessories' THEN c.amount_earned ELSE 0 END) AS electronics_commission,
             SUM(c.amount_earned)                                                      AS total_commission,
             COUNT(DISTINCT c.order_id)                                                AS total_orders
         FROM commissions c
         JOIN agents a ON a.agent_id = c.agent_id
         JOIN categories cat ON cat.category_id = c.category_id
         ${where}
         GROUP BY a.agent_id, a.agent_code, a.full_name
         ORDER BY total_commission DESC`,
        values
    );

    res.status(200).json({ success: true, data: result.rows });
});