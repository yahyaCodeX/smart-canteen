// src/server/index.js
// Smart Canteen Backend API — Express Server Entry Point

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import authRoutes        from '../routes/auth.routes.js';
import menuRoutes        from '../routes/menu.routes.js';
import orderRoutes       from '../routes/order.routes.js';
import queueRoutes       from '../routes/queue.routes.js';
import intelligenceRoutes from '../routes/intelligence.routes.js';
import analyticsRoutes    from '../routes/analytics.routes.js';
import { startScheduler } from '../services/scheduler.service.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// ─────────────────────────────────────────────────────────────────────────────
// Global Middleware
// ─────────────────────────────────────────────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../../frontend/dist')));
app.use(express.static('public'));

// ─────────────────────────────────────────────────────────────────────────────
// API Routes
// ─────────────────────────────────────────────────────────────────────────────
app.use('/api/auth',         authRoutes);
app.use('/api/menu',         menuRoutes);
app.use('/api/orders',       orderRoutes);
app.use('/api/queue',        queueRoutes);
app.use('/api/intelligence', intelligenceRoutes);
app.use('/api/analytics',    analyticsRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    service: 'Smart Canteen API',
    version: '1.0.0',
    routes: ['/api/auth', '/api/menu', '/api/orders', '/api/queue', '/api/intelligence'],
    timestamp: new Date().toISOString(),
  });
});

// 404 handler for API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({ success: false, error: `Route ${req.originalUrl} not found.` });
});

// Fallback to React app for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../frontend/dist/index.html'));
});

// Global error handler
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ success: false, error: 'Internal server error.' });
});

// ─────────────────────────────────────────────────────────────────────────────
// Start Server + Background Scheduler
// ─────────────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('🍽️  Smart Canteen API — Running');
  console.log(`   ➜  Local:    http://localhost:${PORT}`);
  console.log(`   ➜  Health:   http://localhost:${PORT}/api/health`);
  console.log(`   ➜  Menu:     http://localhost:${PORT}/api/menu`);
  console.log(`   ➜  Orders:   http://localhost:${PORT}/api/orders`);
  console.log(`   ➜  Queue:    http://localhost:${PORT}/api/queue`);
  console.log(`   ➜  Intel:    http://localhost:${PORT}/api/intelligence`);
  console.log('');

  // Start the background queue scheduler (delay detection, activation, not-collected)
  startScheduler();
});

export default app;
