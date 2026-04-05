import express from 'express'
import { createOrder, getOrders, getOrderById, updateOrder, deleteOrder, getOrdersCount, getOrdersByUserId } from '../controllers/ordersController';
import { protect } from '../middlewares/auth/protect';
import { adminCustomerGuard, adminGuard, ownUserGuard, userGuard } from '../middlewares/auth/roleMiddleWare';


const router = express.Router()

<<<<<<< HEAD
router.get("/",  getOrders);
router.get("/ordersCount", getOrdersCount);
router.get("/:id", protect, getOrderById);
router.get("/user/orderdetails", protect, getOrdersByUserId);
router.post("/", protect, createOrder);
router.put("/:id", protect, userGuard, updateOrder);
router.delete("/:id", protect, adminGuard, deleteOrder);

=======
// ── Specific routes first ──────────────────────────────────────────────────
router.get('/ordersCount',          getOrdersCount);
router.get('/user/orderdetails',    protect, getOrdersByUserId);
 
// ── Collection ─────────────────────────────────────────────────────────────
router.get('/',                     getOrders);
router.post('/',                    protect, createOrder);
 
// ── Wildcard /:id LAST — catches any numeric ID ────────────────────────────
router.get('/:id',                  protect, getOrderById);
router.put('/:id',                  protect, userGuard, updateOrder);
router.delete('/:id',               protect, adminGuard, deleteOrder);
>>>>>>> 2cabd9f (Database)
export default router
