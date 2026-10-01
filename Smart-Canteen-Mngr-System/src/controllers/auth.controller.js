// src/controllers/auth.controller.js
// Authentication: Register & Login handlers

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import pool from '../db/pool.js';

dotenv.config();

const SALT_ROUNDS = 10;

/**
 * generateToken(user)
 * -------------------
 * Signs a JWT containing user_id, email, name, role.
 * @param {object} user
 * @returns {string} signed JWT
 */
function generateToken(user) {
  return jwt.sign(
    {
      user_id: user.user_id,
      email:   user.email,
      name:    user.name,
      role:    user.role,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/register
// ─────────────────────────────────────────────────────────────────────────────
export async function register(req, res) {
  const { name, email, password, role } = req.body;

  // ── Validation ──────────────────────────────────────────────────────────────
  if (!name || !email || !password) {
    return res.status(400).json({
      success: false,
      error: 'name, email, and password are required.',
    });
  }

  if (password.length < 6) {
    return res.status(400).json({
      success: false,
      error: 'Password must be at least 6 characters.',
    });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ success: false, error: 'Invalid email format.' });
  }

  // Only ADMIN can self-register other admins — default new registrations to CUSTOMER
  const allowedPublicRoles = ['CUSTOMER'];
  const assignedRole = allowedPublicRoles.includes(role?.toUpperCase())
    ? role.toUpperCase()
    : 'CUSTOMER';

  try {
    // ── Check for duplicate email ────────────────────────────────────────────
    const existing = await pool.query(
      'SELECT user_id FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'An account with this email already exists.',
      });
    }

    // ── Hash password & insert ───────────────────────────────────────────────
    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

    const { rows } = await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING user_id, name, email, role, account_status, created_at`,
      [name.trim(), email.toLowerCase().trim(), password_hash, assignedRole]
    );

    const newUser = rows[0];
    const token = generateToken(newUser);

    return res.status(201).json({
      success: true,
      message: 'Account created successfully.',
      token,
      user: {
        user_id:        newUser.user_id,
        name:           newUser.name,
        email:          newUser.email,
        role:           newUser.role,
        account_status: newUser.account_status,
      },
    });
  } catch (err) {
    console.error('Register error:', err.message);
    return res.status(500).json({ success: false, error: 'Internal server error.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/login
// ─────────────────────────────────────────────────────────────────────────────
export async function login(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      error: 'email and password are required.',
    });
  }

  try {
    const { rows } = await pool.query(
      `SELECT user_id, name, email, password_hash, role, account_status
       FROM users WHERE email = $1`,
      [email.toLowerCase().trim()]
    );

    if (rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials.',
      });
    }

    const user = rows[0];

    if (user.account_status === 'SUSPENDED') {
      return res.status(403).json({
        success: false,
        error: 'Your account has been suspended. Contact the administrator.',
      });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials.',
      });
    }

    const token = generateToken(user);

    return res.status(200).json({
      success: true,
      message: `Welcome back, ${user.name}!`,
      token,
      user: {
        user_id: user.user_id,
        name:    user.name,
        email:   user.email,
        role:    user.role,
      },
    });
  } catch (err) {
    console.error('Login error:', err.message);
    return res.status(500).json({ success: false, error: 'Internal server error.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/auth/me  (protected)
// Returns current user profile from token
// ─────────────────────────────────────────────────────────────────────────────
export async function getMe(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT user_id, name, email, role, account_status, created_at
       FROM users WHERE user_id = $1`,
      [req.user.user_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    return res.status(200).json({ success: true, user: rows[0] });
  } catch (err) {
    console.error('GetMe error:', err.message);
    return res.status(500).json({ success: false, error: 'Internal server error.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/auth/users (ADMIN ONLY)
// ─────────────────────────────────────────────────────────────────────────────
export async function getAllUsers(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT user_id, name, email, role, account_status, created_at 
       FROM users 
       ORDER BY created_at DESC`
    );
    return res.json({ success: true, users: rows });
  } catch (err) {
    console.error('getAllUsers error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch users.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/auth/users/:userId/role (ADMIN ONLY)
// ─────────────────────────────────────────────────────────────────────────────
export async function updateUserRole(req, res) {
  try {
    const { userId } = req.params;
    const { role } = req.body;
    
    if (!['CUSTOMER', 'STAFF', 'MANAGER', 'ADMIN'].includes(role)) {
      return res.status(400).json({ success: false, error: 'Invalid role.' });
    }

    const { rows } = await pool.query(
      `UPDATE users SET role = $1 WHERE user_id = $2 RETURNING user_id, name, email, role`,
      [role, userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    return res.json({ success: true, user: rows[0] });
  } catch (err) {
    console.error('updateUserRole error:', err);
    return res.status(500).json({ success: false, error: 'Failed to update role.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/auth/users/:userId/ban (ADMIN ONLY)
// ─────────────────────────────────────────────────────────────────────────────
export async function toggleUserBan(req, res) {
  try {
    const { userId } = req.params;

    const { rows: userRows } = await pool.query(`SELECT account_status FROM users WHERE user_id = $1`, [userId]);
    if (userRows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    const currentStatus = userRows[0].account_status;
    const newStatus = currentStatus === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';

    const { rows } = await pool.query(
      `UPDATE users SET account_status = $1 WHERE user_id = $2 RETURNING user_id, account_status`,
      [newStatus, userId]
    );

    return res.json({ success: true, user: rows[0] });
  } catch (err) {
    console.error('toggleUserBan error:', err);
    return res.status(500).json({ success: false, error: 'Failed to toggle ban status.' });
  }
}
