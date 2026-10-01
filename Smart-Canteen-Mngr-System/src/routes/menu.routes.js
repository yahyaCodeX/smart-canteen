// src/routes/menu.routes.js
import { Router } from 'express';
import { 
  getMenu, getMenuItem, getPickupSlots, 
  updateItemStatus, getCategories, renameCategory,
  createMenuItem, updateMenuItemDetails, deleteMenuItem, updateSlotLimits
} from '../controllers/menu.controller.js';
import { verifyToken } from '../middleware/verifyToken.js';
import { checkRole }   from '../middleware/checkRole.js';

const router = Router();

// ── Public ────────────────────────────────────────────────────────
// GET /api/menu             — Browse available menu (with filters)
router.get('/', getMenu);

// GET /api/menu/categories  — List distinct categories
router.get('/categories', getCategories);

// GET /api/menu/slots       — Available pickup time slots
router.get('/slots', getPickupSlots);

// GET /api/menu/:itemId     — Single item detail
router.get('/:itemId', getMenuItem);

// ── Protected: Staff & Manager only ───────────────────────────────
// PATCH /api/menu/slots/limit - Update global slot capacity limit
router.patch(
  '/slots/limit',
  verifyToken,
  checkRole(['MANAGER', 'ADMIN']),
  updateSlotLimits
);

// PATCH /api/menu/:itemId/status — Toggle item availability
router.patch(
  '/:itemId/status',
  verifyToken,
  checkRole(['STAFF', 'MANAGER', 'ADMIN']),
  updateItemStatus
);

// POST /api/menu — Create new menu item
router.post(
  '/',
  verifyToken,
  checkRole(['MANAGER', 'ADMIN']),
  createMenuItem
);

// PUT /api/menu/:itemId — Update item details
router.put(
  '/:itemId',
  verifyToken,
  checkRole(['MANAGER', 'ADMIN']),
  updateMenuItemDetails
);

// DELETE /api/menu/:itemId — Delete item
router.delete(
  '/:itemId',
  verifyToken,
  checkRole(['MANAGER', 'ADMIN']),
  deleteMenuItem
);

// PATCH /api/menu/categories/rename — Rename a category (Admin only)
router.patch(
  '/categories/rename',
  verifyToken,
  checkRole(['ADMIN', 'MANAGER']),
  renameCategory
);

export default router;
