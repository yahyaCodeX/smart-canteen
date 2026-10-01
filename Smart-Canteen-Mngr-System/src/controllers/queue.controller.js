// src/controllers/queue.controller.js
// Kitchen Queue API — Staff & Manager facing endpoints
//
// Endpoint map:
//   GET  /api/queue              — Full queue (active + scheduled) with priority scores
//   GET  /api/queue/active       — Active queue only (needs kitchen attention NOW)
//   GET  /api/queue/scheduled    — Upcoming orders waiting for their prep window
//   GET  /api/queue/stats        — Manager metrics (counts, averages, hourly breakdown)
//   POST /api/queue/flag-delays  — Manually trigger delay detection
//   GET  /api/queue/token/:token — Lookup order by token number (counter scanner)

import pool from '../db/pool.js';
import { getLiveQueue, getQueueStats } from '../services/queue.service.js';
import { autoFlagDelayedOrders, autoMarkNotCollected } from '../services/scheduler.service.js';

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/queue
// Full kitchen queue view: active (priority-sorted) + scheduled (time-sorted)
// ─────────────────────────────────────────────────────────────────────────────
export async function getFullQueue(req, res) {
  try {
    const queue = await getLiveQueue();

    return res.json({
      success: true,
      ...queue,
      server_time: new Date().toISOString(),
    });
  } catch (err) {
    console.error('getFullQueue error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to load queue.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/queue/active
// Only orders that need immediate kitchen attention (in their prep window)
// ─────────────────────────────────────────────────────────────────────────────
export async function getActiveQueue(req, res) {
  try {
    const { active, total_active } = await getLiveQueue();
    return res.json({
      success: true,
      total: total_active,
      queue: active,
      server_time: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to load active queue.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/queue/scheduled
// Orders with future pickup times not yet in the prep window
// Kitchen sees these as "upcoming" — no action needed yet
// ─────────────────────────────────────────────────────────────────────────────
export async function getScheduledQueue(req, res) {
  try {
    const { scheduled, total_scheduled } = await getLiveQueue();
    return res.json({
      success: true,
      total: total_scheduled,
      queue: scheduled,
      server_time: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to load scheduled queue.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/queue/stats
// Manager dashboard metrics
// ─────────────────────────────────────────────────────────────────────────────
export async function getQueueMetrics(req, res) {
  try {
    const stats = await getQueueStats();
    return res.json({ success: true, stats, server_time: new Date().toISOString() });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to load queue stats.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/queue/flag-delays
// Manually trigger delay detection (Manager can press a button to force a check)
// ─────────────────────────────────────────────────────────────────────────────
export async function triggerDelayCheck(req, res) {
  try {
    const [delayed, notCollected] = await Promise.all([
      autoFlagDelayedOrders(),
      autoMarkNotCollected(),
    ]);
    return res.json({
      success: true,
      message: `Delay check complete. ${delayed} order(s) flagged DELAYED, ${notCollected} marked NOT_COLLECTED.`,
      delayed_count:       delayed,
      not_collected_count: notCollected,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Delay check failed.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/queue/token/:tokenNumber
// Counter scanner: look up any order by its token (e.g. C-023)
// Returns full order detail + current status for staff to verify
// ─────────────────────────────────────────────────────────────────────────────
export async function lookupByToken(req, res) {
  try {
    const { tokenNumber } = req.params;

    const { rows } = await pool.query(`
      SELECT
        o.order_id,
        o.token_number,
        o.order_status,
        o.order_time,
        o.pickup_time,
        o.estimated_ready_time,
        o.collected_at,
        o.is_collected,
        o.total_amount,
        o.payment_status,
        u.name  AS customer_name,
        u.email AS customer_email,
        json_agg(
          json_build_object(
            'item_name',           mi.item_name,
            'quantity',            oi.quantity,
            'price',               oi.price,
            'special_instruction', oi.special_instruction
          ) ORDER BY mi.item_name
        ) AS items,
        EXTRACT(EPOCH FROM (NOW() - o.order_time)) / 60 AS wait_minutes
      FROM orders o
      JOIN users u        ON u.user_id   = o.customer_id
      JOIN order_items oi ON oi.order_id = o.order_id
      JOIN menu_items mi  ON mi.item_id  = oi.item_id
      WHERE UPPER(o.token_number) = UPPER($1)
      GROUP BY o.order_id, u.name, u.email
    `, [tokenNumber.trim()]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: `Token "${tokenNumber}" not found. Please check and try again.`,
      });
    }

    const order = rows[0];

    // Collection guard info
    const canCollect = order.order_status === 'READY' && !order.is_collected;

    return res.json({
      success: true,
      order,
      can_collect: canCollect,
      collection_blocked_reason: !canCollect
        ? (order.is_collected
            ? `Already collected at ${order.collected_at}`
            : `Order status is "${order.order_status}" — must be READY to collect`)
        : null,
    });
  } catch (err) {
    console.error('lookupByToken error:', err.message);
    return res.status(500).json({ success: false, error: 'Token lookup failed.' });
  }
}
