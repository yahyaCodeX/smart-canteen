// src/services/intelligence.service.js
// Smart Canteen Intelligence Engine
//
// Detects and classifies anomalous kitchen conditions in real-time:
//
//  Alert Types:
//  ┌─────────────────────────┬─────────────────────────────────────────────────┐
//  │ ALERT TYPE              │ TRIGGER CONDITION                               │
//  ├─────────────────────────┼─────────────────────────────────────────────────┤
//  │ APPROACHING_PICKUP      │ PREPARING but estimated_ready_time > pickup_time│
//  │ UNUSUALLY_LONG_PREP     │ PREPARING for > 2× original EPT                 │
//  │ AT_RISK_DELAY           │ PLACED/ACCEPTED, queue depth predicts delay      │
//  │ OVERDUE_COLLECTION      │ READY for > 10 min, not collected               │
//  │ KITCHEN_OVERLOAD        │ Active orders ≥ overload threshold              │
//  │ STOCK_DEPLETION_WARNING │ Menu item quantity ≤ 5 (LOW stock)              │
//  │ PEAK_DEMAND_APPROACHING │ Slot fill rate ≥ 80% in next 30 min            │
//  └─────────────────────────┴─────────────────────────────────────────────────┘
//
//  Severity levels: CRITICAL > HIGH > MEDIUM > INFO

import pool from '../db/pool.js';

// ─── Thresholds (tunable) ─────────────────────────────────────────────────────
const THRESHOLDS = {
  APPROACHING_PICKUP_BUFFER_MIN:  5,   // Alert if food won't be ready ≥5 min before pickup
  UNUSUALLY_LONG_PREP_MULTIPLIER: 1.8, // Alert if actual prep > 1.8× original EPT
  AT_RISK_QUEUE_DEPTH:            6,   // Alert when ≥6 orders active (increased wait risk)
  OVERDUE_COLLECTION_MIN:         10,  // Alert if READY order uncollected for ≥10 min
  KITCHEN_OVERLOAD_THRESHOLD:     10,  // Alert when ≥10 orders simultaneously PREPARING
  LOW_STOCK_THRESHOLD:            5,   // Alert when available_quantity ≤ 5
  PEAK_SLOT_FILL_PERCENT:         80,  // Alert when a near-future slot is ≥80% full
};

// ─────────────────────────────────────────────────────────────────────────────
// INDIVIDUAL ALERT DETECTORS
// ─────────────────────────────────────────────────────────────────────────────

/** Alert 1: Orders that won't be ready before their pickup time */
async function detectApproachingPickup() {
  const { rows } = await pool.query(`
    SELECT
      o.order_id, o.token_number, o.order_status,
      o.pickup_time, o.estimated_ready_time, o.order_time,
      u.name AS customer_name,
      EXTRACT(EPOCH FROM (o.estimated_ready_time - o.pickup_time)) / 60 AS overrun_minutes,
      EXTRACT(EPOCH FROM (o.pickup_time - NOW())) / 60 AS mins_until_pickup
    FROM orders o
    JOIN users u ON u.user_id = o.customer_id
    WHERE o.order_status IN ('PREPARING', 'ACCEPTED', 'PLACED')
      AND o.pickup_time IS NOT NULL
      AND o.estimated_ready_time IS NOT NULL
      AND o.estimated_ready_time > (o.pickup_time - ($1 * INTERVAL '1 minute'))
    ORDER BY o.pickup_time ASC
  `, [THRESHOLDS.APPROACHING_PICKUP_BUFFER_MIN]);

  return rows.map((r) => ({
    type:        'APPROACHING_PICKUP',
    severity:    parseFloat(r.overrun_minutes) > 0 ? 'CRITICAL' : 'HIGH',
    order_id:    r.order_id,
    token:       r.token_number,
    title:       `⏰ Pickup Risk: ${r.token_number}`,
    message:     parseFloat(r.overrun_minutes) > 0
      ? `Food estimated ready ${Math.abs(Math.round(r.overrun_minutes))} min AFTER pickup time (${new Date(r.pickup_time).toLocaleTimeString()}). Start immediately!`
      : `Food will be ready only ${THRESHOLDS.APPROACHING_PICKUP_BUFFER_MIN} min before pickup. Kitchen should prioritize.`,
    pickup_time:          r.pickup_time,
    estimated_ready_time: r.estimated_ready_time,
    mins_until_pickup:    Math.round(parseFloat(r.mins_until_pickup)),
    customer_name:        r.customer_name,
    action:               'PRIORITIZE_ORDER',
  }));
}

/** Alert 2: Orders in PREPARING for far longer than their EPT */
async function detectUnusuallyLongPrep() {
  const { rows } = await pool.query(`
    SELECT
      o.order_id, o.token_number, o.order_status,
      o.order_time, o.estimated_ready_time,
      o.pickup_time,
      u.name AS customer_name,
      EXTRACT(EPOCH FROM (NOW() - o.updated_at)) / 60 AS mins_in_preparing,
      EXTRACT(EPOCH FROM (o.estimated_ready_time - o.order_time)) / 60 AS original_ept_minutes
    FROM orders o
    JOIN users u ON u.user_id = o.customer_id
    WHERE o.order_status = 'PREPARING'
      AND o.estimated_ready_time IS NOT NULL
      AND NOW() > o.estimated_ready_time + (
        EXTRACT(EPOCH FROM (o.estimated_ready_time - o.order_time)) * ($1 - 1) * INTERVAL '1 second'
      )
    ORDER BY o.order_time ASC
  `, [THRESHOLDS.UNUSUALLY_LONG_PREP_MULTIPLIER]);

  return rows.map((r) => ({
    type:     'UNUSUALLY_LONG_PREP',
    severity: 'HIGH',
    order_id: r.order_id,
    token:    r.token_number,
    title:    `🔥 Long Prep: ${r.token_number}`,
    message:  `Order ${r.token_number} has been preparing for ${Math.round(parseFloat(r.mins_in_preparing))} min — exceeds expected ${Math.round(parseFloat(r.original_ept_minutes))} min EPT by ${Math.round(parseFloat(r.original_ept_minutes) * (THRESHOLDS.UNUSUALLY_LONG_PREP_MULTIPLIER - 1))}+ min. Investigate kitchen issue.`,
    mins_in_preparing:   Math.round(parseFloat(r.mins_in_preparing)),
    original_ept_minutes: Math.round(parseFloat(r.original_ept_minutes)),
    customer_name:       r.customer_name,
    action:              'CHECK_KITCHEN_STATION',
  }));
}

/** Alert 3: Orders at risk of delay based on current queue depth */
async function detectAtRiskOrders() {
  // Count active orders in kitchen
  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*) AS cnt FROM orders WHERE order_status IN ('ACCEPTED', 'PREPARING')`
  );
  const activeCount = parseInt(countRows[0].cnt, 10);

  if (activeCount < THRESHOLDS.AT_RISK_QUEUE_DEPTH) return [];

  // Find PLACED orders not yet accepted — they face a deep queue
  const { rows } = await pool.query(`
    SELECT
      o.order_id, o.token_number, o.order_status, o.order_time,
      o.pickup_time, o.estimated_ready_time,
      u.name AS customer_name,
      EXTRACT(EPOCH FROM (NOW() - o.order_time)) / 60 AS wait_minutes
    FROM orders o
    JOIN users u ON u.user_id = o.customer_id
    WHERE o.order_status = 'PLACED'
      AND EXTRACT(EPOCH FROM (NOW() - o.order_time)) / 60 > 5
    ORDER BY o.order_time ASC
    LIMIT 10
  `);

  return rows.map((r) => ({
    type:         'AT_RISK_DELAY',
    severity:     'MEDIUM',
    order_id:     r.order_id,
    token:        r.token_number,
    title:        `📋 Delay Risk: ${r.token_number}`,
    message:      `Kitchen has ${activeCount} active orders. ${r.token_number} has been PLACED for ${Math.round(parseFloat(r.wait_minutes))} min and may face delays. Queue depth is ${activeCount}/${THRESHOLDS.AT_RISK_QUEUE_DEPTH} threshold.`,
    active_orders_in_kitchen: activeCount,
    wait_minutes: Math.round(parseFloat(r.wait_minutes)),
    customer_name: r.customer_name,
    action:       'ACCEPT_ORDER_SOON',
  }));
}

/** Alert 4: READY orders not collected after threshold */
async function detectOverdueCollections() {
  const { rows } = await pool.query(`
    SELECT
      o.order_id, o.token_number, o.pickup_time, o.updated_at,
      u.name AS customer_name, u.email AS customer_email,
      EXTRACT(EPOCH FROM (NOW() - o.updated_at)) / 60 AS mins_since_ready
    FROM orders o
    JOIN users u ON u.user_id = o.customer_id
    WHERE o.order_status = 'READY'
      AND o.is_collected = FALSE
      AND EXTRACT(EPOCH FROM (NOW() - o.updated_at)) / 60 >= $1
    ORDER BY o.updated_at ASC
  `, [THRESHOLDS.OVERDUE_COLLECTION_MIN]);

  return rows.map((r) => ({
    type:            'OVERDUE_COLLECTION',
    severity:        parseFloat(r.mins_since_ready) > 20 ? 'HIGH' : 'MEDIUM',
    order_id:        r.order_id,
    token:           r.token_number,
    title:           `📦 Uncollected: ${r.token_number}`,
    message:         `Token ${r.token_number} has been READY for ${Math.round(parseFloat(r.mins_since_ready))} min. Food quality may be affected. Contact customer or mark NOT_COLLECTED.`,
    mins_since_ready: Math.round(parseFloat(r.mins_since_ready)),
    customer_name:   r.customer_name,
    customer_email:  r.customer_email,
    action:          'NOTIFY_CUSTOMER_OR_MARK_UNCOLLECTED',
  }));
}

/** Alert 5: Kitchen overload — too many simultaneous orders */
async function detectKitchenOverload() {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE order_status = 'PREPARING') AS preparing,
      COUNT(*) FILTER (WHERE order_status = 'ACCEPTED')  AS accepted,
      COUNT(*) FILTER (WHERE order_status IN ('PREPARING','ACCEPTED','PLACED')) AS total_active
    FROM orders
  `);

  const { preparing, total_active } = rows[0];
  const preparingCount = parseInt(preparing, 10);

  if (preparingCount < THRESHOLDS.KITCHEN_OVERLOAD_THRESHOLD) return [];

  return [{
    type:            'KITCHEN_OVERLOAD',
    severity:        preparingCount >= THRESHOLDS.KITCHEN_OVERLOAD_THRESHOLD * 1.5 ? 'CRITICAL' : 'HIGH',
    title:           `🚨 Kitchen Overload`,
    message:         `${preparingCount} orders simultaneously in PREPARING state (threshold: ${THRESHOLDS.KITCHEN_OVERLOAD_THRESHOLD}). All EPT estimates are inflated by ${Math.min(200, Math.round((1 + 0.15 * preparingCount) * 100) - 100)}%. Consider rejecting new orders or calling extra staff.`,
    preparing_count: preparingCount,
    total_active:    parseInt(total_active, 10),
    overload_factor: Math.min(2.0, 1 + 0.15 * preparingCount).toFixed(2),
    action:          'MANAGE_KITCHEN_CAPACITY',
  }];
}

/** Alert 6: Low stock warnings for popular menu items */
async function detectLowStockItems() {
  const { rows } = await pool.query(`
    SELECT item_id, item_name, category, available_quantity, status
    FROM menu_items
    WHERE available_quantity <= $1
      AND status NOT IN ('SOLD_OUT', 'TEMPORARILY_UNAVAILABLE')
    ORDER BY available_quantity ASC
    LIMIT 10
  `, [THRESHOLDS.LOW_STOCK_THRESHOLD]);

  return rows.map((r) => ({
    type:               'STOCK_DEPLETION_WARNING',
    severity:           r.available_quantity <= 2 ? 'HIGH' : 'MEDIUM',
    item_id:            r.item_id,
    title:              `📉 Low Stock: ${r.item_name}`,
    message:            `"${r.item_name}" (${r.category}) has only ${r.available_quantity} unit(s) left. Will auto-mark SOLD_OUT when depleted.`,
    item_name:          r.item_name,
    category:           r.category,
    available_quantity: r.available_quantity,
    action:             'RESTOCK_OR_DISABLE_ITEM',
  }));
}

/** Alert 7: Upcoming pickup slots near full capacity */
async function detectPeakDemand() {
  const { rows } = await pool.query(`
    SELECT
      slot_id, slot_time, max_orders, current_orders,
      ROUND(current_orders::numeric / max_orders * 100, 1) AS fill_percent,
      EXTRACT(EPOCH FROM (slot_time - NOW())) / 60 AS mins_until_slot
    FROM pickup_slots
    WHERE slot_time BETWEEN NOW() AND NOW() + INTERVAL '45 minutes'
      AND status != 'FULL'
      AND max_orders > 0
      AND (current_orders::numeric / max_orders) >= ($1::numeric / 100)
    ORDER BY slot_time ASC
  `, [THRESHOLDS.PEAK_SLOT_FILL_PERCENT]);

  return rows.map((r) => ({
    type:              'PEAK_DEMAND_APPROACHING',
    severity:          parseFloat(r.fill_percent) >= 95 ? 'HIGH' : 'MEDIUM',
    slot_id:           r.slot_id,
    title:             `📈 Peak Demand: ${new Date(r.slot_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} slot`,
    message:           `Pickup slot at ${new Date(r.slot_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} is ${r.fill_percent}% full (${r.current_orders}/${r.max_orders} orders) and arriving in ${Math.round(parseFloat(r.mins_until_slot))} min. Ensure kitchen is ready.`,
    slot_time:         r.slot_time,
    fill_percent:      parseFloat(r.fill_percent),
    current_orders:    r.current_orders,
    max_orders:        r.max_orders,
    mins_until_slot:   Math.round(parseFloat(r.mins_until_slot)),
    action:            'PREPARE_KITCHEN_FOR_RUSH',
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// MASTER ALERT AGGREGATOR
// ─────────────────────────────────────────────────────────────────────────────

const SEVERITY_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, INFO: 3 };

/**
 * getAllAlerts()
 * Runs all 7 detectors in parallel and returns a unified sorted alert list.
 * @returns {Promise<{ alerts, summary, generated_at }>}
 */
export async function getAllAlerts() {
  const [
    approachingPickup,
    unusuallyLongPrep,
    atRiskOrders,
    overdueCollections,
    kitchenOverload,
    lowStockItems,
    peakDemand,
  ] = await Promise.all([
    detectApproachingPickup(),
    detectUnusuallyLongPrep(),
    detectAtRiskOrders(),
    detectOverdueCollections(),
    detectKitchenOverload(),
    detectLowStockItems(),
    detectPeakDemand(),
  ]);

  const allAlerts = [
    ...kitchenOverload,     // Overload first
    ...approachingPickup,
    ...unusuallyLongPrep,
    ...atRiskOrders,
    ...overdueCollections,
    ...peakDemand,
    ...lowStockItems,
  ].map((alert, idx) => ({ ...alert, alert_id: `ALT-${idx + 1}` }));

  // Sort by severity
  allAlerts.sort((a, b) =>
    (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99)
  );

  const summary = {
    total:    allAlerts.length,
    critical: allAlerts.filter((a) => a.severity === 'CRITICAL').length,
    high:     allAlerts.filter((a) => a.severity === 'HIGH').length,
    medium:   allAlerts.filter((a) => a.severity === 'MEDIUM').length,
    info:     allAlerts.filter((a) => a.severity === 'INFO').length,
  };

  return { alerts: allAlerts, summary, generated_at: new Date().toISOString() };
}

// ─────────────────────────────────────────────────────────────────────────────
// EPT DETAIL BREAKDOWN (for a specific order)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * getOrderEPTDetail(orderId)
 * Returns a full EPT breakdown with explanations for a specific order.
 */
export async function getOrderEPTDetail(orderId) {
  const { computeBaseEPT, CATEGORY_MULTIPLIERS } = await import('./ept.service.js');

  const { rows } = await pool.query(`
    SELECT
      o.order_id, o.token_number, o.order_status,
      o.order_time, o.estimated_ready_time, o.pickup_time,
      json_agg(json_build_object(
        'item_name',        mi.item_name,
        'category',         mi.category,
        'preparation_time', mi.preparation_time,
        'quantity',         oi.quantity
      ) ORDER BY mi.preparation_time DESC) AS items
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.order_id
    JOIN menu_items mi  ON mi.item_id  = oi.item_id
    WHERE o.order_id = $1
    GROUP BY o.order_id
  `, [orderId]);

  if (rows.length === 0) return null;

  const order = rows[0];

  const { rows: ctx } = await pool.query(
    `SELECT COUNT(*) AS preparing FROM orders WHERE order_status = 'PREPARING'`
  );
  const activePreparing = parseInt(ctx[0].preparing, 10);

  const { eptMinutes, breakdown } = computeBaseEPT(order.items, activePreparing);

  const minutesRemaining = order.estimated_ready_time
    ? Math.max(0, Math.round((new Date(order.estimated_ready_time) - Date.now()) / 60_000))
    : eptMinutes;

  const itemDetail = order.items.map((item) => {
    const mult = CATEGORY_MULTIPLIERS[item.category] ?? 1.0;
    return {
      item_name:           item.item_name,
      category:            item.category,
      base_prep_time:      item.preparation_time,
      quantity:            item.quantity,
      category_multiplier: mult,
      adjusted_time:       Math.round(item.preparation_time * mult * 10) / 10,
    };
  });

  return {
    order_id:            order.order_id,
    token_number:        order.token_number,
    order_status:        order.order_status,
    current_ept_minutes: eptMinutes,
    minutes_remaining:   minutesRemaining,
    estimated_ready_at:  order.estimated_ready_time,
    pickup_time:         order.pickup_time,
    kitchen_context: {
      active_orders_preparing: activePreparing,
      workload_note: activePreparing >= 6
        ? `Kitchen is busy (${activePreparing} active orders). Your wait is extended.`
        : `Kitchen is ${activePreparing < 3 ? 'lightly loaded' : 'moderately busy'}.`,
    },
    breakdown,
    item_detail: itemDetail,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// DEMAND FORECAST (daily trend analysis)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * getDemandForecast()
 * Analyses order patterns to predict:
 * - Peak ordering windows
 * - Most popular items
 * - Average wait times by hour
 */
export async function getDemandForecast() {
  const [hourlyRows, popularRows, avgWaitRows] = await Promise.all([
    pool.query(`
      SELECT
        DATE_TRUNC('hour', order_time) AS hour,
        COUNT(*)                        AS order_count,
        ROUND(AVG(total_amount), 2)     AS avg_order_value
      FROM orders
      WHERE order_time > NOW() - INTERVAL '7 days'
        AND order_status NOT IN ('CANCELLED', 'REJECTED')
      GROUP BY 1
      ORDER BY order_count DESC
      LIMIT 24
    `),
    pool.query(`
      SELECT
        mi.item_name, mi.category, mi.price,
        SUM(oi.quantity)               AS total_ordered,
        COUNT(DISTINCT oi.order_id)    AS order_appearances
      FROM order_items oi
      JOIN menu_items mi ON mi.item_id = oi.item_id
      JOIN orders o      ON o.order_id  = oi.order_id
      WHERE o.order_time > NOW() - INTERVAL '7 days'
        AND o.order_status NOT IN ('CANCELLED', 'REJECTED')
      GROUP BY mi.item_id, mi.item_name, mi.category, mi.price
      ORDER BY total_ordered DESC
      LIMIT 10
    `),
    pool.query(`
      SELECT
        EXTRACT(HOUR FROM order_time) AS hour_of_day,
        ROUND(AVG(
          EXTRACT(EPOCH FROM (estimated_ready_time - order_time)) / 60
        ), 1) AS avg_ept_minutes,
        COUNT(*) AS sample_count
      FROM orders
      WHERE order_time > NOW() - INTERVAL '7 days'
        AND estimated_ready_time IS NOT NULL
        AND order_status IN ('COMPLETED', 'COLLECTED')
      GROUP BY 1
      ORDER BY 1
    `),
  ]);

  const peakHours = hourlyRows.rows
    .sort((a, b) => b.order_count - a.order_count)
    .slice(0, 3)
    .map((r) => ({
      hour:        new Date(r.hour).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      order_count: parseInt(r.order_count, 10),
      avg_value:   parseFloat(r.avg_order_value),
    }));

  return {
    peak_hours:       peakHours,
    popular_items:    popularRows.rows,
    avg_wait_by_hour: avgWaitRows.rows,
    generated_at:     new Date().toISOString(),
  };
}
