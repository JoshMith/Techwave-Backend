import express from "express";
import {
    bulkUpdateUsers, changeUserRole, resetUserPassword,
    bulkUpdateOrders, getOrderDetails,
    bulkUpdateProducts, getProductDetails,
    manualPaymentConfirmation, getPendingPayments,
    mergeCategories, bulkDeleteReviews, getFlaggedReviews,
} from "../controllers/adminManagementController";
import { protect } from "../middlewares/auth/protect";
import { adminGuard } from "../middlewares/auth/roleMiddleWare";

// ============================================================
// ADMIN MANAGEMENT ROUTES — v2.0
// Removed: /sellers/:id/status, /sellers/:id/details
// Agent management is handled by /agents routes instead.
// ============================================================

const router = express.Router();

router.use(protect);
router.use(adminGuard);

// Users
router.put("/users/bulk-update",         bulkUpdateUsers);
router.put("/users/:id/role",            changeUserRole);
router.put("/users/:id/reset-password",  resetUserPassword);

// Orders
router.put("/orders/bulk-update",        bulkUpdateOrders);
router.get("/orders/:id/details",        getOrderDetails);

// Products
router.put("/products/bulk-update",      bulkUpdateProducts);
router.get("/products/:id/details",      getProductDetails);

// Payments
router.put("/payments/:id/confirm",      manualPaymentConfirmation);
router.get("/payments/pending",          getPendingPayments);

// Categories
router.post("/categories/merge",         mergeCategories);

// Reviews
router.delete("/reviews/bulk-delete",    bulkDeleteReviews);
router.get("/reviews/flagged",           getFlaggedReviews);

export default router;