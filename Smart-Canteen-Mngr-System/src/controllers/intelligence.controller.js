// src/controllers/intelligence.controller.js
// Smart Intelligence API — Real-time alerts, EPT breakdowns, demand forecasts

import {
  getAllAlerts,
  getOrderEPTDetail,
  getDemandForecast,
} from '../services/intelligence.service.js';
import { computeBaseEPT, CATEGORY_MULTIPLIERS } from '../services/ept.service.js';
import pool from '../db/pool.js';
import { generateAIInsights, getCustomerRecommendations } from '../services/ai.service.js';

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/intelligence/alerts
// Real-time alert feed — all 7 detector types, severity-sorted
// Staff/Manager polling endpoint (call every 30-60s from frontend)
// ─────────────────────────────────────────────────────────────────────────────
export async function getAlerts(req, res) {
  try {
    const result = await getAllAlerts();
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('getAlerts error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to generate alerts.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/intelligence/ept/:orderId
// Full EPT breakdown for a specific order (Customer & Staff facing)
// ─────────────────────────────────────────────────────────────────────────────
export async function getEPTBreakdown(req, res) {
  try {
    const { orderId } = req.params;

    // Permission check — customers can only see their own orders
    if (req.user.role === 'CUSTOMER') {
      const { rows } = await pool.query(
        'SELECT customer_id FROM orders WHERE order_id = $1',
        [orderId]
      );
      if (!rows.length || rows[0].customer_id !== req.user.user_id) {
        return res.status(403).json({ success: false, error: 'Access denied.' });
      }
    }

    const detail = await getOrderEPTDetail(orderId);
    if (!detail) {
      return res.status(404).json({ success: false, error: 'Order not found.' });
    }
    return res.json({ success: true, ept: detail });
  } catch (err) {
    console.error('getEPTBreakdown error:', err.message);
    return res.status(500).json({ success: false, error: 'EPT breakdown failed.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/intelligence/ept/simulate
// Simulate EPT for a cart before placing an order (no auth required)
// Body: { items: [{ item_id, quantity }] }
// ─────────────────────────────────────────────────────────────────────────────
export async function simulateEPT(req, res) {
  try {
    const { items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'items array is required.',
      });
    }

    // Fetch item details from DB
    const itemIds = items.map((i) => i.item_id);
    const { rows: menuItems } = await pool.query(
      `SELECT item_id, item_name, category, preparation_time, status, available_quantity
       FROM menu_items WHERE item_id = ANY($1)`,
      [itemIds]
    );

    // Check availability
    const menuMap = Object.fromEntries(menuItems.map((m) => [m.item_id, m]));
    const orderItems = [];
    const unavailable = [];

    for (const reqItem of items) {
      const mi = menuMap[reqItem.item_id];
      if (!mi) continue;
      if (mi.status === 'SOLD_OUT' || mi.status === 'TEMPORARILY_UNAVAILABLE') {
        unavailable.push(mi.item_name);
        continue;
      }
      orderItems.push({
        item_name:        mi.item_name,
        category:         mi.category,
        preparation_time: mi.preparation_time,
        quantity:         reqItem.quantity,
      });
    }

    // Get current kitchen workload
    const { rows: wl } = await pool.query(
      `SELECT COUNT(*) AS cnt FROM orders WHERE order_status = 'PREPARING'`
    );
    const activePreparing = parseInt(wl[0].cnt, 10);

    const { eptMinutes, breakdown } = computeBaseEPT(orderItems, activePreparing);
    const estimatedReadyAt = new Date(Date.now() + eptMinutes * 60_000);

    // Build human-readable item contributions
    const itemDetails = orderItems.map((item) => {
      const mult = CATEGORY_MULTIPLIERS[item.category] ?? 1.0;
      return {
        item_name:           item.item_name,
        category:            item.category,
        quantity:            item.quantity,
        base_prep_time:      item.preparation_time,
        category_multiplier: mult,
        adjusted_prep_time:  Math.round(item.preparation_time * mult * 10) / 10,
      };
    });

    return res.json({
      success: true,
      simulation: {
        ept_minutes:       eptMinutes,
        estimated_ready_at: estimatedReadyAt,
        kitchen_workload: {
          active_preparing: activePreparing,
          workload_note:   activePreparing > 6
            ? `Kitchen is busy with ${activePreparing} active orders — your EPT is extended.`
            : `Kitchen load is normal.`,
        },
        breakdown,
        item_details:      itemDetails,
        unavailable_items: unavailable,
      },
    });
  } catch (err) {
    console.error('simulateEPT error:', err.message);
    return res.status(500).json({ success: false, error: 'EPT simulation failed.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/intelligence/forecast
// 7-day demand analysis: peak hours, popular items, avg wait by hour
// Manager only
// ─────────────────────────────────────────────────────────────────────────────
export async function getForecast(req, res) {
  try {
    const forecast = await getDemandForecast();
    return res.json({ success: true, forecast });
  } catch (err) {
    console.error('getForecast error:', err.message);
    return res.status(500).json({ success: false, error: 'Forecast generation failed.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/intelligence/kitchen-status
// Real-time kitchen health snapshot — workload, throughput, risk level
// ─────────────────────────────────────────────────────────────────────────────
export async function getKitchenStatus(req, res) {
  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE order_status = 'PLACED')     AS placed,
        COUNT(*) FILTER (WHERE order_status = 'ACCEPTED')   AS accepted,
        COUNT(*) FILTER (WHERE order_status = 'PREPARING')  AS preparing,
        COUNT(*) FILTER (WHERE order_status = 'READY')      AS ready,
        COUNT(*) FILTER (WHERE order_status = 'DELAYED')    AS delayed,
        COUNT(*) FILTER (WHERE order_status = 'COMPLETED'
                           AND order_time::date = CURRENT_DATE) AS completed_today,
        ROUND(AVG(total_amount) FILTER (
          WHERE order_time::date = CURRENT_DATE
            AND order_status NOT IN ('CANCELLED','REJECTED')
        ), 2) AS avg_order_value,
        ROUND(AVG(
          EXTRACT(EPOCH FROM (estimated_ready_time - order_time)) / 60
        ) FILTER (
          WHERE order_status IN ('COMPLETED','COLLECTED')
            AND estimated_ready_time IS NOT NULL
            AND order_time::date = CURRENT_DATE
        ), 1) AS avg_actual_ept,
        SUM(total_amount) FILTER (
          WHERE order_status IN ('COMPLETED','COLLECTED')
            AND order_time::date = CURRENT_DATE
        ) AS total_revenue_today
      FROM orders
    `);

    const s = rows[0];
    const preparingCount = parseInt(s.preparing, 10);
    const totalActive = parseInt(s.placed, 10) + parseInt(s.accepted, 10) + preparingCount + parseInt(s.ready, 10);

    // Compute workload multiplier
    const workloadMultiplier = Math.min(1 + 0.15 * preparingCount, 2.0);

    // Risk level
    let riskLevel = 'LOW';
    if (parseInt(s.delayed, 10) > 0 || preparingCount >= 10) riskLevel = 'CRITICAL';
    else if (preparingCount >= 6 || totalActive >= 10) riskLevel = 'HIGH';
    else if (preparingCount >= 3 || totalActive >= 5)  riskLevel = 'MEDIUM';

    return res.json({
      success: true,
      kitchen_status: {
        counts: {
          placed:           parseInt(s.placed, 10),
          accepted:         parseInt(s.accepted, 10),
          preparing:        preparingCount,
          ready:            parseInt(s.ready, 10),
          delayed:          parseInt(s.delayed, 10),
          completed_today:  parseInt(s.completed_today, 10),
          total_active:     totalActive,
        },
        performance: {
          avg_ept_minutes:    s.avg_actual_ept ? parseFloat(s.avg_actual_ept) : null,
          avg_order_value:    s.avg_order_value ? parseFloat(s.avg_order_value) : null,
          total_revenue_today: s.total_revenue_today ? parseFloat(s.total_revenue_today) : 0,
        },
        workload: {
          multiplier:   workloadMultiplier.toFixed(2),
          percent_busy: Math.round((workloadMultiplier - 1) / 1.0 * 100),
          risk_level:   riskLevel,
          description:  riskLevel === 'CRITICAL'
            ? 'Kitchen is overloaded. Immediate attention required.'
            : riskLevel === 'HIGH'
            ? 'Kitchen is heavily loaded. Monitor closely.'
            : riskLevel === 'MEDIUM'
            ? 'Kitchen is moderately busy. Running smoothly.'
            : 'Kitchen load is low. All systems normal.',
        },
      },
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('getKitchenStatus error:', err.message);
    return res.status(500).json({ success: false, error: 'Kitchen status check failed.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/intelligence/ai-insights (Managers)
// ─────────────────────────────────────────────────────────────────────────────
export async function getAiInsights(req, res) {
  try {
    const result = await generateAIInsights();
    if (!result.success) {
      return res.status(503).json({ success: false, error: result.error });
    }
    return res.json(result);
  } catch (err) {
    console.error('getAiInsights error:', err);
    return res.status(500).json({ success: false, error: 'Failed to generate AI Insights.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/intelligence/recommendations (Customers)
// ─────────────────────────────────────────────────────────────────────────────
export async function getMenuRecommendations(req, res) {
  try {
    const result = await getCustomerRecommendations(req.user ? req.user.user_id : null);
    if (!result.success) {
      return res.status(503).json({ success: false, error: result.error });
    }
    return res.json(result);
  } catch (err) {
    console.error('getMenuRecommendations error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch recommendations.' });
  }
}
