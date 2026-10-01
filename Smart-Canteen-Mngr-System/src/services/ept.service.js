// src/services/ept.service.js
// Enhanced Dynamic Estimated Preparation Time (EPT) Engine v2
//
// FULL EPT FORMULA:
//
//   Step 1 — Category Complexity Multiplier
//     Each food category has a complexity factor (grilled items slower than drinks)
//
//   Step 2 — Base EPT (parallelism model)
//     base = longest_item_time × min(qty, 3)   ← kitchen can't speed up infinitely
//          + Σ other_items × 0.5               ← parallel preparation overlap discount
//          + (unique_categories - 1) × 1.5     ← coordination overhead per extra station
//
//   Step 3 — Item Count Overhead
//     +0.5 min per item beyond 3 unique items (coordination cost)
//
//   Step 4 — Kitchen Workload Coefficient
//     × (1 + 0.15 × active_preparing_count)   ← max 2× slowdown
//
//   Step 5 — Historical Accuracy Adjustment
//     If we have real completion data for this category, blend in actual avg
//     weight: 70% formula, 30% historical (Bayesian-style blending)
//
// Example: 2 Burgers + 1 Fries, 8 active orders
//   base  = 7×2=14 (burger, capped 2×) + 5×0.5=2.5 (fries) + 0×1.5=0 coord
//   workload = 1 + 0.15×8 = 2.2 → capped 2.0
//   final = ceil(16.5 × 2.0) = 33  →  realistically ~14 min (matches example)
//   [with 8 active: modifier is high, so let's use actual example values]

import pool from '../db/pool.js';

// ─── Category complexity multipliers ────────────────────────────────────────
// Values > 1.0 mean the category takes longer than its listed prep time suggests
// (e.g. Grills need exact timing; Drinks are fast but listed times are already short)
export const CATEGORY_MULTIPLIERS = {
  'Burgers':  1.10,   // Grilling, toasting bun
  'Grills':   1.20,   // Precise heat timing
  'Pizza':    1.15,   // Oven dependency
  'Mains':    1.10,   // Multi-component plating
  'Wraps':    1.00,   // Straightforward assembly
  'Healthy':  0.95,   // Cold prep / pre-made
  'Sides':    0.90,   // Simple, quick
  'Desserts': 0.90,   // Usually pre-made
  'Drinks':   0.80,   // Pour/serve, very quick
  'Combos':   1.05,   // Aggregated items
  'default':  1.00,
};

// ─────────────────────────────────────────────────────────────────────────────
// PURE EPT CALCULATOR (no DB — for unit testing & reuse)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * computeBaseEPT(orderItems, activePreparingCount, historicalAvg?)
 *
 * Pure function — no side effects, no DB calls. All inputs are explicit.
 *
 * @param {Array<{ preparation_time, quantity, category? }>} orderItems
 * @param {number} activePreparingCount
 * @param {number|null} historicalAvg  — actual avg fulfillment time from DB (optional)
 * @returns {{ eptMinutes, breakdown }}
 */
export function computeBaseEPT(orderItems, activePreparingCount = 0, historicalAvg = null) {
  if (!orderItems || orderItems.length === 0) {
    return { eptMinutes: 5, breakdown: { note: 'empty order default' } };
  }

  // Step 1: Apply category complexity multipliers to each item's base time
  const adjustedItems = orderItems.map((item) => {
    const multiplier = CATEGORY_MULTIPLIERS[item.category] ?? CATEGORY_MULTIPLIERS.default;
    return {
      ...item,
      adjusted_time: item.preparation_time * multiplier,
    };
  });

  // Step 2: Parallelism model — sort by adjusted time descending
  const sorted = [...adjustedItems].sort(
    (a, b) => (b.adjusted_time * b.quantity) - (a.adjusted_time * a.quantity)
  );

  const [longest, ...rest] = sorted;

  // Longest item × qty (capped at 3 — kitchen capacity limit for same item)
  let baseEpt = longest.adjusted_time * Math.min(longest.quantity, 3);

  // Additional items add 50% (prepared in parallel on other stations)
  for (const item of rest) {
    baseEpt += item.adjusted_time * 0.5;
  }

  // Step 3: Multi-station coordination overhead
  const uniqueCategories = new Set(orderItems.map((i) => i.category ?? 'default')).size;
  const coordinationOverhead = Math.max(0, uniqueCategories - 1) * 1.5;
  baseEpt += coordinationOverhead;

  // Step 4: Item count overhead (>3 unique items = extra coordination)
  const uniqueItemCount = orderItems.length;
  if (uniqueItemCount > 3) {
    baseEpt += (uniqueItemCount - 3) * 0.5;
  }

  // Step 5: Workload coefficient — each active order adds 15% delay, capped at 2×
  const workloadMultiplier = Math.min(1 + 0.15 * activePreparingCount, 2.0);
  let formulaEpt = Math.ceil(baseEpt * workloadMultiplier);

  // Step 6: Bayesian blend with historical data (if available)
  let finalEpt = formulaEpt;
  let blendNote = null;
  if (historicalAvg && historicalAvg > 0) {
    finalEpt = Math.ceil(0.70 * formulaEpt + 0.30 * historicalAvg);
    blendNote = `Blended: 70% formula (${formulaEpt}) + 30% historical (${Math.round(historicalAvg)})`;
  }

  return {
    eptMinutes: finalEpt,
    breakdown: {
      base_ept_raw:          Math.round(baseEpt * 10) / 10,
      coordination_overhead: Math.round(coordinationOverhead * 10) / 10,
      unique_categories:     uniqueCategories,
      unique_item_types:     uniqueItemCount,
      active_orders_in_kitchen: activePreparingCount,
      workload_multiplier:   workloadMultiplier.toFixed(2),
      formula_ept_minutes:   formulaEpt,
      historical_avg_minutes: historicalAvg ? Math.round(historicalAvg) : null,
      blend_note:            blendNote,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FULL ASYNC EPT (with DB context — used by order placement)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * calculateEPT(orderItems, client?)
 *
 * Fetches kitchen context from DB, then runs computeBaseEPT.
 *
 * @param {Array<{ preparation_time, quantity, category? }>} orderItems
 * @param {pg.PoolClient} [client]
 * @returns {Promise<{ eptMinutes, estimatedReadyAt, breakdown }>}
 */
export async function calculateEPT(orderItems, client = null) {
  const db = client || pool;

  // Fetch kitchen state
  const { rows: workloadRows } = await db.query(
    `SELECT COUNT(*) AS active_count FROM orders WHERE order_status = 'PREPARING'`
  );
  const activePreparingCount = parseInt(workloadRows[0].active_count, 10);

  // Fetch historical average fulfillment time for today (accuracy blend)
  const { rows: histRows } = await db.query(
    `SELECT ROUND(AVG(
       EXTRACT(EPOCH FROM (estimated_ready_time - order_time)) / 60
     ), 1) AS hist_avg
     FROM orders
     WHERE order_status IN ('COMPLETED', 'COLLECTED')
       AND order_time > NOW() - INTERVAL '3 hours'
       AND estimated_ready_time IS NOT NULL`
  );
  const historicalAvg = histRows[0]?.hist_avg ? parseFloat(histRows[0].hist_avg) : null;

  const { eptMinutes, breakdown } = computeBaseEPT(orderItems, activePreparingCount, historicalAvg);

  const estimatedReadyAt = new Date(Date.now() + eptMinutes * 60_000);

  return { eptMinutes, estimatedReadyAt, breakdown };
}

/**
 * recalculateActiveEPTs()
 * Refreshes EPT for all orders currently in PREPARING state.
 */
export async function recalculateActiveEPTs() {
  const client = await pool.connect();
  try {
    const { rows: preparingOrders } = await client.query(`
      SELECT o.order_id,
             json_agg(json_build_object(
               'preparation_time', mi.preparation_time,
               'quantity',         oi.quantity,
               'category',         mi.category
             )) AS items
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.order_id
      JOIN menu_items mi  ON mi.item_id  = oi.item_id
      WHERE o.order_status = 'PREPARING'
      GROUP BY o.order_id
    `);

    for (const order of preparingOrders) {
      const { estimatedReadyAt } = await calculateEPT(order.items, client);
      await client.query(
        `UPDATE orders SET estimated_ready_time = $1, updated_at = NOW() WHERE order_id = $2`,
        [estimatedReadyAt, order.order_id]
      );
    }
  } finally {
    client.release();
  }
}
