// src/middleware/verifyToken.js
// JWT Authentication Middleware
// Validates Bearer token and attaches decoded user payload to req.user

import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

/**
 * verifyToken
 * -----------
 * Extracts and validates a Bearer JWT from the Authorization header.
 * On success: attaches { user_id, email, role, name } to req.user
 * On failure: returns 401
 */
export function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'Access denied. No authentication token provided.',
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { user_id, email, role, name, iat, exp }
    next();
  } catch (err) {
    const message =
      err.name === 'TokenExpiredError'
        ? 'Token has expired. Please log in again.'
        : 'Invalid token. Access denied.';

    return res.status(401).json({ success: false, error: message });
  }
}
