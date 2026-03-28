import express from "express";
import {
    createAgent,
    getAgents,
    getAgentById,
    updateAgent,
    deactivateAgent,
    getAgentDashboard,
    getAgentOrders,
    getCommissionReport,
} from "../controllers/agentController";
import { protect } from "../middlewares/auth/protect";
import { adminGuard, agentGuard } from "../middlewares/auth/roleMiddleWare";

const router = express.Router();

// ── Admin routes ───────────────────────────────────────────
router.post("/",                protect, adminGuard, createAgent);
router.get("/",                 protect, adminGuard, getAgents);
router.get("/commissions/report", protect, adminGuard, getCommissionReport);
router.get("/:id",              protect, adminGuard, getAgentById);
router.put("/:id",              protect, adminGuard, updateAgent);
router.patch("/:id/deactivate", protect, adminGuard, deactivateAgent);

// ── Agent self-service routes ──────────────────────────────
router.get("/me/dashboard",     protect, agentGuard, getAgentDashboard);
router.get("/me/orders",        protect, agentGuard, getAgentOrders);

export default router;