// src/services/queue.service.js
// Smart Live Digital Queue — Complete Priority & Scheduling Engine
//
// KEY CONCEPT: Two-phase queue model
//
//  Phase 1 — SCHEDULED queue:
//    Orders with a future pickup time that are NOT yet in the active prep window.
//    Kitchen doesn't see these yet. They wait until their "activation time".
//    Activation Time = pickup_time - ept_minutes - BUFFER_MINUTES (default 5 min)
//
//  Phase 2 — ACTIVE queue:
//    Orders that need immediate kitchen attention, sorted by priority score:
//    P = w1·T_wait + w2·T_pickup_urgency + w3·DelayFlag - w4·T_prep_duration
//
// This ensures food is ready CLOSE to pickup time, not an hour too early.

import pool from '../db/pool.js';

// ─── Configuration ────────────────────────────────────────────────────────────
const WEIGHTS = { w1: 0.4, w2: 0.4, w3: 0.3, w4: 0.2 };

/** Minutes before (pickup_time - ept) to activate a scheduled order */
const ACTIVATION_BUFFER_MINUTES = 5;

/** Minutes a PLACED/ACCEPTED order can wait before auto-flagging as DELAYED */
const DELAY_THRESHOLD_MINUTES = { PLACED: 15, ACCEPTED: 5, PREPARING: 0 };

// ─────────────────────────────────────────────────────────────────────────────
// PRIORITY SCORE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * calculatePriorityScore(order)
 *
 * P = w1·T_wait + w2·T_pickup_urgency + w3·DelayFlag - w4·T_prep_duration
 *
 * @param {object} order - { order_time, pickup_time, order_status, ept_minutes }
 * @returns {number} score — higher means more urgent, serve sooner
 */
export function calculatePriorityScore(order) {
  const now = Date.now();

  // w1: Wait time since placement (in minutes)
  const waitMinutes = (now - new Date(order.order_time).getTime()) / 60_000;

  // w2: Pickup urgency — grows as pickup deadline approaches
  //     Orders with no pickup_time are "walk-up" orders — treat as urgent (urgency=30)
  let pickupUrgency = 30; // default urgency for walk-up (non-scheduled) orders
  if (order.pickup_time) {
    const minutesUntilPickup = (new Date(order.pickup_time).getTime() - now) / 60_000;
    // Max urgency when ≤0 min until pickup, zero urgency at 60+ min out
    pickupUrgency = Math.max(0, 60 - minutesUntilPickup);
  }

  // w3: Delay penalty — already-delayed orders always jump to the top
  const delayFlag = order.order_status === 'DELAYED' ? 100 : 0;

  // w4: Prep efficiency — quicker orders get a slight boost (kitchen throughput)
  const prepPenalty = order.ept_minutes || 10;

  const score =
    WEIGHTS.w1 * waitMinutes +
    WEIGHTS.w2 * pickupUrgency +
    WEIGHTS.w3 * delayFlag -
    WEIGHTS.w4 * prepPenalty;

  return Math.round(score * 100) / 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTIVATION WINDOW LOGIC
// ─────────────────────────────────────────────────────────────────────────────

/**
 * getActivationTime(pickupTime, eptMinutes)
 *
 * The ideal time to START preparing so food is ready at pickup:
 *   activation = pickup_time - ept_minutes - BUFFER_MINUTES
 *
 * @param {Date|string} pickupTime
 * @param {number} eptMinutes
 * @returns {Date} when this order should enter the active kitchen queue
 */
export function getActivationTime(pickupTime, eptMinutes) {
  if (!pickupTime) return new Date(); // Walk-up orders activate immediately
  const pickup = new Date(pickupTime);
  return new Date(pickup.getTime() - (eptMinutes + ACTIVATION_BUFFER_MINUTES) * 60_000);
}

/**
 * isInActivationWindow(order)
 * Returns true if an order should now be visible in the active kitchen queue.
 */
export function isInActivationWindow(order) {
  if (!order.pickup_time) return true; // Walk-up: always active
  const activation = getActivationTime(order.pickup_time, order.ept_minutes || 10);
  return new Date() >= activation;
}

// ─────────────────────────────────────────────────────────────────────────────
// DELAY DETECTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * isDelayedOrder(order)
 * Returns true if this order has been in its current status longer than allowed.
 * PLACED   → delayed if waiting > 15 min without being accepted
 * ACCEPTED → delayed if waiting > 5 min without moving to PREPARING
 */
export function isDelayedOrder(order) {
  const threshold = DELAY_THRESHOLD_MINUTES[order.order_status];
  if (threshold === undefined || threshold === 0) return false;
  const waitMinutes = (Date.now() - new Date(order.order_time).getTime()) / 60_000;
  return waitMinutes > threshold;
}

// ─────────────────────────────────────────────────────────────────────────────
// LIVE ACTIVE QUEUE (Kitchen view — needs immediate attention)
// ─────────────────────────────────────────────────────────────────────────────

const ORDER_DETAIL_SQL = `
  SELECT
    o.order_id,
    o.token_number,
    o.order_status,
    o.order_time,
    o.pickup_time,
    o.estimated_ready_time,
    o.total_amount,
    o.is_collected,
    u.name      AS customer_name,
    u.email     AS customer_email,
    EXTRACT(EPOCH FROM (NOW() - o.order_time)) / 60                  AS wait_minutes,
    CASE
      WHEN o.estimated_ready_time IS NOT NULL
      THEN EXTRACT(EPOCH FROM (o.estimated_ready_time - NOW())) / 60
      ELSE NULL
    END AS minutes_until_ready,
    CASE
      WHEN o.pickup_time IS NOT NULL
      THEN EXTRACT(EPOCH FROM (o.pickup_time - NOW())) / 60
      ELSE NULL
    END AS minutes_until_pickup,
    json_agg(
      json_build_object(
        'item_name',           mi.item_name,
        'category',            mi.category,
        'quantity',            oi.quantity,
        'price',               oi.price,
        'special_instruction', oi.special_instruction,
        'preparation_time',    mi.preparation_time
      ) ORDER BY mi.preparation_time DESC
    ) AS items,
    SUM(oi.quantity)                                  AS total_items,
    MAX(mi.preparation_time)                          AS max_item_prep_time,
    SUM(mi.preparation_time * oi.quantity)            AS total_prep_time_raw
  FROM orders o
  JOIN users u        ON u.user_id   = o.customer_id
  JOIN order_items oi ON oi.order_id = o.order_id
  JOIN menu_items mi  ON mi.item_id  = oi.item_id
`;

/**
 * getLiveQueue()
 *
 * Returns the ACTIVE kitchen queue:
 *   - Orders that have entered their activation window
 *   - Sorted by priority score (highest first)
 *   - Enriched with delay flags, activation metadata, and urgency indicators
 */
export async function getLiveQueue() {
  const { rows } = await pool.query(`
    ${ORDER_DETAIL_SQL}
    WHERE o.order_status IN ('PLACED','ACCEPTED','PREPARING','READY','DELAYED')
    GROUP BY o.order_id, u.name, u.email
    ORDER BY o.order_time ASC
  `);

  const now = new Date();

  const enriched = rows.map((order) => {
    // Remaining EPT: how many minutes until estimated ready
    const eptMinutes = order.estimated_ready_time
      ? Math.max(0, Math.round((new Date(order.estimated_ready_time) - now) / 60_000))
      : (order.max_item_prep_time || 10);

    // Activation time for this order
    const activationTime = order.pickup_time
      ? getActivationTime(order.pickup_time, eptMinutes)
      : now;

    const inWindow = now >= activationTime;

    // Detect if the order SHOULD already be delayed
    const shouldBeDelayed = isDelayedOrder({ ...order, ept_minutes: eptMinutes });

    // Priority score
    const priorityScore = calculatePriorityScore({ ...order, ept_minutes: eptMinutes });

    // Urgency level for UI badges
    let urgencyLevel = 'NORMAL';
    if (order.order_status === 'DELAYED') urgencyLevel = 'CRITICAL';
    else if (shouldBeDelayed) urgencyLevel = 'HIGH';
    else if (order.minutes_until_pickup !== null && order.minutes_until_pickup <= 10) urgencyLevel = 'HIGH';
    else if (order.minutes_until_pickup !== null && order.minutes_until_pickup <= 20) urgencyLevel = 'MEDIUM';

    return {
      order_id:             order.order_id,
      token_number:         order.token_number,
      order_status:         order.order_status,
      customer_name:        order.customer_name,
      order_time:           order.order_time,
      pickup_time:          order.pickup_time,
      estimated_ready_time: order.estimated_ready_time,
      total_amount:         order.total_amount,
      total_items:          parseInt(order.total_items, 10),
      items:                order.items,
      wait_minutes:         Math.round(parseFloat(order.wait_minutes) * 10) / 10,
      minutes_until_ready:  order.minutes_until_ready !== null
                              ? Math.round(parseFloat(order.minutes_until_ready) * 10) / 10
                              : null,
      minutes_until_pickup: order.minutes_until_pickup !== null
                              ? Math.round(parseFloat(order.minutes_until_pickup) * 10) / 10
                              : null,
      ept_minutes:          eptMinutes,
      activation_time:      activationTime,
      in_activation_window: inWindow,
      priority_score:       priorityScore,
      urgency_level:        urgencyLevel,
      should_be_delayed:    shouldBeDelayed,
      queue_type:           inWindow ? 'ACTIVE' : 'SCHEDULED',
    };
  });

  // Split into ACTIVE (in window) and SCHEDULED (future)
  const active    = enriched.filter((o) => o.in_activation_window);
  const scheduled = enriched.filter((o) => !o.in_activation_window);

  // Sort active by priority (highest first), scheduled by activation_time (soonest first)
  active.sort((a, b) => b.priority_score - a.priority_score);
  scheduled.sort((a, b) => new Date(a.activation_time) - new Date(b.activation_time));

  return { active, scheduled, total_active: active.length, total_scheduled: scheduled.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// QUEUE STATS (Manager Dashboard telemetry)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * getQueueStats()
 * Returns aggregated metrics for the manager dashboard.
 */
export async function getQueueStats() {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE order_status = 'PLACED')     AS placed_count,
      COUNT(*) FILTER (WHERE order_status = 'ACCEPTED')   AS accepted_count,
      COUNT(*) FILTER (WHERE order_status = 'PREPARING')  AS preparing_count,
      COUNT(*) FILTER (WHERE order_status = 'READY')      AS ready_count,
      COUNT(*) FILTER (WHERE order_status = 'DELAYED')    AS delayed_count,
      COUNT(*) FILTER (WHERE order_status = 'COMPLETED'
                         AND order_time::date = CURRENT_DATE)  AS completed_today,
      COUNT(*) FILTER (WHERE order_status = 'CANCELLED'
                         AND order_time::date = CURRENT_DATE)  AS cancelled_today,
      COUNT(*) FILTER (WHERE order_status IN ('PLACED','ACCEPTED','PREPARING','READY','DELAYED')) AS total_active,
      ROUND(AVG(
        EXTRACT(EPOCH FROM (estimated_ready_time - order_time)) / 60
      ) FILTER (WHERE order_status IN ('PREPARING','READY','COMPLETED')), 1) AS avg_ept_minutes,
      ROUND(AVG(
        EXTRACT(EPOCH FROM (collected_at - order_time)) / 60
      ) FILTER (WHERE is_collected = TRUE AND order_time::date = CURRENT_DATE), 1) AS avg_fulfillment_minutes
    FROM orders
    WHERE order_time::date = CURRENT_DATE
  `);

  const stats = rows[0];

  // Calculate throughput: orders completed per hour today
  const { rows: hourlyRows } = await pool.query(`
    SELECT
      DATE_TRUNC('hour', order_time) AS hour,
      COUNT(*) AS order_count
    FROM orders
    WHERE order_time::date = CURRENT_DATE
      AND order_status NOT IN ('CANCELLED', 'REJECTED')
    GROUP BY 1
    ORDER BY 1
  `);

  return { ...stats, hourly_breakdown: hourlyRows };
}
