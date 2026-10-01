// src/services/stock-limits.service.js
// Smart Canteen Engine — Stock Control, Capacity Throttling & 15-Min Slot Limits
//
// Rules Implemented:
// 1. Real-Time Stock Control:
//    - Auto transition to SOLD_OUT when available_quantity <= 0.
//    - Auto transition to LIMITED when available_quantity <= 5.
//    - Rejection of orders if requested quantity > available stock or item is SOLD_OUT / TEMPORARILY_UNAVAILABLE.
// 2. Customer Order Limits:
//    - Max items per single order: 15 items.
//    - Max active uncollected orders per customer: 3 active orders.
// 3. 15-Minute Pickup Slot Throttling:
//    - Max orders per 15-minute window: 20 orders.
//    - Auto-detection of full 15-minute slots.
//    - Suggestion of next available open 15-minute pickup slots.

import pool from '../db/pool.js';

export const MAX_ITEMS_PER_ORDER = 15;
export const MAX_ACTIVE_ORDERS_PER_CUSTOMER = 3;
export let MAX_ORDERS_PER_15MIN_SLOT = 20;
export const LOW_STOCK_THRESHOLD = 5;

export function updateSlotLimit(newLimit) {
  MAX_ORDERS_PER_15MIN_SLOT = newLimit;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Check & Enforce Stock Availability
// ─────────────────────────────────────────────────────────────────────────────
export async function validateItemStock(items, dbClient = pool) {
  const itemIds = items.map((i) => i.item_id);

  const { rows: menuItems } = await dbClient.query(
    `SELECT item_id, item_name, category, price, available_quantity, preparation_time, status
     FROM menu_items
     WHERE item_id = ANY($1)
     FOR UPDATE`,
    [itemIds]
  );

  const menuMap = Object.fromEntries(menuItems.map((m) => [m.item_id, m]));

  for (const reqItem of items) {
    const menuItem = menuMap[reqItem.item_id];

    if (!menuItem) {
      return {
        valid: false,
        statusCode: 404,
        error: `Item ID "${reqItem.item_id}" does not exist in menu.`,
      };
    }

    if (menuItem.status === 'SOLD_OUT' || menuItem.available_quantity <= 0) {
      return {
        valid: false,
        statusCode: 409,
        error: `"${menuItem.item_name}" is SOLD OUT and unavailable for ordering.`,
        item_id: menuItem.item_id,
        item_name: menuItem.item_name,
      };
    }

    if (menuItem.status === 'TEMPORARILY_UNAVAILABLE') {
      return {
        valid: false,
        statusCode: 409,
        error: `"${menuItem.item_name}" is currently TEMPORARILY UNAVAILABLE.`,
        item_id: menuItem.item_id,
        item_name: menuItem.item_name,
      };
    }

    if (reqItem.quantity > menuItem.available_quantity) {
      return {
        valid: false,
        statusCode: 409,
        error: `Insufficient stock for "${menuItem.item_name}". Only ${menuItem.available_quantity} available, but ${reqItem.quantity} requested.`,
        available_quantity: menuItem.available_quantity,
        item_id: menuItem.item_id,
        item_name: menuItem.item_name,
      };
    }
  }

  return { valid: true, menuItems: menuMap };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Check Customer Order Limits
// ─────────────────────────────────────────────────────────────────────────────
export async function validateCustomerLimits(customerId, items, dbClient = pool) {
  // Check max items count in current order
  const totalItemsCount = items.reduce((sum, item) => sum + (item.quantity || 0), 0);
  if (totalItemsCount > MAX_ITEMS_PER_ORDER) {
    return {
      valid: false,
      statusCode: 400,
      error: `Order exceeds maximum limit of ${MAX_ITEMS_PER_ORDER} items per order. You requested ${totalItemsCount} items.`,
    };
  }

  // Check active orders count for this customer
  const { rows } = await dbClient.query(
    `SELECT COUNT(*) AS active_count
     FROM orders
     WHERE customer_id = $1
       AND order_status IN ('PLACED', 'ACCEPTED', 'PREPARING', 'READY')`,
    [customerId]
  );

  const activeCount = parseInt(rows[0].active_count, 10);
  if (activeCount >= MAX_ACTIVE_ORDERS_PER_CUSTOMER) {
    return {
      valid: false,
      statusCode: 429,
      error: `Customer limit reached: You currently have ${activeCount} active uncollected orders. Maximum allowed is ${MAX_ACTIVE_ORDERS_PER_CUSTOMER}.`,
    };
  }

  return { valid: true, activeCount };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Check 15-Minute Pickup Slot Capacity & Suggest Alternatives
// ─────────────────────────────────────────────────────────────────────────────
export async function validateSlotCapacity(pickupTimeISO, dbClient = pool) {
  if (!pickupTimeISO) {
    // Immediate order — check current 15-minute rolling window count
    const windowStart = new Date(Math.floor(Date.now() / (15 * 60000)) * (15 * 60000));
    const windowEnd = new Date(windowStart.getTime() + 15 * 60000);

    const { rows } = await dbClient.query(
      `SELECT COUNT(*) AS count
       FROM orders
       WHERE order_time >= $1 AND order_time < $2
         AND order_status NOT IN ('CANCELLED', 'REJECTED')`,
      [windowStart.toISOString(), windowEnd.toISOString()]
    );

    const currentCount = parseInt(rows[0].count, 10);
    if (currentCount >= MAX_ORDERS_PER_15MIN_SLOT) {
      const altSlots = await getNextAvailableSlots(windowEnd, dbClient);
      return {
        valid: false,
        statusCode: 429,
        slot_status: 'FULL',
        error: `Current 15-minute window is FULL (${currentCount}/${MAX_ORDERS_PER_15MIN_SLOT} orders). Please schedule for a future pickup slot.`,
        alternative_slots: altSlots,
      };
    }

    return { valid: true, currentCount, maxOrders: MAX_ORDERS_PER_15MIN_SLOT };
  }

  // Scheduled order — compute 15-minute boundary for scheduled time
  const targetDate = new Date(pickupTimeISO);
  const slotMs = 15 * 60000;
  const slotStart = new Date(Math.floor(targetDate.getTime() / slotMs) * slotMs);
  const slotEnd = new Date(slotStart.getTime() + slotMs);

  const { rows } = await dbClient.query(
    `SELECT COUNT(*) AS count
     FROM orders
     WHERE pickup_time >= $1 AND pickup_time < $2
       AND order_status NOT IN ('CANCELLED', 'REJECTED')`,
    [slotStart.toISOString(), slotEnd.toISOString()]
  );

  const currentCount = parseInt(rows[0].count, 10);
  if (currentCount >= MAX_ORDERS_PER_15MIN_SLOT) {
    const altSlots = await getNextAvailableSlots(slotEnd, dbClient);
    const timeFormatted = `${slotStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – ${slotEnd.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    return {
      valid: false,
      statusCode: 409,
      slot_status: 'FULL',
      error: `Pickup slot (${timeFormatted}) is FULL (${currentCount}/${MAX_ORDERS_PER_15MIN_SLOT} orders). Please select an alternative slot.`,
      alternative_slots: altSlots,
    };
  }

  return {
    valid: true,
    slotStart,
    slotEnd,
    currentCount,
    maxOrders: MAX_ORDERS_PER_15MIN_SLOT,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Get Next Available 15-Minute Slots
// ─────────────────────────────────────────────────────────────────────────────
export async function getNextAvailableSlots(fromDate = new Date(), dbClient = pool, limit = 5) {
  const slots = [];
  const slotMs = 15 * 60000;
  let currentStart = new Date(Math.ceil(fromDate.getTime() / slotMs) * slotMs);

  for (let i = 0; i < 16 && slots.length < limit; i++) {
    const currentEnd = new Date(currentStart.getTime() + slotMs);

    const { rows } = await dbClient.query(
      `SELECT COUNT(*) AS count
       FROM orders
       WHERE pickup_time >= $1 AND pickup_time < $2
         AND order_status NOT IN ('CANCELLED', 'REJECTED')`,
      [currentStart.toISOString(), currentEnd.toISOString()]
    );

    const count = parseInt(rows[0].count, 10);
    const isFull = count >= MAX_ORDERS_PER_15MIN_SLOT;

    slots.push({
      slot_start: currentStart.toISOString(),
      slot_end: currentEnd.toISOString(),
      formatted: `${currentStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – ${currentEnd.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      current_orders: count,
      max_orders: MAX_ORDERS_PER_15MIN_SLOT,
      status: isFull ? 'FULL' : 'AVAILABLE',
      remaining_capacity: Math.max(0, MAX_ORDERS_PER_15MIN_SLOT - count),
    });

    currentStart = currentEnd;
  }

  return slots;
}

// ─────────────────────────────────────────────────────────────────────────────
// Update Item Stock and Auto-Transition Status
// ─────────────────────────────────────────────────────────────────────────────
export async function updateStockAndAutoStatus(itemId, quantityDeducted, dbClient = pool) {
  const { rows } = await dbClient.query(
    `UPDATE menu_items
     SET available_quantity = GREATEST(0, available_quantity - $1),
         status = CASE
           WHEN available_quantity - $1 <= 0 THEN 'SOLD_OUT'::item_status
           WHEN available_quantity - $1 <= ${LOW_STOCK_THRESHOLD} THEN 'LIMITED'::item_status
           ELSE status
         END,
         updated_at = NOW()
     WHERE item_id = $2
     RETURNING item_id, item_name, available_quantity, status`,
    [quantityDeducted, itemId]
  );
  return rows[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// Restock Item & Reset Status
// ─────────────────────────────────────────────────────────────────────────────
export async function restockItem(itemId, addedQuantity, overrideStatus = null, dbClient = pool) {
  const { rows: current } = await dbClient.query(
    `SELECT available_quantity, status FROM menu_items WHERE item_id = $1`,
    [itemId]
  );
  if (current.length === 0) return null;

  const newQty = current[0].available_quantity + addedQuantity;
  let newStatus = overrideStatus;
  if (!newStatus) {
    if (newQty <= 0) newStatus = 'SOLD_OUT';
    else if (newQty <= LOW_STOCK_THRESHOLD) newStatus = 'LIMITED';
    else newStatus = 'AVAILABLE';
  }

  const { rows: updated } = await dbClient.query(
    `UPDATE menu_items
     SET available_quantity = $1,
         status = $2::item_status,
         updated_at = NOW()
     WHERE item_id = $3
     RETURNING item_id, item_name, category, price, available_quantity, status`,
    [newQty, newStatus, itemId]
  );
  return updated[0];
}
