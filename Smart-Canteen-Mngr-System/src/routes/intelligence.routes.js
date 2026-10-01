// src/routes/intelligence.routes.js
import { Router } from 'express';
import {
  getAlerts,
  getEPTBreakdown,
  simulateEPT,
  getForecast,
  getKitchenStatus,
  getAiInsights,
  getMenuRecommendations,
} from '../controllers/intelligence.controller.js';
import { verifyToken } from '../middleware/verifyToken.js';
import { checkRole }   from '../middleware/checkRole.js';

const router = Router();

// ── Public (no auth) ──────────────────────────────────────────────────────────
// POST /api/intelligence/ept/simulate
// Customer can check EPT before ordering (pre-order cart simulation)
router.post('/ept/simulate', simulateEPT);

// ── Authenticated ────────────────────────────────────────────────────────────
router.use(verifyToken);

// GET /api/intelligence/ept/:orderId — EPT detail for a specific order
router.get('/ept/:orderId', getEPTBreakdown);

// GET /api/intelligence/kitchen-status — All roles can see kitchen health
router.get(
  '/kitchen-status',
  checkRole(['STAFF', 'MANAGER', 'ADMIN']),
  getKitchenStatus
);

// GET /api/intelligence/alerts — Real-time alert feed (Staff + Manager)
router.get(
  '/alerts',
  checkRole(['STAFF', 'MANAGER', 'ADMIN']),
  getAlerts
);

// GET /api/intelligence/forecast — 7-day demand forecast (Manager only)
router.get(
  '/forecast',
  checkRole(['MANAGER', 'ADMIN']),
  getForecast
);

// GET /api/intelligence/ai-insights — Gemini AI Insights (Manager only)
router.get(
  '/ai-insights',
  checkRole(['MANAGER', 'ADMIN']),
  getAiInsights
);

// GET /api/intelligence/recommendations — Smart Food Recommendations (Customer only)
router.get(
  '/recommendations',
  checkRole(['CUSTOMER', 'ADMIN']),
  getMenuRecommendations
);

export default router;
