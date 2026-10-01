// tests/token-verify.test.js
// Tests Token Verification, Double Collection Guard, and NOT_COLLECTED logic

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pool from '../src/db/pool.js';
import { verifyAndClaimToken } from '../src/services/token.service.js';
import { autoMarkNotCollected } from '../src/services/scheduler.service.js';

describe('Order Collection & Token Verification', () => {
  let customerId, staffId, orderId1, orderId2;

  beforeAll(async () => {
    // 1. Create Customer & Staff
    const { rows: uRows } = await pool.query(`
      INSERT INTO users (name, email, password_hash, role)
      VALUES 
        ('Token Customer', 'token_cust@demo.com', 'hash', 'CUSTOMER'),
        ('Token Staff', 'token_staff@demo.com', 'hash', 'STAFF')
      ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
      RETURNING user_id, role
    `);
    
    customerId = uRows.find(u => u.role === 'CUSTOMER').user_id;
    staffId    = uRows.find(u => u.role === 'STAFF').user_id;

    // 2. Insert Orders
    const { rows: oRows } = await pool.query(`
      INSERT INTO orders (customer_id, token_number, idempotency_key, total_amount, order_status, is_collected, updated_at)
      VALUES 
        ($1, 'C-TEST1', 'IDEM_TEST1', 100.00, 'READY', FALSE, NOW()),
        ($1, 'C-TEST2', 'IDEM_TEST2', 150.00, 'READY', FALSE, NOW() - INTERVAL '40 minutes')
      RETURNING order_id, token_number
    `, [customerId]);

    orderId1 = oRows.find(o => o.token_number === 'C-TEST1').order_id;
    orderId2 = oRows.find(o => o.token_number === 'C-TEST2').order_id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM staff_activity_logs WHERE staff_id = $1`, [staffId]);
    await pool.query(`DELETE FROM orders WHERE customer_id = $1`, [customerId]);
    await pool.query(`DELETE FROM users WHERE user_id IN ($1, $2)`, [customerId, staffId]);
  });

  it('verifies token and marks order as collected successfully', async () => {
    const res = await verifyAndClaimToken(orderId1, staffId);
    expect(res.success).toBe(true);
    expect(res.order.is_collected).toBe(true);
    expect(res.order.order_status).toBe('COLLECTED');
    expect(res.order.collected_at).not.toBeNull();
  });

  it('prevents double-collection of the same token', async () => {
    // Try to collect the same order again
    const res = await verifyAndClaimToken(orderId1, staffId);
    expect(res.success).toBe(false);
    expect(res.error).toContain('already been collected');
  });

  it('blocks collection if order is not in READY state', async () => {
    // Change order 2 to PREPARING
    await pool.query(`UPDATE orders SET order_status = 'PREPARING' WHERE order_id = $1`, [orderId2]);
    
    const res = await verifyAndClaimToken(orderId2, staffId);
    expect(res.success).toBe(false);
    expect(res.error).toContain('must be READY');

    // Revert to READY and reset time for the next test
    await pool.query(`UPDATE orders SET order_status = 'READY', updated_at = NOW() - INTERVAL '40 minutes' WHERE order_id = $1`, [orderId2]);
  });

  it('background scheduler auto-marks uncollected orders as NOT_COLLECTED', async () => {
    // orderId2 has been READY for 40 minutes (limit is 30 mins for non-scheduled)
    const affectedCount = await autoMarkNotCollected();
    expect(affectedCount).toBeGreaterThanOrEqual(1);

    const { rows } = await pool.query(`SELECT order_status FROM orders WHERE order_id = $1`, [orderId2]);
    expect(rows[0].order_status).toBe('NOT_COLLECTED');
  });

  it('blocks token verification for NOT_COLLECTED orders', async () => {
    const res = await verifyAndClaimToken(orderId2, staffId);
    expect(res.success).toBe(false);
    expect(res.error).toContain('must be READY');
  });

});
