// ============================================
// productsRoutes.ts (UPDATED)
// ============================================

import express from 'express'
import { 
    createProduct, 
    getProducts, 
    getProductById, 
    updateProduct, 
    deleteProduct, 
    getProductsCountByCategoryId, 
    getProductsByCategoryName 
} from '../controllers/productsController';
import { searchProducts, getSearchSuggestions } from '../controllers/searchController';
import { protect } from '../middlewares/auth/protect';
import { adminSellerGuard } from '../middlewares/auth/roleMiddleWare';

const router = express.Router();

// ⚠️ IMPORTANT: Specific routes BEFORE /:id to avoid conflicts
router.get("/search/suggestions", getSearchSuggestions);  // GET /products/search/suggestions?q=iph
router.get("/search", searchProducts);                     // GET /products/search?q=iphone&category=Phones
router.get("/category/:name", getProductsByCategoryName);  // GET /products/category/Phones
router.get("/count/:id", getProductsCountByCategoryId);    // GET /products/count/:categoryId

// Standard CRUD
router.get("/", getProducts);
router.get("/:id", getProductById);
router.post("/", protect, adminSellerGuard, createProduct);
router.put("/:id", protect, adminSellerGuard, updateProduct);
router.delete("/:id", protect, adminSellerGuard, deleteProduct);

export default router;