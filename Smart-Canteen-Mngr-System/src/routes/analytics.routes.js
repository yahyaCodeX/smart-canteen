// src/routes/analytics.routes.js
import { Router } from 'express';
import { getDashboardStats, getActivityLogs, exportSalesCSV } from '../controllers/analytics.controller.js';
import { verifyToken } from '../middleware/verifyToken.js';
import { checkRole } from '../middleware/checkRole.js';

const router = Router();

router.use(verifyToken);
router.use(checkRole(['MANAGER', 'ADMIN'])); // Only managers/admins can view dashboard

// GET /api/analytics/dashboard
router.get('/dashboard', getDashboardStats);

// GET /api/analytics/logs
router.get('/logs', getActivityLogs);

// GET /api/analytics/export/csv
router.get('/export/csv', exportSalesCSV);

export default router;
