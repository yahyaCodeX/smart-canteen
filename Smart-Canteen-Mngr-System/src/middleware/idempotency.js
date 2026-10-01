// src/middleware/idempotency.js
// Idempotency-Key Middleware — Duplicate Order Submission Prevention
// Checks PostgreSQL cache table; if key was already used, returns saved response.

import pool from '../db/pool.js';

/**
 * checkIdempotency
 * ----------------
 * Reads the `Idempotency-Key` header from the request.
 * - If the key exists in the cache and hasn't expired → return saved response.
 * - If the key is new → attach helpers to req and let the request proceed.
 *
 * After the handler runs, call req.saveIdempotentResponse(body) to persist.
 *
 * Usage on order placement routes:
 *   router.post('/orders', verifyToken, checkIdempotency, createOrderHandler);
 */
export async function checkIdempotency(req, res, next) {
  const idempotencyKey = req.headers['idempotency-key'];

  // If no key provided on order-sensitive routes, reject
  if (!idempotencyKey) {
    return res.status(400).json({
      success: false,
      error: 'Idempotency-Key header is required for this endpoint. Generate a UUID on the client and include it.',
    });
  }

  // Sanitize key length
  if (idempotencyKey.length > 255) {
    return res.status(400).json({
      success: false,
      error: 'Idempotency-Key must be 255 characters or fewer.',
    });
  }

  try {
    // Check if key already exists and hasn't expired
    const { rows } = await pool.query(
      `SELECT response_body FROM idempotency_cache
       WHERE key = $1 AND expires_at > NOW()`,
      [idempotencyKey]
    );

    if (rows.length > 0) {
      // Key found — return the original response (prevents double submission)
      console.log(`⚠️  Idempotency key replay detected: ${idempotencyKey}`);
      return res.status(200).json({
        ...rows[0].response_body,
        _idempotent: true, // Signal to client this was a replay
      });
    }

    // Key is new — attach key and save function to req
    req.idempotencyKey = idempotencyKey;
    req.userId = req.user?.user_id;

    /**
     * Call this in your route handler after a successful operation to
     * cache the response body and prevent future duplicates.
     */
    req.saveIdempotentResponse = async (responseBody) => {
      await pool.query(
        `INSERT INTO idempotency_cache (key, user_id, response_body)
         VALUES ($1, $2, $3)
         ON CONFLICT (key) DO NOTHING`,
        [idempotencyKey, req.userId, JSON.stringify(responseBody)]
      );
    };

    next();
  } catch (err) {
    console.error('Idempotency middleware error:', err.message);
    // Fail open (allow request through) to avoid blocking all orders on DB error
    req.saveIdempotentResponse = async () => {};
    next();
  }
}
