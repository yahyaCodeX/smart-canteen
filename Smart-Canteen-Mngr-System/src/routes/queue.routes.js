// src/routes/queue.routes.js
import { Router } from 'express';
import {
  getFullQueue,
  getActiveQueue,
  getScheduledQueue,
  getQueueMetrics,
  triggerDelayCheck,
  lookupByToken,
} from '../controllers/queue.controller.js';
import { verifyToken } from '../middleware/verifyToken.js';
import { checkRole }   from '../middleware/checkRole.js';

const router = Router();

// All queue routes require authentication
router.use(verifyToken);

// ── Staff & Manager ──────────────────────────────────────────────────────────
const kitchenRoles = ['STAFF', 'MANAGER', 'ADMIN'];

// GET  /api/queue              — Full queue (active + scheduled)
router.get('/',           checkRole(kitchenRoles), getFullQueue);

// GET  /api/queue/active       — Active queue only (needs prep now)
router.get('/active',     checkRole(kitchenRoles), getActiveQueue);

// GET  /api/queue/scheduled    — Future scheduled orders
router.get('/scheduled',  checkRole(kitchenRoles), getScheduledQueue);

// GET  /api/queue/stats        — Manager metrics & daily analytics
router.get('/stats',      checkRole(kitchenRoles), getQueueMetrics);

// POST /api/queue/flag-delays  — Manual delay detection trigger
router.post('/flag-delays', checkRole(kitchenRoles), triggerDelayCheck);

// GET  /api/queue/token/:tokenNumber — Counter scanner token lookup
router.get('/token/:tokenNumber', checkRole(kitchenRoles), lookupByToken);

export default router;
