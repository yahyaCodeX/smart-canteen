// src/services/scheduler.service.js
// Background Queue Scheduler — Runs every 30 seconds
//
// Responsibilities:
//   1. AUTO-ACTIVATE:    Promote PLACED orders into the active queue when their
//                        activation window opens (pickup_time - ept - buffer)
//   2. AUTO-DELAY FLAG:  Mark PLACED/ACCEPTED orders as DELAYED when they exceed
//                        their wait threshold without progressing
//   3. AUTO-NOT-COLLECTED: Mark READY orders as NOT_COLLECTED if the pickup
//                           window has closed (>15 min past pickup_time)
//
// This is the "brain" that keeps the kitchen board accurate in real-time.

import pool from '../db/pool.js';
import { getActivationTime } from './queue.service.js';

const SCHEDULER_INTERVAL_MS = 30_000; // 30 seconds

// Minutes a PLACED order waits before auto-flagging delayed (no staff response)
const PLACED_DELAY_THRESHOLD_MIN   = 15;
// Minutes an ACCEPTED order waits before auto-flagging delayed (not started prep)
const ACCEPTED_DELAY_THRESHOLD_MIN = 8;
// Minutes past pickup_time before marking READY order as NOT_COLLECTED
const NOT_COLLECTED_WINDOW_MIN     = 20;

let schedulerHandle = null;

// ─────────────────────────────────────────────────────────────────────────────
// JOB 1: Auto-activate scheduled orders approaching their prep window
// ─────────────────────────────────────────────────────────────────────────────
async function autoActivateScheduledOrders() {
  // Find PLACED orders with a pickup_time where activation window has opened
  // but they haven't been accepted yet — notify kitchen (no status change needed,
  // the queue service will show them as ACTIVE when in window)
  //
  // This job primarily handles the case where an order was placed far in advance
  // and needs to be surfaced to staff exactly when prep should start.

  const { rows } = await pool.query(`
    SELECT
      o.order_id,
      o.token_number,
      o.pickup_time,
      o.estimated_ready_time,
      o.order_status,
      EXTRACT(EPOCH FROM (o.pickup_time - NOW())) / 60 AS mins_until_pickup,
      EXTRACT(EPOCH FROM (o.estimated_ready_time - NOW())) / 60 AS mins_until_ready
    FROM orders o
    WHERE o.order_status = 'PLACED'
      AND o.pickup_time IS NOT NULL
      AND o.pickup_time > NOW()
  `);

  const now = new Date();
  let activated = 0;

  for (const order of rows) {
    const eptMin = order.estimated_ready_time
      ? Math.max(1, Math.round(parseFloat(order.mins_until_ready) || 10))
      : 10;

    const activationTime = getActivationTime(order.pickup_time, eptMin);

    // If we're past the activation time and order is still just PLACED,
    // log it so staff can be alerted (status stays PLACED until staff accepts)
    if (now >= activationTime) {
      await pool.query(
        `INSERT INTO staff_activity_logs (staff_id, action, entity, entity_id, details)
         SELECT user_id, 'QUEUE_ACTIVATED', 'orders', $1, $2
         FROM users WHERE role = 'STAFF' LIMIT 1`,
        [
          order.order_id,
          JSON.stringify({
            token:         order.token_number,
            pickup_time:   order.pickup_time,
            activation_time: activationTime,
            note:          'Order entered active kitchen window — prep should begin',
          }),
        ]
      ).catch(() => {}); // Non-critical — ignore if no staff user exists

      activated++;
    }
  }

  if (activated > 0) {
    console.log(`[Scheduler] ⏰  ${activated} scheduled order(s) entered prep window`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// JOB 2: Auto-flag overdue orders as DELAYED
// ─────────────────────────────────────────────────────────────────────────────
async function autoFlagDelayedOrders() {
  // PLACED orders waiting > 15 min without acceptance
  const { rows: placedDelays } = await pool.query(`
    UPDATE orders
    SET order_status = 'DELAYED', updated_at = NOW()
    WHERE order_status = 'PLACED'
      AND EXTRACT(EPOCH FROM (NOW() - order_time)) / 60 > $1
    RETURNING order_id, token_number
  `, [PLACED_DELAY_THRESHOLD_MIN]);

  // ACCEPTED orders waiting > 8 min without moving to PREPARING
  const { rows: acceptedDelays } = await pool.query(`
    UPDATE orders
    SET order_status = 'DELAYED', updated_at = NOW()
    WHERE order_status = 'ACCEPTED'
      AND EXTRACT(EPOCH FROM (NOW() - updated_at)) / 60 > $1
    RETURNING order_id, token_number
  `, [ACCEPTED_DELAY_THRESHOLD_MIN]);

  const total = placedDelays.length + acceptedDelays.length;
  if (total > 0) {
    const tokens = [...placedDelays, ...acceptedDelays].map((r) => r.token_number);
    console.log(`[Scheduler] ⚠️  ${total} order(s) auto-flagged DELAYED: ${tokens.join(', ')}`);
  }

  return total;
}

// ─────────────────────────────────────────────────────────────────────────────
// JOB 3: Auto-mark uncollected READY orders as NOT_COLLECTED
// ─────────────────────────────────────────────────────────────────────────────
async function autoMarkNotCollected() {
  const { rows } = await pool.query(`
    UPDATE orders
    SET order_status = 'NOT_COLLECTED', updated_at = NOW()
    WHERE order_status = 'READY'
      AND is_collected = FALSE
      AND (
        -- Has a pickup_time: mark not-collected >20 min after pickup_time
        (pickup_time IS NOT NULL AND EXTRACT(EPOCH FROM (NOW() - pickup_time)) / 60 > $1)
        OR
        -- No pickup_time: mark not-collected >30 min after being marked READY
        (pickup_time IS NULL AND EXTRACT(EPOCH FROM (NOW() - updated_at)) / 60 > 30)
      )
    RETURNING order_id, token_number
  `, [NOT_COLLECTED_WINDOW_MIN]);

  if (rows.length > 0) {
    const tokens = rows.map((r) => r.token_number);
    console.log(`[Scheduler] 📦 ${rows.length} order(s) marked NOT_COLLECTED: ${tokens.join(', ')}`);
  }

  return rows.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULER RUNNER
// ─────────────────────────────────────────────────────────────────────────────
async function runSchedulerCycle() {
  try {
    await Promise.all([
      autoActivateScheduledOrders(),
      autoFlagDelayedOrders(),
      autoMarkNotCollected(),
    ]);
  } catch (err) {
    console.error('[Scheduler] ❌ Cycle error:', err.message);
  }
}

/**
 * startScheduler()
 * Call once at server startup. Runs every 30 seconds.
 */
export function startScheduler() {
  if (schedulerHandle) return; // Already running
  console.log('[Scheduler] 🟢 Background queue scheduler started (30s interval)');
  // Run once immediately on boot
  runSchedulerCycle();
  // Then on interval
  schedulerHandle = setInterval(runSchedulerCycle, SCHEDULER_INTERVAL_MS);
}

/**
 * stopScheduler()
 * Gracefully stop the scheduler (useful for tests).
 */
export function stopScheduler() {
  if (schedulerHandle) {
    clearInterval(schedulerHandle);
    schedulerHandle = null;
    console.log('[Scheduler] 🔴 Background queue scheduler stopped');
  }
}

export {
  autoFlagDelayedOrders,
  autoMarkNotCollected,
  autoActivateScheduledOrders,
};
