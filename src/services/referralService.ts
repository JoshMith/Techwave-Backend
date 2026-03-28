import pool from "../config/db.config";

// ============================================================
// REFERRAL SERVICE — v2.0
// Session-only tracking confirmed.
// Resolves referral code to agent_id at order creation.
// ============================================================

/**
 * Validate a referral code and return the agent_id.
 * Returns null if the code does not exist or agent is inactive.
 * Session-only: this is called at checkout when the frontend
 * passes the referral_code captured from sessionStorage.
 */
export async function resolveReferralCode(
    referralCode: string | null | undefined
): Promise<{ agent_id: number; agent_code: string } | null> {
    if (!referralCode) return null;

    const result = await pool.query(
        `SELECT agent_id, agent_code
         FROM agents
         WHERE agent_code = $1 AND is_active = TRUE`,
        [referralCode]
    );

    if (result.rows.length === 0) return null;
    return result.rows[0];
}

/**
 * Calculate category-based commission for an order's items.
 * Called immediately after the order is created.
 *
 * Commission rates (confirmed March 2026):
 *   Accessories: 8%
 *   All other categories: 2.5%
 *
 * Inserts one row into commissions per order_item.
 * Updates orders.commission_total with the sum.
 */
export async function calculateAndStoreCommissions(
    orderId: number,
    agentId: number,
    client: any  // pg PoolClient — pass the transaction client
): Promise<number> {
    // Get all order items with their category
    const items = await client.query(
        `SELECT
             oi.order_item_id, oi.subtotal, oi.category_id,
             cat.name AS category_name,
             cr.rate_percent
         FROM order_items oi
         JOIN categories cat ON cat.category_id = oi.category_id
         LEFT JOIN commission_rates cr
             ON cr.category_id = oi.category_id AND cr.is_active = TRUE
         WHERE oi.order_id = $1`,
        [orderId]
    );

    let totalCommission = 0;

    for (const item of items.rows) {
        const rate = item.rate_percent ?? 2.5; // Default to 2.5% if rate not set
        const earned = parseFloat(item.subtotal) * (rate / 100);
        totalCommission += earned;

        await client.query(
            `INSERT INTO commissions
                 (agent_id, order_id, order_item_id, category_id,
                  item_subtotal, rate_applied, amount_earned)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [agentId, orderId, item.order_item_id, item.category_id,
             item.subtotal, rate, earned.toFixed(2)]
        );
    }

    // Update the denormalised commission_total on orders
    await client.query(
        `UPDATE orders SET commission_total = $1 WHERE order_id = $2`,
        [totalCommission.toFixed(2), orderId]
    );

    return totalCommission;
}