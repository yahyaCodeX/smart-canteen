// src/controllers/analytics.controller.js
import pool from '../db/pool.js';

export async function getDashboardStats(req, res) {
  try {
    // We need to fetch:
    // Total orders today, active, preparing, ready, completed, cancelled, total sales
    // Average preparation time
    // Peak ordering time
    // Delayed order percentage

    // 1. Orders by Status (Today)
    const { rows: statusRows } = await pool.query(`
      SELECT order_status, COUNT(*) as count, SUM(total_amount) as amount
      FROM orders
      WHERE order_time::date = CURRENT_DATE
      GROUP BY order_status
    `);

    let stats = {
      total_orders: 0,
      active_orders: 0,
      preparing: 0,
      ready: 0,
      completed_orders: 0,
      cancelled_orders: 0,
      total_revenue: 0,
      delayed_orders: 0
    };

    statusRows.forEach(r => {
      const cnt = parseInt(r.count, 10);
      const amt = parseFloat(r.amount) || 0;
      stats.total_orders += cnt;
      if (r.order_status === 'COMPLETED' || r.order_status === 'COLLECTED') {
        stats.completed_orders += cnt; // changed to += to sum both if they both exist
        stats.total_revenue += amt;
      }
      if (r.order_status === 'CANCELLED') stats.cancelled_orders = cnt;
      if (r.order_status === 'PREPARING') stats.preparing = cnt;
      if (r.order_status === 'READY') stats.ready = cnt;
      if (r.order_status === 'DELAYED') stats.delayed_orders = cnt;
      
      if (['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'DELAYED'].includes(r.order_status)) {
        stats.active_orders += cnt;
      }
    });

    stats.delayed_percentage = stats.total_orders > 0 
      ? ((stats.delayed_orders / stats.total_orders) * 100).toFixed(1) + '%' 
      : '0%';

    // 2. Most Ordered & Least Ordered Food (All time or today)
    const { rows: itemRows } = await pool.query(`
      SELECT m.item_name, SUM(oi.quantity) as total_qty
      FROM order_items oi
      JOIN menu_items m ON oi.item_id = m.item_id
      JOIN orders o ON oi.order_id = o.order_id
      WHERE o.order_time::date = CURRENT_DATE
        AND o.order_status != 'CANCELLED'
      GROUP BY m.item_id, m.item_name
      ORDER BY total_qty DESC
      LIMIT 5
    `);
    
    stats.top_5_ordered = itemRows.map(r => ({ name: r.item_name, qty: parseInt(r.total_qty, 10) }));
    stats.most_ordered = itemRows.length > 0 ? itemRows[0].item_name : 'N/A';

    // 3. Average Preparation Time (Completed orders today)
    const { rows: timeRows } = await pool.query(`
      SELECT AVG(EXTRACT(EPOCH FROM (collected_at - order_time))/60) as avg_mins
      FROM orders
      WHERE order_status IN ('COLLECTED', 'COMPLETED')
        AND order_time::date = CURRENT_DATE
        AND collected_at IS NOT NULL
    `);
    
    stats.avg_preparation_time = timeRows[0].avg_mins 
      ? Math.round(parseFloat(timeRows[0].avg_mins))
      : 0;

    // 4. Peak Ordering Time (Hourly grouping today)
    const { rows: peakRows } = await pool.query(`
      SELECT EXTRACT(HOUR FROM order_time) as hour, COUNT(*) as cnt
      FROM orders
      WHERE order_time::date = CURRENT_DATE
      GROUP BY hour
      ORDER BY cnt DESC
      LIMIT 1
    `);
    
    if (peakRows.length > 0) {
      const h = parseInt(peakRows[0].hour, 10);
      const ampm = h >= 12 ? 'PM' : 'AM';
      const hr = h % 12 || 12;
      stats.peak_ordering_time = `${hr}:00 ${ampm} (${peakRows[0].cnt} orders)`;
    } else {
      stats.peak_ordering_time = 'N/A';
    }

    return res.json({ success: true, stats });
  } catch (err) {
    console.error('getDashboardStats error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to load dashboard stats.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/analytics/logs
// Returns the latest 20 activity log entries
// ─────────────────────────────────────────────────────────────────────────────
export async function getActivityLogs(req, res) {
  try {
    const { rows } = await pool.query(`
      SELECT l.log_id, l.action, l.entity, l.details, l.created_at,
             u.name AS staff_name
      FROM staff_activity_logs l
      LEFT JOIN users u ON l.staff_id = u.user_id
      ORDER BY l.created_at DESC
      LIMIT 20
    `);
    return res.json({ success: true, logs: rows });
  } catch (err) {
    console.error('getActivityLogs error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to fetch logs.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Export Sales CSV
// ─────────────────────────────────────────────────────────────────────────────
export async function exportSalesCSV(req, res) {
  try {
    const { rows } = await pool.query(`
      SELECT 
        o.order_id, 
        o.order_time, 
        o.total_amount, 
        o.order_status, 
        u.name as customer_name
      FROM orders o
      LEFT JOIN users u ON o.customer_id = u.user_id
      WHERE o.order_time::date = CURRENT_DATE
      ORDER BY o.order_time DESC
    `);

    // CSV Header
    let csv = 'Order ID,Time,Customer,Status,Total Amount (PKR)\n';
    
    rows.forEach(r => {
      const time = new Date(r.order_time).toLocaleTimeString();
      const name = (r.customer_name || 'Unknown').replace(/,/g, '');
      csv += `${r.order_id},${time},${name},${r.order_status},${r.total_amount}\n`;
    });

    res.header('Content-Type', 'text/csv');
    res.attachment(`Sales_Report_${new Date().toISOString().split('T')[0]}.csv`);
    return res.send(csv);

  } catch (err) {
    console.error('exportSalesCSV error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to export CSV.' });
  }
}
