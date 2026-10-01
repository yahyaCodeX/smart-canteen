// src/controllers/menu.controller.js
// Step 1-2 of the 20-step workflow:
//   1. Customer opens the menu.
//   2. System shows only currently available items.

import pool from '../db/pool.js';
import { getNextAvailableSlots, restockItem } from '../services/stock-limits.service.js';

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/menu
// Public — Returns all AVAILABLE and LIMITED items with optional filters
// Query params: category, minPrice, maxPrice, maxPrepTime, sort, search
// ─────────────────────────────────────────────────────────────────────────────
export async function getMenu(req, res) {
  try {
    const { category, minPrice, maxPrice, maxPrepTime, sort = 'category', search } = req.query;

    let conditions = [`status IN ('AVAILABLE', 'LIMITED')`];
    const params = [];
    let idx = 1;

    if (category) {
      conditions.push(`LOWER(category) = LOWER($${idx++})`);
      params.push(category);
    }
    if (minPrice) {
      conditions.push(`price >= $${idx++}`);
      params.push(parseFloat(minPrice));
    }
    if (maxPrice) {
      conditions.push(`price <= $${idx++}`);
      params.push(parseFloat(maxPrice));
    }
    if (maxPrepTime) {
      conditions.push(`preparation_time <= $${idx++}`);
      params.push(parseInt(maxPrepTime, 10));
    }
    if (search) {
      conditions.push(`(LOWER(item_name) LIKE LOWER($${idx++}) OR LOWER(description) LIKE LOWER($${idx - 1}))`);
      params.push(`%${search}%`);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const sortOptions = {
      category:        'category ASC, item_name ASC',
      price_asc:       'price ASC',
      price_desc:      'price DESC',
      prep_time:       'preparation_time ASC',
      popularity:      'available_quantity DESC',
    };
    const orderBy = sortOptions[sort] || sortOptions.category;

    const { rows } = await pool.query(
      `SELECT
         item_id, item_name, category, price,
         available_quantity, preparation_time, status, image, description
       FROM menu_items
       ${whereClause}
       ORDER BY ${orderBy}`,
      params
    );

    // Group items by category for frontend convenience
    const byCategory = rows.reduce((acc, item) => {
      if (!acc[item.category]) acc[item.category] = [];
      acc[item.category].push(item);
      return acc;
    }, {});

    const categories = [...new Set(rows.map((r) => r.category))];

    return res.json({
      success: true,
      total: rows.length,
      categories,
      items: rows,
      byCategory,
    });
  } catch (err) {
    console.error('getMenu error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to load menu.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/menu/:itemId
// Returns a single menu item detail
// ─────────────────────────────────────────────────────────────────────────────
export async function getMenuItem(req, res) {
  try {
    const { itemId } = req.params;
    const { rows } = await pool.query(
      `SELECT item_id, item_name, category, price,
              available_quantity, preparation_time, status, image, description
       FROM menu_items WHERE item_id = $1`,
      [itemId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Item not found.' });
    }
    return res.json({ success: true, item: rows[0] });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to load item.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/menu/slots
// Returns available pickup slots with remaining capacity
// ─────────────────────────────────────────────────────────────────────────────
export async function getPickupSlots(req, res) {
  try {
    const slots = await getNextAvailableSlots(new Date(), pool, 16);
    return res.json({ success: true, slots });
  } catch (err) {
    console.error('getPickupSlots error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to load pickup slots.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/menu/slots/limit
// ─────────────────────────────────────────────────────────────────────────────
import { updateSlotLimit as setGlobalSlotLimit } from '../services/stock-limits.service.js';

export async function updateSlotLimits(req, res) {
  try {
    const { newLimit } = req.body;
    if (!newLimit || newLimit < 1) {
      return res.status(400).json({ success: false, error: 'Valid limit is required' });
    }
    setGlobalSlotLimit(parseInt(newLimit, 10));
    
    await pool.query(
      `INSERT INTO staff_activity_logs (staff_id, action, entity, entity_id, details)
       VALUES ($1, 'UPDATE_SLOT_LIMIT', 'system', 'config', $2)`,
      [req.user.user_id, JSON.stringify({ new_limit: newLimit })]
    );

    return res.json({ success: true, newLimit: parseInt(newLimit, 10) });
  } catch (err) {
    console.error('updateSlotLimits error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to update slot limit.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/menu/:itemId/status  (STAFF / MANAGER only)
// Toggle item availability
// ─────────────────────────────────────────────────────────────────────────────
export async function updateItemStatus(req, res) {
  try {
    const { itemId } = req.params;
    const { status, available_quantity } = req.body;

    const validStatuses = ['AVAILABLE', 'LIMITED', 'SOLD_OUT', 'TEMPORARILY_UNAVAILABLE'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
      });
    }

    let updatedItem;
    if (available_quantity !== undefined) {
      // If quantity is provided, use restockItem which auto-calculates status if overrideStatus is not provided
      updatedItem = await restockItem(itemId, parseInt(available_quantity, 10), status, pool);
    } else {
      // Just update status
      const { rows } = await pool.query(
        `UPDATE menu_items SET status = $1, updated_at = NOW()
         WHERE item_id = $2
         RETURNING item_id, item_name, status, available_quantity`,
        [status, itemId]
      );
      updatedItem = rows[0];
    }

    if (!updatedItem) {
      return res.status(404).json({ success: false, error: 'Item not found.' });
    }

    // Log staff action
    await pool.query(
      `INSERT INTO staff_activity_logs (staff_id, action, entity, entity_id, details)
       VALUES ($1, 'UPDATE_ITEM_STATUS', 'menu_items', $2, $3)`,
      [req.user.user_id, itemId, JSON.stringify({ status, available_quantity })]
    );

    return res.json({ success: true, item: updatedItem });
  } catch (err) {
    console.error('updateItemStatus error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to update item status.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/menu/categories
// Public — Returns distinct categories with item counts
// ─────────────────────────────────────────────────────────────────────────────
export async function getCategories(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT category, COUNT(*)::int AS item_count 
       FROM menu_items 
       GROUP BY category 
       ORDER BY category`
    );
    return res.json({ success: true, categories: rows });
  } catch (err) {
    console.error('getCategories error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to fetch categories.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/menu/categories/rename
// Admin/Manager — Renames a category across all menu items
// Body: { oldName, newName }
// ─────────────────────────────────────────────────────────────────────────────
export async function renameCategory(req, res) {
  try {
    const { oldName, newName } = req.body;
    if (!oldName || !newName) {
      return res.status(400).json({ success: false, error: 'oldName and newName are required.' });
    }

    const { rowCount } = await pool.query(
      `UPDATE menu_items SET category = $1 WHERE category = $2`,
      [newName.trim(), oldName.trim()]
    );

    return res.json({ success: true, updated: rowCount });
  } catch (err) {
    console.error('renameCategory error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to rename category.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/menu
// Admin/Manager — Create a new menu item
// ─────────────────────────────────────────────────────────────────────────────
export async function createMenuItem(req, res) {
  try {
    const { item_name, description, price, category, status, preparation_time } = req.body;
    
    if (!item_name || price === undefined) {
      return res.status(400).json({ success: false, error: 'Item name and price are required.' });
    }

    const { rows } = await pool.query(
      `INSERT INTO menu_items (item_name, description, price, category, status, preparation_time)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [item_name, description || '', price, category || 'Uncategorized', status || 'AVAILABLE', preparation_time || 5]
    );

    // Log the action
    await pool.query(
      `INSERT INTO staff_activity_logs (staff_id, action, entity, entity_id, details)
       VALUES ($1, 'CREATE_ITEM', 'menu_items', $2, $3)`,
      [req.user.user_id, rows[0].item_id, JSON.stringify({ item_name })]
    );

    return res.json({ success: true, item: rows[0] });
  } catch (err) {
    console.error('createMenuItem error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to create menu item.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/menu/:itemId
// Admin/Manager — Update menu item details
// ─────────────────────────────────────────────────────────────────────────────
export async function updateMenuItemDetails(req, res) {
  try {
    const { itemId } = req.params;
    const { item_name, description, price, category, status, preparation_time } = req.body;

    const { rows } = await pool.query(
      `UPDATE menu_items 
       SET item_name = COALESCE($1, item_name),
           description = COALESCE($2, description),
           price = COALESCE($3, price),
           category = COALESCE($4, category),
           status = COALESCE($5, status),
           preparation_time = COALESCE($6, preparation_time),
           updated_at = CURRENT_TIMESTAMP
       WHERE item_id = $7 RETURNING *`,
      [item_name, description, price, category, status, preparation_time, itemId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Item not found.' });
    }

    await pool.query(
      `INSERT INTO staff_activity_logs (staff_id, action, entity, entity_id, details)
       VALUES ($1, 'UPDATE_ITEM', 'menu_items', $2, $3)`,
      [req.user.user_id, itemId, JSON.stringify({ item_name })]
    );

    return res.json({ success: true, item: rows[0] });
  } catch (err) {
    console.error('updateMenuItemDetails error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to update menu item.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/menu/:itemId
// Admin/Manager — Delete a menu item
// ─────────────────────────────────────────────────────────────────────────────
export async function deleteMenuItem(req, res) {
  try {
    const { itemId } = req.params;

    // Check if it's referenced in orders
    const { rows: orderRows } = await pool.query(
      `SELECT COUNT(*) FROM order_items WHERE item_id = $1`,
      [itemId]
    );

    if (parseInt(orderRows[0].count) > 0) {
      // If it exists in orders, just mark as DELETED/UNAVAILABLE instead of hard delete
      await pool.query(`UPDATE menu_items SET status = 'UNAVAILABLE' WHERE item_id = $1`, [itemId]);
      
      await pool.query(
        `INSERT INTO staff_activity_logs (staff_id, action, entity, entity_id, details)
         VALUES ($1, 'SOFT_DELETE_ITEM', 'menu_items', $2, $3)`,
        [req.user.user_id, itemId, JSON.stringify({ status: 'UNAVAILABLE (In use by orders)' })]
      );
      
      return res.json({ success: true, message: 'Item soft-deleted (status set to UNAVAILABLE) because it exists in past orders.' });
    }

    // Hard delete
    const { rowCount } = await pool.query(`DELETE FROM menu_items WHERE item_id = $1`, [itemId]);
    
    if (rowCount > 0) {
      await pool.query(
        `INSERT INTO staff_activity_logs (staff_id, action, entity, entity_id, details)
         VALUES ($1, 'DELETE_ITEM', 'menu_items', $2, $3)`,
        [req.user.user_id, itemId, JSON.stringify({})]
      );
    }

    return res.json({ success: true, deleted: rowCount > 0 });
  } catch (err) {
    console.error('deleteMenuItem error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to delete menu item.' });
  }
}
