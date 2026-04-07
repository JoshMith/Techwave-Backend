import express from "express";
import {
    login, agentLogin, register, logout,
    verifyEmail, googleAuth, googleAuthCallback,
    forgotPassword,
    resetPassword,
    verifyResetToken,
} from "../controllers/authController";

const router = express.Router();

router.post("/register",          register);
router.post("/login",             login);        // customers + admins
router.post("/agent/login",       agentLogin);   // agents only (separate endpoint)
router.post("/logout",            logout);
router.get("/verifyEmail",        verifyEmail);
router.get("/google",             googleAuth);
router.get("/google/callback",    googleAuthCallback);

// Password reset routes
router.post("/forgot-password",   forgotPassword);
router.post("/reset-password",    resetPassword);
router.post("/verify-reset-token", verifyResetToken);

export default router;