import express from "express";
import {
    createProduct, getProducts, getProductById,
    updateProduct, deleteProduct,
    getProductsCountByCategoryId, getProductsByCategoryName,
} from "../controllers/productsController";
import { searchProducts, getSearchSuggestions } from "../controllers/searchController";
import { protect } from "../middlewares/auth/protect";
import { adminGuard } from "../middlewares/auth/roleMiddleWare";

// ============================================================
// PRODUCTS ROUTES — v2.0
// Removed: adminSellerGuard (sellers no longer manage products)
// All product mutations: adminGuard only
// ============================================================

const router = express.Router();

// Specific routes before /:id
router.get("/search/suggestions", getSearchSuggestions);
router.get("/search",             searchProducts);
router.get("/category/:name",     getProductsByCategoryName);
router.get("/count/:id",          getProductsCountByCategoryId);

// Standard CRUD
router.get("/",    getProducts);
router.get("/:id", getProductById);
router.post("/",   protect, adminGuard, createProduct);
router.put("/:id", protect, adminGuard, updateProduct);
router.delete("/:id", protect, adminGuard, deleteProduct);

export default router;