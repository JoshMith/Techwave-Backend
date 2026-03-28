import { Request, Response } from "express";
import pool from "../config/db.config";
import asyncHandler from "../middlewares/asyncHandler";
import { UserRequest } from "../utils/types/userTypes";

// ============================================================
// USERS CONTROLLER — v2.0
// Removed: seller data fetching in getCurrentUser
// Added:   agent data fetching in getCurrentUser
// ============================================================

export const getUsers = asyncHandler(async (req: Request, res: Response) => {
    const result = await pool.query(
        `SELECT user_id, name, email, phone, role, created_at
         FROM users ORDER BY created_at DESC`
    );
    res.status(200).json(result.rows);
});

export const getUserById = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const result = await pool.query(
        `SELECT user_id, name, email, phone, role, created_at FROM users WHERE user_id = $1`,
        [id]
    );
    if (result.rows.length === 0) { res.status(404); throw new Error("User not found"); }
    res.status(200).json(result.rows[0]);
});

export const createUser = asyncHandler(async (req: Request, res: Response) => {
    const { name, email, phone, password, role = "customer" } = req.body;
    const existing = await pool.query(
        "SELECT user_id FROM users WHERE email = $1 OR phone = $2", [email, phone]
    );
    if (existing.rows.length > 0) { res.status(400); throw new Error("Email or phone already exists"); }
    const result = await pool.query(
        `INSERT INTO users (name, email, phone, password_hash, role)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING user_id, name, email, phone, role, created_at`,
        [name, email, phone, password, role]
    );
    res.status(201).json(result.rows[0]);
});

export const updateUser = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { name, email, phone, role, terms, newsletter } = req.body;
    const fields: string[] = [];
    const values: any[] = [];
    let i = 1;
    if (name)       { fields.push(`name = $${i++}`);       values.push(name); }
    if (email)      { fields.push(`email = $${i++}`);      values.push(email); }
    if (phone)      { fields.push(`phone = $${i++}`);      values.push(phone); }
    if (role)       { fields.push(`role = $${i++}`);       values.push(role); }
    if (terms != null)      { fields.push(`terms = $${i++}`);      values.push(terms); }
    if (newsletter != null) { fields.push(`newsletter = $${i++}`); values.push(newsletter); }
    if (fields.length === 0) return res.status(400).json({ message: "No fields provided" });
    fields.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);
    const result = await pool.query(
        `UPDATE users SET ${fields.join(", ")} WHERE user_id = $${i++}
         RETURNING user_id, name, email, phone, role, created_at`,
        values
    );
    if (result.rows.length === 0) return res.status(404).json({ message: "User not found" });
    res.status(200).json(result.rows[0]);
});

export const deleteUser = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const exists = await pool.query("SELECT user_id FROM users WHERE user_id = $1", [id]);
    if (exists.rows.length === 0) { res.status(404); throw new Error("User not found"); }
    await pool.query("DELETE FROM addresses WHERE user_id = $1", [id]);
    await pool.query("DELETE FROM users WHERE user_id = $1", [id]);
    res.status(200).json({ success: true, message: "User deleted successfully" });
});

// @desc    Get currently logged-in user — returns agent data if role is agent
export const getCurrentUser = asyncHandler(async (req: UserRequest, res: Response) => {
    const userId = req.user?.user_id;
    if (!userId) {
        return res.status(200).json({ authenticated: false, user: null, agent: null });
    }

    const userQuery = await pool.query(
        `SELECT user_id, name, email, phone, role, terms, newsletter, last_login, created_at
         FROM users WHERE user_id = $1`,
        [userId]
    );

    if (userQuery.rows.length === 0) {
        return res.status(200).json({ authenticated: false, user: null, agent: null });
    }

    const user = userQuery.rows[0];
    let agentData = null;

    // If user is an agent, return their agent profile too
    if (user.role === "agent") {
        const agentQuery = await pool.query(
            `SELECT agent_id, agent_code, referral_link, is_active, created_at
             FROM agents WHERE user_id = $1`,
            [userId]
        );
        if (agentQuery.rows.length > 0) {
            agentData = agentQuery.rows[0];
        }
    }

    res.status(200).json({
        authenticated: true,
        user,
        ...(agentData && { agent: agentData }),
    });
});

export const getCurrentUserProfile = asyncHandler(async (req: UserRequest, res: Response) => {
    const { id } = req.params;
    if (!id) { res.status(400); throw new Error("User ID required"); }
    const result = await pool.query(
        `SELECT u.user_id, u.name, u.email, u.phone, u.role, u.created_at,
                a.address_id, a.city, a.street, a.building, a.postal_code, a.is_default
         FROM users u
         LEFT JOIN addresses a ON u.user_id = a.user_id
         WHERE u.user_id = $1`,
        [id]
    );
    if (result.rows.length === 0) { res.status(404); throw new Error("User not found"); }
    res.status(200).json(result.rows[0]);
});

export const getCustomerCount = asyncHandler(async (req: UserRequest, res: Response) => {
    const result = await pool.query(
        `SELECT COUNT(*) AS customercount FROM users WHERE role = 'customer'`
    );
    res.status(200).json({ customerCount: parseInt(result.rows[0].customercount, 10) });
});

// forgot password 
export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
    const { email } = req.body;
    if (!email) { res.status(400); throw new Error("Email is required"); }
    const userQuery = await pool.query("SELECT user_id FROM users WHERE email = $1", [email]);
    if (userQuery.rows.length === 0) { res.status(404); throw new Error("User not found"); }
    // Here you would generate a reset token, save it to the database, and send an email to the user
    // For simplicity, we'll just return a success message
    res.status(200).json({ success: true, message: "Password reset instructions sent to email" });
});