import express from 'express'
import { createOrder, getOrders, getOrderById, updateOrder, deleteOrder, getOrdersCount, getOrdersByUserId, getUserOrderForProduct, getOrdersByUserIdForAdmin } from '../controllers/ordersController';
import { protect } from '../middlewares/auth/protect';
import { adminCustomerGuard, adminGuard, ownUserGuard, userGuard } from '../middlewares/auth/roleMiddleWare';


const router = express.Router()

router.get("/",  getOrders);
router.get("/ordersCount", getOrdersCount);
router.get("/:id", protect, getOrderById);
router.get("/user/orderdetails", protect, getOrdersByUserId);
router.get("/user/product/:productId", protect, getUserOrderForProduct);
router.get("/user/:userId", protect, adminGuard, getOrdersByUserIdForAdmin);
router.post("/", protect, createOrder);
router.put("/:id", protect, userGuard, updateOrder);
router.delete("/:id", protect, adminGuard, deleteOrder);

export default router
