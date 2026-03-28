import { Request, Response } from "express";
import pool from "../config/db.config";
import asyncHandler from "../middlewares/asyncHandler";
import { UserRequest } from "../utils/types/userTypes";

// ============================================================
// ADMIN DASHBOARD CONTROLLER — v2.0
// Removed: seller stats, top-sellers, seller stock queries
// Added:   agent stats, top-agents, agent-referred orders
// ============================================================

export const getDashboardStats = asyncHandler(async (req: UserRequest, res: Response) => {
    const [usersStats, productsStats, ordersStats, revenueStats,
           paymentsStats, categoriesStats, reviewsStats, cartsStats,
           agentsStats, offersStats] = await Promise.all([

        pool.query(`SELECT
             COUNT(*) as total_users,
             COUNT(CASE WHEN role = 'customer' THEN 1 END) as total_customers,
             COUNT(CASE WHEN role = 'agent'    THEN 1 END) as total_agents,
             COUNT(CASE WHEN role = 'admin'    THEN 1 END) as total_admins,
             COUNT(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 END) as new_users_last_30_days,
             COUNT(CASE WHEN created_at >= NOW() - INTERVAL '7 days'  THEN 1 END) as new_users_last_7_days
         FROM users`),

        pool.query(`SELECT
             COUNT(*) as total_products,
             COUNT(CASE WHEN stock > 0  THEN 1 END) as in_stock_products,
             COUNT(CASE WHEN stock = 0  THEN 1 END) as out_of_stock_products,
             COUNT(CASE WHEN stock <= 10 AND stock > 0 THEN 1 END) as low_stock_products,
             COALESCE(AVG(price), 0) as average_price,
             COALESCE(SUM(stock), 0) as total_stock_units
         FROM products WHERE is_active = TRUE`),

        pool.query(`SELECT
             COUNT(*) as total_orders,
             COUNT(CASE WHEN status = 'pending'    THEN 1 END) as pending_orders,
             COUNT(CASE WHEN status = 'paid'       THEN 1 END) as paid_orders,
             COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing_orders,
             COUNT(CASE WHEN status = 'shipped'    THEN 1 END) as shipped_orders,
             COUNT(CASE WHEN status = 'delivered'  THEN 1 END) as delivered_orders,
             COUNT(CASE WHEN status = 'cancelled'  THEN 1 END) as cancelled_orders,
             COUNT(CASE WHEN status = 'failed'     THEN 1 END) as failed_orders,
             COUNT(CASE WHEN agent_id IS NOT NULL   THEN 1 END) as agent_referred_orders,
             COUNT(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 END) as orders_last_30_days
         FROM orders`),

        pool.query(`SELECT
             COALESCE(SUM(total_amount), 0) as total_revenue,
             COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN total_amount END), 0) as revenue_last_30_days,
             COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL '7 days'  THEN total_amount END), 0) as revenue_last_7_days,
             COALESCE(AVG(total_amount), 0) as average_order_value,
             COALESCE(SUM(commission_total), 0) as total_commissions_paid
         FROM orders WHERE status NOT IN ('cancelled','failed')`),

        pool.query(`SELECT
             COUNT(*) as total_payments,
             COUNT(CASE WHEN is_confirmed = true  THEN 1 END) as confirmed_payments,
             COUNT(CASE WHEN is_confirmed = false THEN 1 END) as pending_payments,
             COUNT(CASE WHEN method = 'mpesa'            THEN 1 END) as mpesa_payments,
             COUNT(CASE WHEN method = 'cash_on_delivery' THEN 1 END) as cod_payments,
             COALESCE(SUM(amount), 0) as total_payment_amount
         FROM payments`),

        pool.query(`SELECT
             COUNT(*) as total_categories,
             COUNT(CASE WHEN featured = true THEN 1 END) as featured_categories
         FROM categories`),

        pool.query(`SELECT
             COUNT(*) as total_reviews,
             COALESCE(AVG(rating), 0) as average_rating,
             COUNT(CASE WHEN rating = 5 THEN 1 END) as five_star_reviews,
             COUNT(CASE WHEN rating = 4 THEN 1 END) as four_star_reviews,
             COUNT(CASE WHEN rating = 3 THEN 1 END) as three_star_reviews,
             COUNT(CASE WHEN rating = 2 THEN 1 END) as two_star_reviews,
             COUNT(CASE WHEN rating = 1 THEN 1 END) as one_star_reviews
         FROM reviews`),

        pool.query(`SELECT
             COUNT(*) as total_carts,
             COUNT(CASE WHEN status = 'active'    THEN 1 END) as active_carts,
             COUNT(CASE WHEN status = 'abandoned' THEN 1 END) as abandoned_carts
         FROM carts`),

        pool.query(`SELECT
             COUNT(*) as total_agents,
             COUNT(CASE WHEN is_active = true  THEN 1 END) as active_agents,
             COUNT(CASE WHEN is_active = false THEN 1 END) as inactive_agents
         FROM agents`),

        pool.query(`SELECT
             COUNT(*) as total_offers,
             COUNT(CASE WHEN is_active = true THEN 1 END) as active_offers
         FROM special_offers`),
    ]);

    res.status(200).json({
        success: true,
        data: {
            users: {
                total:         parseInt(usersStats.rows[0].total_users),
                customers:     parseInt(usersStats.rows[0].total_customers),
                agents:        parseInt(usersStats.rows[0].total_agents),
                admins:        parseInt(usersStats.rows[0].total_admins),
                newLast30Days: parseInt(usersStats.rows[0].new_users_last_30_days),
                newLast7Days:  parseInt(usersStats.rows[0].new_users_last_7_days),
            },
            products: {
                total:          parseInt(productsStats.rows[0].total_products),
                inStock:        parseInt(productsStats.rows[0].in_stock_products),
                outOfStock:     parseInt(productsStats.rows[0].out_of_stock_products),
                lowStock:       parseInt(productsStats.rows[0].low_stock_products),
                averagePrice:   parseFloat(productsStats.rows[0].average_price).toFixed(2),
                totalStockUnits:parseInt(productsStats.rows[0].total_stock_units),
            },
            orders: {
                total:          parseInt(ordersStats.rows[0].total_orders),
                pending:        parseInt(ordersStats.rows[0].pending_orders),
                paid:           parseInt(ordersStats.rows[0].paid_orders),
                processing:     parseInt(ordersStats.rows[0].processing_orders),
                shipped:        parseInt(ordersStats.rows[0].shipped_orders),
                delivered:      parseInt(ordersStats.rows[0].delivered_orders),
                cancelled:      parseInt(ordersStats.rows[0].cancelled_orders),
                failed:         parseInt(ordersStats.rows[0].failed_orders),
                agentReferred:  parseInt(ordersStats.rows[0].agent_referred_orders),
                last30Days:     parseInt(ordersStats.rows[0].orders_last_30_days),
            },
            revenue: {
                total:              parseFloat(revenueStats.rows[0].total_revenue).toFixed(2),
                last30Days:         parseFloat(revenueStats.rows[0].revenue_last_30_days).toFixed(2),
                last7Days:          parseFloat(revenueStats.rows[0].revenue_last_7_days).toFixed(2),
                averageOrderValue:  parseFloat(revenueStats.rows[0].average_order_value).toFixed(2),
                totalCommissionsPaid: parseFloat(revenueStats.rows[0].total_commissions_paid).toFixed(2),
            },
            payments: {
                total:       parseInt(paymentsStats.rows[0].total_payments),
                confirmed:   parseInt(paymentsStats.rows[0].confirmed_payments),
                pending:     parseInt(paymentsStats.rows[0].pending_payments),
                mpesa:       parseInt(paymentsStats.rows[0].mpesa_payments),
                cod:         parseInt(paymentsStats.rows[0].cod_payments),
                totalAmount: parseFloat(paymentsStats.rows[0].total_payment_amount).toFixed(2),
            },
            categories: {
                total:    parseInt(categoriesStats.rows[0].total_categories),
                featured: parseInt(categoriesStats.rows[0].featured_categories),
            },
            reviews: {
                total:         parseInt(reviewsStats.rows[0].total_reviews),
                averageRating: parseFloat(reviewsStats.rows[0].average_rating).toFixed(2),
                fiveStar:  parseInt(reviewsStats.rows[0].five_star_reviews),
                fourStar:  parseInt(reviewsStats.rows[0].four_star_reviews),
                threeStar: parseInt(reviewsStats.rows[0].three_star_reviews),
                twoStar:   parseInt(reviewsStats.rows[0].two_star_reviews),
                oneStar:   parseInt(reviewsStats.rows[0].one_star_reviews),
            },
            carts: {
                total:     parseInt(cartsStats.rows[0].total_carts),
                active:    parseInt(cartsStats.rows[0].active_carts),
                abandoned: parseInt(cartsStats.rows[0].abandoned_carts),
            },
            agents: {
                total:    parseInt(agentsStats.rows[0].total_agents),
                active:   parseInt(agentsStats.rows[0].active_agents),
                inactive: parseInt(agentsStats.rows[0].inactive_agents),
            },
            offers: {
                total:  parseInt(offersStats.rows[0].total_offers),
                active: parseInt(offersStats.rows[0].active_offers),
            },
        },
    });
});

export const getRevenueTrends = asyncHandler(async (req: UserRequest, res: Response) => {
    const { period = "12" } = req.query;
    const result = await pool.query(
        `SELECT
             TO_CHAR(created_at, 'Mon YYYY') as month,
             EXTRACT(YEAR  FROM created_at) as year,
             EXTRACT(MONTH FROM created_at) as month_number,
             COUNT(*) as order_count,
             COALESCE(SUM(total_amount), 0) as revenue,
             COALESCE(SUM(commission_total), 0) as commissions,
             COALESCE(AVG(total_amount), 0) as average_order_value
         FROM orders
         WHERE status NOT IN ('cancelled','failed')
           AND created_at >= NOW() - INTERVAL '${parseInt(period as string)} months'
         GROUP BY year, month_number, month
         ORDER BY year DESC, month_number DESC`
    );
    res.status(200).json({ success: true, data: result.rows });
});

export const getDailyRevenue = asyncHandler(async (req: UserRequest, res: Response) => {
    const result = await pool.query(
        `SELECT DATE(created_at) as date, COUNT(*) as order_count,
                COALESCE(SUM(total_amount), 0) as revenue
         FROM orders
         WHERE status NOT IN ('cancelled','failed')
           AND created_at >= DATE_TRUNC('month', CURRENT_DATE)
         GROUP BY DATE(created_at) ORDER BY date ASC`
    );
    res.status(200).json({ success: true, data: result.rows });
});

export const getTopProducts = asyncHandler(async (req: UserRequest, res: Response) => {
    const { limit = "10" } = req.query;
    const result = await pool.query(
        `SELECT p.product_id, p.title, p.price, p.sale_price, p.stock,
                c.name as category_name,
                COUNT(oi.order_item_id) as times_ordered,
                SUM(oi.quantity) as units_sold,
                COALESCE(SUM(oi.subtotal), 0) as revenue
         FROM products p
         LEFT JOIN categories c ON p.category_id = c.category_id
         LEFT JOIN order_items oi ON p.product_id = oi.product_id
         GROUP BY p.product_id, p.title, p.price, p.sale_price, p.stock, c.name
         ORDER BY units_sold DESC NULLS LAST
         LIMIT $1`,
        [parseInt(limit as string)]
    );
    res.status(200).json({ success: true, data: result.rows });
});

export const getTopCustomers = asyncHandler(async (req: UserRequest, res: Response) => {
    const { limit = "10" } = req.query;
    const result = await pool.query(
        `SELECT u.user_id, u.name, u.email, u.phone,
                COUNT(o.order_id) as total_orders,
                COALESCE(SUM(o.total_amount), 0) as total_spent,
                MAX(o.created_at) as last_order_date
         FROM users u
         JOIN orders o ON u.user_id = o.user_id
         WHERE o.status NOT IN ('cancelled','failed')
         GROUP BY u.user_id, u.name, u.email, u.phone
         ORDER BY total_spent DESC LIMIT $1`,
        [parseInt(limit as string)]
    );
    res.status(200).json({ success: true, data: result.rows });
});

// Replaces getTopSellers — now returns top agents by revenue generated
export const getTopAgents = asyncHandler(async (req: UserRequest, res: Response) => {
    const { limit = "10" } = req.query;
    const result = await pool.query(
        `SELECT a.agent_id, a.agent_code, a.full_name, u.email,
                COUNT(DISTINCT o.order_id) as total_orders,
                COALESCE(SUM(o.total_amount), 0) as revenue_generated,
                COALESCE(SUM(o.commission_total), 0) as total_commission
         FROM agents a
         JOIN users u ON u.user_id = a.user_id
         LEFT JOIN orders o ON o.agent_id = a.agent_id
             AND o.status NOT IN ('cancelled','failed')
         GROUP BY a.agent_id, a.agent_code, a.full_name, u.email
         ORDER BY revenue_generated DESC
         LIMIT $1`,
        [parseInt(limit as string)]
    );
    res.status(200).json({ success: true, data: result.rows });
});

export const getLowStockProducts = asyncHandler(async (req: UserRequest, res: Response) => {
    const { threshold = "10" } = req.query;
    const result = await pool.query(
        `SELECT p.product_id, p.title, p.stock, p.price, c.name as category_name
         FROM products p
         JOIN categories c ON p.category_id = c.category_id
         WHERE p.stock <= $1 AND p.stock > 0 AND p.is_active = TRUE
         ORDER BY p.stock ASC`,
        [parseInt(threshold as string)]
    );
    res.status(200).json({ success: true, data: result.rows });
});

export const getOutOfStockProducts = asyncHandler(async (req: UserRequest, res: Response) => {
    const result = await pool.query(
        `SELECT p.product_id, p.title, p.price, c.name as category_name, p.updated_at
         FROM products p
         JOIN categories c ON p.category_id = c.category_id
         WHERE p.stock = 0 AND p.is_active = TRUE
         ORDER BY p.updated_at DESC`
    );
    res.status(200).json({ success: true, data: result.rows });
});

export const getRecentOrders = asyncHandler(async (req: UserRequest, res: Response) => {
    const { limit = "20" } = req.query;
    const result = await pool.query(
        `SELECT o.order_id, o.total_amount, o.status, o.payment_method, o.created_at,
                u.name as customer_name, u.email as customer_email, u.phone as customer_phone,
                a.full_name as agent_name, a.agent_code,
                COUNT(oi.order_item_id) as item_count
         FROM orders o
         JOIN users u ON o.user_id = u.user_id
         LEFT JOIN agents a ON o.agent_id = a.agent_id
         LEFT JOIN order_items oi ON o.order_id = oi.order_id
         GROUP BY o.order_id, u.name, u.email, u.phone, a.full_name, a.agent_code
         ORDER BY o.created_at DESC LIMIT $1`,
        [parseInt(limit as string)]
    );
    res.status(200).json({ success: true, data: result.rows });
});

export const getRecentUsers = asyncHandler(async (req: UserRequest, res: Response) => {
    const { limit = "20" } = req.query;
    const result = await pool.query(
        `SELECT u.user_id, u.name, u.email, u.phone, u.role, u.created_at,
                COUNT(o.order_id) as order_count,
                COALESCE(SUM(o.total_amount), 0) as total_spent
         FROM users u
         LEFT JOIN orders o ON u.user_id = o.user_id
         GROUP BY u.user_id, u.name, u.email, u.phone, u.role, u.created_at
         ORDER BY u.created_at DESC LIMIT $1`,
        [parseInt(limit as string)]
    );
    res.status(200).json({ success: true, data: result.rows });
});

export const getRecentReviews = asyncHandler(async (req: UserRequest, res: Response) => {
    const { limit = "20" } = req.query;
    const result = await pool.query(
        `SELECT r.review_id, r.rating, r.comment, r.created_at,
                u.name as user_name, p.title as product_title, p.product_id
         FROM reviews r
         JOIN users u ON r.user_id = u.user_id
         JOIN products p ON r.product_id = p.product_id
         ORDER BY r.created_at DESC LIMIT $1`,
        [parseInt(limit as string)]
    );
    res.status(200).json({ success: true, data: result.rows });
});

export const getCategoryPerformance = asyncHandler(async (req: UserRequest, res: Response) => {
    const result = await pool.query(
        `SELECT c.category_id, c.name as category_name,
                COUNT(DISTINCT p.product_id) as product_count,
                COUNT(DISTINCT oi.order_item_id) as times_ordered,
                COALESCE(SUM(oi.quantity), 0) as units_sold,
                COALESCE(SUM(oi.subtotal), 0) as revenue,
                COALESCE(AVG(r.rating), 0) as average_rating
         FROM categories c
         LEFT JOIN products p  ON c.category_id = p.category_id
         LEFT JOIN order_items oi ON p.product_id = oi.product_id
         LEFT JOIN reviews r   ON p.product_id = r.product_id
         GROUP BY c.category_id, c.name
         ORDER BY revenue DESC`
    );
    res.status(200).json({ success: true, data: result.rows });
});

export const getSystemAlerts = asyncHandler(async (req: UserRequest, res: Response) => {
    const alerts = [];
    const [lowStock, outOfStock, pendingOrders, unconfirmedPayments, expiredOffers] =
        await Promise.all([
            pool.query("SELECT COUNT(*) as count FROM products WHERE stock <= 10 AND stock > 0 AND is_active = TRUE"),
            pool.query("SELECT COUNT(*) as count FROM products WHERE stock = 0 AND is_active = TRUE"),
            pool.query("SELECT COUNT(*) as count FROM orders WHERE status = 'pending'"),
            pool.query("SELECT COUNT(*) as count FROM payments WHERE is_confirmed = false"),
            pool.query("SELECT COUNT(*) as count FROM special_offers WHERE is_active = true AND valid_until < NOW()"),
        ]);

    if (parseInt(lowStock.rows[0].count) > 0) alerts.push({ type: "warning", category: "inventory", message: `${lowStock.rows[0].count} products have low stock`, count: parseInt(lowStock.rows[0].count) });
    if (parseInt(outOfStock.rows[0].count) > 0) alerts.push({ type: "error", category: "inventory", message: `${outOfStock.rows[0].count} products are out of stock`, count: parseInt(outOfStock.rows[0].count) });
    if (parseInt(pendingOrders.rows[0].count) > 0) alerts.push({ type: "info", category: "orders", message: `${pendingOrders.rows[0].count} orders pending processing`, count: parseInt(pendingOrders.rows[0].count) });
    if (parseInt(unconfirmedPayments.rows[0].count) > 0) alerts.push({ type: "warning", category: "payments", message: `${unconfirmedPayments.rows[0].count} payments pending confirmation`, count: parseInt(unconfirmedPayments.rows[0].count) });
    if (parseInt(expiredOffers.rows[0].count) > 0) alerts.push({ type: "warning", category: "offers", message: `${expiredOffers.rows[0].count} active offers have expired`, count: parseInt(expiredOffers.rows[0].count) });

    res.status(200).json({ success: true, data: alerts });
});

export const getDatabaseStats = asyncHandler(async (req: UserRequest, res: Response) => {
    const result = await pool.query(
        `SELECT schemaname, tablename,
                pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
                pg_total_relation_size(schemaname||'.'||tablename) AS size_bytes
         FROM pg_tables WHERE schemaname = 'public'
         ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC`
    );
    res.status(200).json({ success: true, data: result.rows });
});

export default {
    getDashboardStats, getRevenueTrends, getDailyRevenue,
    getTopProducts, getTopCustomers, getTopAgents,
    getLowStockProducts, getOutOfStockProducts,
    getRecentOrders, getRecentUsers, getRecentReviews,
    getCategoryPerformance, getSystemAlerts, getDatabaseStats,
};