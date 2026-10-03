// src/controllers/order.controller.js
// Steps 3-20 of the 20-step Pre-Order Workflow
//
//  Steps 3-11  → placeOrder()      (Customer: select items → confirm → token issued)
//  Step  12    → getLiveQueue()     (Staff: see new order arrive)
//  Steps 13-14 → updateOrderStatus() (Staff: ACCEPTED → PREPARING)
//  Step  15    → getOrderById()     (Customer: track live status)
//  Steps 16-17 → updateOrderStatus() (Staff: READY → customer notified)
//  Steps 18-19 → collectOrder()    (Staff: verify token & confirm collection)
//  Step  20    → updateOrderStatus() (Auto: COLLECTED → COMPLETED)

import pool from '../db/pool.js';
import { calculateEPT } from '../services/ept.service.js';
import { generateOrderToken } from '../services/token.service.js';
import { verifyAndClaimToken } from '../services/token.service.js';
import {
  validateCustomerLimits,
  validateItemStock,
  validateSlotCapacity,
  updateStockAndAutoStatus
} from '../services/stock-limits.service.js';

// ─── Valid status transition map ────────────────────────────────────────────
const ALLOWED_TRANSITIONS = {
  PLACED:    ['ACCEPTED', 'REJECTED', 'CANCELLED'],
  ACCEPTED:  ['PREPARING', 'DELAYED', 'CANCELLED'],
  PREPARING: ['READY', 'DELAYED', 'CANCELLED'],
  READY:     ['COLLECTED', 'NOT_COLLECTED'],
  COLLECTED: ['COMPLETED'],
  DELAYED:   ['PREPARING', 'READY', 'CANCELLED'],
  // Terminal states — no further transitions
  COMPLETED:     [],
  CANCELLED:     [],
  REJECTED:      [],
  NOT_COLLECTED: [],
};

// ─── Who can perform which transitions ─────────────────────────────────────
const TRANSITION_ROLES = {
  CANCELLED:     ['CUSTOMER', 'STAFF', 'MANAGER', 'ADMIN'],
  ACCEPTED:      ['STAFF', 'MANAGER', 'ADMIN'],
  REJECTED:      ['STAFF', 'MANAGER', 'ADMIN'],
  PREPARING:     ['STAFF', 'MANAGER', 'ADMIN'],
  DELAYED:       ['STAFF', 'MANAGER', 'ADMIN'],
  READY:         ['STAFF', 'MANAGER', 'ADMIN'],
  COLLECTED:     ['STAFF', 'MANAGER', 'ADMIN'],
  NOT_COLLECTED: ['STAFF', 'MANAGER', 'ADMIN'],
  COMPLETED:     ['STAFF', 'MANAGER', 'ADMIN'],
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/orders
// Steps 3-11: Customer selects items, confirms order, token generated
// Requires: verifyToken + checkIdempotency middleware
// ─────────────────────────────────────────────────────────────────────────────
export async function placeOrder(req, res) {
  const { items, slot_id, special_notes } = req.body;
  const customerId = req.user.user_id;

  // ── Validation ──────────────────────────────────────────────────────────
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'items array is required and must not be empty.',
    });
  }

  // Validate each item has item_id and quantity
  for (const item of items) {
    if (!item.item_id || !item.quantity || item.quantity < 1) {
      return res.status(400).json({
        success: false,
        error: 'Each item must have item_id and quantity >= 1.',
      });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── 1. Check Customer Limits (Max items per order, max active orders) ──
    const customerLimitCheck = await validateCustomerLimits(customerId, items, client);
    if (!customerLimitCheck.valid) {
      await client.query('ROLLBACK');
      return res.status(customerLimitCheck.statusCode).json({
        success: false,
        error: customerLimitCheck.error,
      });
    }

    // ── 2. Validate Item Stock & Availability ──────────────────────────────
    const stockCheck = await validateItemStock(items, client);
    if (!stockCheck.valid) {
      await client.query('ROLLBACK');
      return res.status(stockCheck.statusCode).json({
        success: false,
        error: stockCheck.error,
        item_id: stockCheck.item_id,
        item_name: stockCheck.item_name,
        available_quantity: stockCheck.available_quantity,
      });
    }

    const menuMap = stockCheck.menuItems;
    const orderLines = [];
    let totalAmount = 0;

    for (const reqItem of items) {
      const menuItem = menuMap[reqItem.item_id];
      const lineTotal = parseFloat(menuItem.price) * reqItem.quantity;
      totalAmount += lineTotal;

      orderLines.push({
        item_id:             reqItem.item_id,
        item_name:           menuItem.item_name,
        quantity:            reqItem.quantity,
        price:               menuItem.price,
        preparation_time:    menuItem.preparation_time,
        special_instruction: reqItem.special_instruction || null,
      });
    }

    // ── 3. Validate Pickup Slot Capacity (15-Minute Windows) ───────────────
    const slotCheck = await validateSlotCapacity(req.body.scheduled_pickup_time, client);
    if (!slotCheck.valid) {
      await client.query('ROLLBACK');
      return res.status(slotCheck.statusCode).json({
        success: false,
        error: slotCheck.error,
        alternative_slots: slotCheck.alternative_slots,
      });
    }

    const pickupTime = req.body.scheduled_pickup_time || null;

    // ── Step 10: Calculate EPT ─────────────────────────────────────────────
    const { eptMinutes, estimatedReadyAt } = await calculateEPT(orderLines, client);

    // ── Step 10: Create order record ────────────────────────────────────────
    const { rows: orderRows } = await client.query(
      `INSERT INTO orders
         (customer_id, idempotency_key,
          total_amount, pickup_time, estimated_ready_time, order_status, payment_status)
       VALUES ($1, $2, $3, $4, $5, 'PLACED', 'PENDING')
       RETURNING *`,
      [
        customerId,
        req.idempotencyKey,
        totalAmount.toFixed(2),
        pickupTime,
        estimatedReadyAt,
      ]
    );

    const newOrder = orderRows[0];

    // ── Insert order items & decrement stock ───────────────────────────────
    for (const line of orderLines) {
      await client.query(
        `INSERT INTO order_items
           (order_id, item_id, quantity, price, special_instruction)
         VALUES ($1, $2, $3, $4, $5)`,
        [newOrder.order_id, line.item_id, line.quantity, line.price, line.special_instruction]
      );

      // Decrement stock and auto-mark sold out / limited
      await updateStockAndAutoStatus(line.item_id, line.quantity, client);
    }

    await client.query('COMMIT');

    // ── Build response payload ─────────────────────────────────────────────
    const response = {
      success: true,
      message: `Order placed! Your token is ${newOrder.token_number}. Estimated ready in ${eptMinutes} min.`,
      order: {
        order_id:             newOrder.order_id,
        token_number:         newOrder.token_number,
        order_status:         'PLACED',
        total_amount:         parseFloat(totalAmount.toFixed(2)),
        estimated_ready_time: estimatedReadyAt,
        ept_minutes:          eptMinutes,
        pickup_time:          pickupTime,
        items:                orderLines.map((l) => ({
          item_name:           l.item_name,
          quantity:            l.quantity,
          price:               l.price,
          special_instruction: l.special_instruction,
        })),
      },
    };

    // ── Cache for idempotency (step 10 guard) ──────────────────────────────
    await req.saveIdempotentResponse(response);

    return res.status(201).json(response);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('placeOrder error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to place order. Please try again.' });
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/orders/:orderId
// Step 15: Customer tracks live order status
// ─────────────────────────────────────────────────────────────────────────────
export async function getOrderById(req, res) {
  try {
    const { orderId } = req.params;

    const { rows } = await pool.query(
      `SELECT
         o.order_id, o.token_number, o.order_status,
         o.order_time, o.pickup_time, o.estimated_ready_time, o.collected_at,
         o.total_amount, o.payment_status, o.is_collected,
         o.cancellation_reason,
         EXTRACT(EPOCH FROM (NOW() - o.order_time)) / 60 AS wait_minutes,
         CASE
           WHEN o.estimated_ready_time IS NOT NULL AND o.order_status = 'PREPARING'
           THEN GREATEST(0, EXTRACT(EPOCH FROM (o.estimated_ready_time - NOW())) / 60)
           ELSE NULL
         END AS minutes_until_ready,
         u.name  AS customer_name,
         u.email AS customer_email,
         json_agg(json_build_object(
           'order_item_id',     oi.order_item_id,
           'item_name',         mi.item_name,
           'category',          mi.category,
           'quantity',          oi.quantity,
           'price',             oi.price,
           'special_instruction', oi.special_instruction
         ) ORDER BY mi.item_name) AS items
       FROM orders o
       JOIN users u        ON u.user_id   = o.customer_id
       JOIN order_items oi ON oi.order_id = o.order_id
       JOIN menu_items mi  ON mi.item_id  = oi.item_id
       WHERE o.order_id = $1
       GROUP BY o.order_id, u.name, u.email`,
      [orderId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Order not found.' });
    }

    const order = rows[0];

    // Customers can only see their own orders
    if (req.user.role === 'CUSTOMER' && order.customer_email !== req.user.email) {
      return res.status(403).json({ success: false, error: 'Access denied.' });
    }

    return res.json({ success: true, order });
  } catch (err) {
    console.error('getOrderById error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to fetch order.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/orders/my
// Customer: list all their own orders
// ─────────────────────────────────────────────────────────────────────────────
export async function getMyOrders(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT
         o.order_id, o.token_number, o.order_status,
         o.order_time, o.pickup_time, o.estimated_ready_time,
         o.total_amount, o.payment_status,
         json_agg(json_build_object(
           'item_name', mi.item_name,
           'quantity',  oi.quantity,
           'price',     oi.price
         ) ORDER BY mi.item_name) AS items
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.order_id
       JOIN menu_items mi  ON mi.item_id  = oi.item_id
       WHERE o.customer_id = $1
       GROUP BY o.order_id
       ORDER BY o.order_time DESC`,
      [req.user.user_id]
    );

    return res.json({ success: true, total: rows.length, orders: rows });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to fetch orders.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/orders/:orderId/status
// Steps 12-20: Staff progresses the order through its lifecycle
// ─────────────────────────────────────────────────────────────────────────────
export async function updateOrderStatus(req, res) {
  const { orderId } = req.params;
  const { status, reason } = req.body;
  const actor = req.user;

  if (!status) {
    return res.status(400).json({ success: false, error: 'status field is required.' });
  }

  const upperStatus = status.toUpperCase();

  try {
    // ── Load current order ─────────────────────────────────────────────────
    const { rows } = await pool.query(
      `SELECT order_id, order_status, customer_id, token_number, slot_id
       FROM orders WHERE order_id = $1`,
      [orderId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Order not found.' });
    }

    const order = rows[0];
    const currentStatus = order.order_status;

    // ── Customer can only cancel their own order ───────────────────────────
    if (actor.role === 'CUSTOMER') {
      if (order.customer_id !== actor.user_id) {
        return res.status(403).json({ success: false, error: 'Access denied.' });
      }
      if (upperStatus !== 'CANCELLED') {
        return res.status(403).json({ success: false, error: 'Customers can only cancel orders.' });
      }
      if (!['PLACED', 'ACCEPTED'].includes(currentStatus)) {
        return res.status(409).json({
          success: false,
          error: `Cannot cancel order in "${currentStatus}" status. Cancellation is only allowed before preparation begins.`,
        });
      }
    }

    // ── Validate transition ────────────────────────────────────────────────
    const allowed = ALLOWED_TRANSITIONS[currentStatus] || [];
    if (!allowed.includes(upperStatus)) {
      return res.status(409).json({
        success: false,
        error: `Invalid transition: ${currentStatus} → ${upperStatus}. Allowed: [${allowed.join(', ') || 'none'}]`,
      });
    }

    // ── Check role permission for this transition ──────────────────────────
    const allowedRoles = TRANSITION_ROLES[upperStatus] || [];
    if (!allowedRoles.includes(actor.role)) {
      return res.status(403).json({
        success: false,
        error: `Your role (${actor.role}) cannot perform this status transition.`,
      });
    }

    // ── Build update fields ────────────────────────────────────────────────
    const updates = ['order_status = $1', 'updated_at = NOW()'];
    const params = [upperStatus, orderId];
    let idx = 3;

    if (reason) {
      updates.push(`cancellation_reason = $${idx++}`);
      params.splice(idx - 2, 0, reason);
    }

    // When moving to PREPARING, recalculate EPT
    if (upperStatus === 'PREPARING') {
      const { rows: itemRows } = await pool.query(
        `SELECT mi.preparation_time, oi.quantity
         FROM order_items oi
         JOIN menu_items mi ON mi.item_id = oi.item_id
         WHERE oi.order_id = $1`,
        [orderId]
      );
      const { estimatedReadyAt } = await calculateEPT(itemRows);
      updates.push(`estimated_ready_time = $${idx++}`);
      params.splice(idx - 2, 0, estimatedReadyAt);
    }

    // When collecting, set collected_at
    if (upperStatus === 'COLLECTED') {
      updates.push(`collected_at = NOW()`, `is_collected = TRUE`);
    }

    // ── Apply update ───────────────────────────────────────────────────────
    const setClause = updates.join(', ');
    const { rows: updated } = await pool.query(
      `UPDATE orders SET ${setClause} WHERE order_id = $2 RETURNING *`,
      params
    );

    // ── Free up slot capacity if cancelled/rejected/not-collected ──────────
    if (['CANCELLED', 'REJECTED', 'NOT_COLLECTED'].includes(upperStatus) && order.slot_id) {
      await pool.query(
        `UPDATE pickup_slots
         SET current_orders = GREATEST(0, current_orders - 1),
             status = 'AVAILABLE'::slot_status
         WHERE slot_id = $1`,
        [order.slot_id]
      );
    }

    // ── Log staff action ───────────────────────────────────────────────────
    await pool.query(
      `INSERT INTO staff_activity_logs (staff_id, action, entity, entity_id, details)
       VALUES ($1, $2, 'orders', $3, $4)`,
      [
        actor.user_id,
        `STATUS_${currentStatus}_TO_${upperStatus}`,
        orderId,
        JSON.stringify({ token: order.token_number, reason }),
      ]
    );

    return res.json({
      success: true,
      message: `Order ${order.token_number} updated: ${currentStatus} → ${upperStatus}`,
      order: updated[0],
    });
  } catch (err) {
    console.error('updateOrderStatus error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to update order status.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/orders/:orderId/collect
// Steps 18-19: Staff scans/verifies token and confirms collection
// Uses atomic DB lock to prevent double-claiming
// ─────────────────────────────────────────────────────────────────────────────
export async function collectOrder(req, res) {
  try {
    const { orderId } = req.params;
    const result = await verifyAndClaimToken(orderId, req.user.user_id);

    if (!result.success) {
      return res.status(409).json({ success: false, error: result.error });
    }

    return res.json({
      success: true,
      message: `Token ${result.order.token_number} verified. Order collected successfully!`,
      order: result.order,
    });
  } catch (err) {
    console.error('collectOrder error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to process collection.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/orders/verify-token
// Step 18-19: Staff scans/verifies token NUMBER string (e.g. C-023) and confirms collection
// ─────────────────────────────────────────────────────────────────────────────
export async function verifyTokenString(req, res) {
  try {
    const { token_number } = req.body;
    if (!token_number) {
      return res.status(400).json({ success: false, error: 'token_number is required.' });
    }

    // Lookup order ID by token
    const { rows } = await pool.query(
      `SELECT order_id FROM orders WHERE token_number = $1`,
      [token_number.trim().toUpperCase()]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Invalid token number. Order not found.' });
    }

    // Claim token
    const orderId = rows[0].order_id;
    const result = await verifyAndClaimToken(orderId, req.user.user_id);

    if (!result.success) {
      return res.status(409).json({ success: false, error: result.error });
    }

    return res.json({
      success: true,
      message: `Token ${result.order.token_number} verified. Order collected successfully!`,
      order: result.order,
    });
  } catch (err) {
    console.error('verifyTokenString error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to process collection.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/orders/:orderId/complete
// Step 20: Finalize order after collection
// ─────────────────────────────────────────────────────────────────────────────
export async function completeOrder(req, res) {
  try {
    const { orderId } = req.params;

    const { rows } = await pool.query(
      `UPDATE orders
       SET order_status = 'COMPLETED', updated_at = NOW()
       WHERE order_id = $1 AND order_status = 'COLLECTED'
       RETURNING *`,
      [orderId]
    );

    if (rows.length === 0) {
      return res.status(409).json({
        success: false,
        error: 'Order must be in COLLECTED status to mark as COMPLETED.',
      });
    }

    return res.json({
      success: true,
      message: 'Order completed and logged.',
      order: rows[0],
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to complete order.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/orders/queue
// Steps 12-16: Staff/Manager — Live kitchen queue (priority sorted)
// ─────────────────────────────────────────────────────────────────────────────
export async function getKitchenQueue(req, res) {
  try {
    const { getLiveQueue } = await import('../services/queue.service.js');
    const result = await getLiveQueue();
    return res.json({
      success: true,
      total_active:    result.total_active,
      total_scheduled: result.total_scheduled,
      active:          result.active,
      scheduled:       result.scheduled,
    });
  } catch (err) {
    console.error('getKitchenQueue error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to load queue.' });
  }
}
