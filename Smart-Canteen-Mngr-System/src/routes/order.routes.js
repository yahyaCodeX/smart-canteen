// src/routes/order.routes.js
import { Router } from 'express';
import {
  placeOrder,
  getOrderById,
  getMyOrders,
  updateOrderStatus,
  collectOrder,
  verifyTokenString,
  completeOrder,
  getKitchenQueue,
} from '../controllers/order.controller.js';
import { verifyToken }      from '../middleware/verifyToken.js';
import { checkRole }        from '../middleware/checkRole.js';
import { checkIdempotency } from '../middleware/idempotency.js';

const router = Router();

// All order routes require authentication
router.use(verifyToken);

// ── Customer routes ────────────────────────────────────────────────────────
// GET  /api/orders/my           — Customer's own order history
router.get('/my', checkRole(['CUSTOMER', 'ADMIN']), getMyOrders);

// POST /api/orders              — Place new order (Steps 3-11)
// Requires Idempotency-Key header
router.post(
  '/',
  checkRole(['CUSTOMER']),
  checkIdempotency,
  placeOrder
);

// GET  /api/orders/:orderId     — Track live order (Step 15) — all roles
router.get('/:orderId', getOrderById);

// ── Staff/Manager routes ───────────────────────────────────────────────────
// GET  /api/orders/queue        — Live kitchen queue (Steps 12, 16)
router.get(
  '/queue/live',
  checkRole(['STAFF', 'MANAGER', 'ADMIN']),
  getKitchenQueue
);

// PATCH /api/orders/:orderId/status — Progress order through lifecycle (Steps 13-14, 16-17, 20)
router.patch(
  '/:orderId/status',
  updateOrderStatus  // role check is done inside controller per-transition
);

// POST /api/orders/:orderId/collect — Token verification & collection (Steps 18-19)
router.post(
  '/:orderId/collect',
  checkRole(['STAFF', 'MANAGER', 'ADMIN']),
  collectOrder
);

// POST /api/orders/verify-token — Token verification by string (e.g. C-023)
router.post(
  '/verify-token',
  checkRole(['STAFF', 'MANAGER', 'ADMIN']),
  verifyTokenString
);

// POST /api/orders/:orderId/complete — Finalize order (Step 20)
router.post(
  '/:orderId/complete',
  checkRole(['STAFF', 'MANAGER', 'ADMIN']),
  completeOrder
);

export default router;
