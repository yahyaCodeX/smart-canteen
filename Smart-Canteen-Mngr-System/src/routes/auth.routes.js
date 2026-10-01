// src/routes/auth.routes.js
// Authentication Routes: /api/auth

import { Router } from 'express';
import { register, login, getMe, getAllUsers, updateUserRole, toggleUserBan } from '../controllers/auth.controller.js';
import { verifyToken } from '../middleware/verifyToken.js';
import { checkRole } from '../middleware/checkRole.js';

const router = Router();

// POST /api/auth/register  — Public
router.post('/register', register);

// POST /api/auth/login     — Public
router.post('/login', login);

// GET  /api/auth/me        — Protected
router.get('/me', verifyToken, getMe);

// GET /api/auth/users      — Admin/Manager
router.get('/users', verifyToken, checkRole(['ADMIN', 'MANAGER']), getAllUsers);

// PATCH /api/auth/users/:userId/role — Admin/Manager
router.patch('/users/:userId/role', verifyToken, checkRole(['ADMIN', 'MANAGER']), updateUserRole);

// PATCH /api/auth/users/:userId/ban — Admin/Manager
router.patch('/users/:userId/ban', verifyToken, checkRole(['ADMIN', 'MANAGER']), toggleUserBan);

export default router;
