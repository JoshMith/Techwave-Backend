import { Response, NextFunction } from "express";
import asyncHandler from "../asyncHandler";
import { UserRequest, UserRole } from "../../utils/types/userTypes";
import { ownUserMiddleware } from "./ownUserMiddleware";

// ============================================================
// ROLE GUARDS — v2.0
// Removed: sellerGuard, adminSellerGuard
// Added:   agentGuard, adminAgentGuard
// ============================================================

export const roleGuard = (allowedRoles: UserRole[]) =>
    asyncHandler<void, UserRequest>(async (req: UserRequest, res: Response, next: NextFunction) => {
        if (!req.user || !allowedRoles.includes(req.user?.role as UserRole)) {
            res.status(403).json({ message: "Access denied: Insufficient permissions" });
            return;
        }
        next();
    });

// Role-specific guards
export const adminGuard    = roleGuard(["admin"]);
export const agentGuard    = roleGuard(["agent"]);
export const customerGuard = roleGuard(["customer"]);

// Combined guards
export const userGuard          = roleGuard(["customer", "agent", "admin"]);
export const adminCustomerGuard = roleGuard(["admin", "customer"]);
export const adminAgentGuard    = roleGuard(["admin", "agent"]);

// Own-user guard (unchanged)
export const ownUserGuard = ownUserMiddleware;