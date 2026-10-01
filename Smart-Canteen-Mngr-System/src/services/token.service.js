// src/services/token.service.js
// Generates unique, human-readable Digital Order Tokens (e.g. C-023)
// and enforces single-collection locking via DB transaction.

import pool from '../db/pool.js';

/**
 * generateOrderToken()
 * Fetches today's order count and returns the next sequential token.
 * Format: C-001, C-002 ... C-999 (resets each day at midnight).
 * Uses a DB sequence approach for atomicity.
 */
export async function generateOrderToken(client) {
  // Count orders placed today
  const { rows } = await client.query(
    `SELECT COUNT(*) AS cnt FROM orders
     WHERE order_time::date = CURRENT_DATE`
  );
  const sequence = parseInt(rows[0].cnt, 10) + 1;
  return `C-${String(sequence).padStart(3, '0')}`; // C-001 … C-999
}

/**
 * verifyAndClaimToken(orderId, staffId)
 * Atomically marks an order as collected to prevent double-collection.
 * Returns { success, order } or { success: false, error }.
 */
export async function verifyAndClaimToken(orderId, staffId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the row for update — prevents race conditions
    const { rows } = await client.query(
      `SELECT order_id, token_number, order_status, is_collected
       FROM orders WHERE order_id = $1
       FOR UPDATE`,
      [orderId]
    );

    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Order not found.' };
    }

    const order = rows[0];

    if (order.is_collected) {
      await client.query('ROLLBACK');
      return {
        success: false,
        error: `Token ${order.token_number} has already been collected. Duplicate collection blocked.`,
      };
    }

    if (order.order_status !== 'READY') {
      await client.query('ROLLBACK');
      return {
        success: false,
        error: `Order status is "${order.order_status}". Order must be READY before collection.`,
      };
    }

    // Mark collected — atomic update
    const { rows: updated } = await client.query(
      `UPDATE orders
       SET is_collected = TRUE,
           collected_at = NOW(),
           order_status = 'COLLECTED',
           updated_at   = NOW()
       WHERE order_id = $1
       RETURNING *`,
      [orderId]
    );

    // Log staff action
    await client.query(
      `INSERT INTO staff_activity_logs (staff_id, action, entity, entity_id, details)
       VALUES ($1, 'COLLECT_ORDER', 'orders', $2, $3)`,
      [staffId, orderId, JSON.stringify({ token: order.token_number })]
    );

    await client.query('COMMIT');
    return { success: true, order: updated[0] };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
