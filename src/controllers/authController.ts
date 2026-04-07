import { Request, Response, NextFunction } from "express";
import pool from "../config/db.config";
import bcrypt from "bcryptjs";
import { generateToken } from "../utils/helpers/generateToken";
import asyncHandler from "../middlewares/asyncHandler";
import jwt from "jsonwebtoken";
import passport from "passport";

// ============================================================
// AUTH CONTROLLER — v2.0
// Removed: seller portal login logic
// Added:   agent portal login (separate endpoint)
// ============================================================

// @desc    Customer / Admin login
// @route   POST /auth/login
// @access  Public
export const login = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { email, password } = req.body;

    const userQuery = await pool.query(
        `SELECT user_id, name, email, password_hash, role FROM users WHERE email = $1`,
        [email]
    );

    if (userQuery.rows.length === 0) {
        res.status(401).json({ message: "Invalid email or password" });
        return;
    }

    const user = userQuery.rows[0];

    // Block agents from using this endpoint — they use /auth/agent/login
    if (user.role === "agent") {
        res.status(403).json({ message: "Agents must log in via the Agent Portal." });
        return;
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
        res.status(401).json({ message: "Invalid email or password" });
        return;
    }

    await generateToken(res, user.user_id, user.role);

    await pool.query(
        `UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE user_id = $1`,
        [user.user_id]
    );

    res.status(200).json({
        message: "Login successful",
        user: {
            user_id: user.user_id,
            name: user.name,
            email: user.email,
            role: user.role,
        },
    });
});

// @desc    Agent Portal login — separate from customer/admin login
// @route   POST /auth/agent/login
// @access  Public
export const agentLogin = asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = req.body;

    const userQuery = await pool.query(
        `SELECT u.user_id, u.name, u.email, u.password_hash, u.role,
                a.agent_id, a.agent_code, a.referral_link, a.is_active
         FROM users u
         JOIN agents a ON a.user_id = u.user_id
         WHERE u.email = $1 AND u.role = 'agent'`,
        [email]
    );

    if (userQuery.rows.length === 0) {
        res.status(401).json({ message: "Invalid credentials" });
        return;
    }

    const user = userQuery.rows[0];

    if (!user.is_active) {
        res.status(403).json({ message: "This agent account has been deactivated. Contact admin." });
        return;
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
        res.status(401).json({ message: "Invalid credentials" });
        return;
    }

    await generateToken(res, user.user_id, user.role);

    await pool.query(
        `UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE user_id = $1`,
        [user.user_id]
    );

    res.status(200).json({
        message: "Login successful",
        user: {
            user_id: user.user_id,
            name: user.name,
            email: user.email,
            role: user.role,
        },
        agent: {
            agent_id: user.agent_id,
            agent_code: user.agent_code,
            referral_link: user.referral_link,
        },
    });
});

// @desc    Register new customer
// @route   POST /auth/register
// @access  Public
export const register = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { name, email, phone, password, terms, newsletter } = req.body;

    const userExists = await pool.query(
        "SELECT user_id FROM users WHERE email = $1",
        [email]
    );

    if (userExists.rows.length > 0) {
        res.status(400).json({ message: "User already exists" });
        return;
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = await pool.query(
        `INSERT INTO users (name, email, phone, password_hash, role, terms, newsletter)
         VALUES ($1, $2, $3, $4, 'customer', $5, $6)
         RETURNING user_id, name, email, phone, role`,
        [name, email, phone, hashedPassword, terms, newsletter]
    );

    generateToken(res, newUser.rows[0].user_id, newUser.rows[0].role);

    res.status(201).json({
        message: "User registered successfully",
        user: newUser.rows[0],
    });
});

// @desc    Logout — clear cookies
// @route   POST /auth/logout
// @access  Private
export const logout = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const cookieOpts = {
        httpOnly: true,
        secure: process.env.NODE_ENV !== "development",
        sameSite: "none" as const,
        expires: new Date(0),
    };
    res.cookie("access_token", "", cookieOpts);
    res.cookie("refresh_token", "", cookieOpts);
    res.status(200).json({ message: "Logged out successfully" });
});

// @desc    Verify email via token
// @route   GET /auth/verifyEmail
// @access  Public
export const verifyEmail = asyncHandler(async (req: Request, res: Response) => {
    const token = req.query.token as string;
    if (!token) {
        return res.status(400).json({ message: "Invalid or missing token" });
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string };
        const result = await pool.query(
            "UPDATE users SET verified = TRUE WHERE user_id = $1 RETURNING user_id, email, verified",
            [decoded.userId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ message: "User not found" });
        }
        return res.status(200).json({ message: "Email verified successfully", user: result.rows[0] });
    } catch {
        return res.status(400).json({ message: "Invalid or expired token" });
    }
});

export const googleAuth = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    passport.authenticate("google", { scope: ["profile", "email"] })(req, res, next);
});

export const googleAuthCallback = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    passport.authenticate("google", { failureRedirect: "/homepage" }, async (err: any, user: any) => {
        if (err) return next(err);
        if (!user) return res.redirect("/homepage");

        await generateToken(res, user.user_id, user.role);

        const userQuery = await pool.query(
            `SELECT user_id, name, email, role, verified FROM users WHERE user_id = $1`,
            [user.user_id]
        );

        if (userQuery.rows.length === 0) {
            return res.status(401).json({ message: "User not found" });
        }

        res.redirect(`${process.env.FRONTEND_URL}/home`);
    })(req, res, next);
});

// ============================================================
// PASSWORD RESET FUNCTIONS — Simple JWT-based approach
// ============================================================

// @desc    Request password reset (send email with link)
// @route   POST /auth/forgot-password
// @access  Public
export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
    const { email } = req.body;
    
    if (!email) {
        res.status(400).json({ message: "Email is required" });
        return;
    }
    
    // Check if user exists (don't reveal this to client for security)
    const userQuery = await pool.query(
        `SELECT user_id, email FROM users WHERE email = $1`,
        [email.toLowerCase()]
    );
    
    // For security, always return success even if email doesn't exist
    // This prevents email enumeration attacks
    if (userQuery.rows.length === 0) {
        res.status(200).json({ 
            message: "If an account exists with that email, you will receive a reset link." 
        });
        return;
    }
    
    const user = userQuery.rows[0];
    
    // Generate reset token (expires in 1 hour)
    const resetToken = jwt.sign(
        { userId: user.user_id, purpose: "password_reset" },
        process.env.JWT_SECRET!,
        { expiresIn: "1h" }
    );
    
    // Store token in database (simple - no extra table needed)
    await pool.query(
        `UPDATE users 
         SET reset_token = $1, 
             reset_token_expires = NOW() + INTERVAL '1 hour'
         WHERE user_id = $2`,
        [resetToken, user.user_id]
    );
    
    // Create reset link
    const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
    
    // TODO: Send email (you'll need nodemailer setup)
    // For now, log it for testing
    console.log(`Password reset link for ${email}: ${resetLink}`);
    
    // In production, send email here:
    // await sendPasswordResetEmail(email, resetLink);
    
    res.status(200).json({ 
        message: "If an account exists with that email, you will receive a reset link." 
    });
});

// @desc    Reset password using token
// @route   POST /auth/reset-password
// @access  Public
export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
    const { token, newPassword } = req.body;
    
    if (!token || !newPassword) {
        res.status(400).json({ message: "Token and new password are required" });
        return;
    }
    
    if (newPassword.length < 6) {
        res.status(400).json({ message: "Password must be at least 6 characters" });
        return;
    }
    
    // Verify token and check if it's still valid in database
    const userQuery = await pool.query(
        `SELECT user_id, email, reset_token, reset_token_expires 
         FROM users 
         WHERE reset_token = $1 AND reset_token_expires > NOW()`,
        [token]
    );
    
    if (userQuery.rows.length === 0) {
        res.status(400).json({ message: "Invalid or expired reset token" });
        return;
    }
    
    const user = userQuery.rows[0];
    
    // Verify JWT as additional security
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
        if (decoded.userId !== user.user_id || decoded.purpose !== "password_reset") {
            res.status(400).json({ message: "Invalid token" });
            return;
        }
    } catch (error) {
        res.status(400).json({ message: "Invalid or expired token" });
        return;
    }
    
    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    
    // Update password and clear reset token
    await pool.query(
        `UPDATE users 
         SET password_hash = $1, 
             reset_token = NULL, 
             reset_token_expires = NULL
         WHERE user_id = $2`,
        [hashedPassword, user.user_id]
    );
    
    res.status(200).json({ message: "Password has been reset successfully" });
});

// @desc    Verify reset token (check if valid)
// @route   POST /auth/verify-reset-token
// @access  Public
export const verifyResetToken = asyncHandler(async (req: Request, res: Response) => {
    const { token } = req.body;
    
    if (!token) {
        res.status(400).json({ message: "Token is required" });
        return;
    }
    
    const userQuery = await pool.query(
        `SELECT user_id FROM users 
         WHERE reset_token = $1 AND reset_token_expires > NOW()`,
        [token]
    );
    
    if (userQuery.rows.length === 0) {
        res.status(400).json({ message: "Invalid or expired token" });
        return;
    }
    
    // Verify JWT
    try {
        jwt.verify(token, process.env.JWT_SECRET!);
        res.status(200).json({ valid: true, message: "Token is valid" });
    } catch (error) {
        res.status(400).json({ valid: false, message: "Invalid or expired token" });
    }
});