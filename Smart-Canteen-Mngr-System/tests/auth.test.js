// tests/auth.test.js
// Unit & Integration Tests — Authentication & RBAC Middleware
// Run: npm test

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';

// ─── Set env before importing modules ────────────────────────────────────────
process.env.JWT_SECRET = 'test_secret_key_for_unit_tests';
process.env.JWT_EXPIRES_IN = '1h';

// ─── Dynamic import after env set ────────────────────────────────────────────
const { verifyToken } = await import('../src/middleware/verifyToken.js');
const { checkRole }   = await import('../src/middleware/checkRole.js');

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Build mock Express req/res/next objects
// ─────────────────────────────────────────────────────────────────────────────
function makeReqResNext({ headers = {}, user = null } = {}) {
  const req = { headers, user };
  const res = {
    _status: 200,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body)   { this._body = body;   return this; },
  };
  const next = vi.fn();
  return { req, res, next };
}

function makeValidToken(payload = {}) {
  return jwt.sign(
    { user_id: 'test-uuid', email: 'test@test.com', name: 'Test User', role: 'CUSTOMER', ...payload },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: verifyToken Middleware
// ─────────────────────────────────────────────────────────────────────────────
describe('verifyToken middleware', () => {

  it('should return 401 when no Authorization header is provided', () => {
    const { req, res, next } = makeReqResNext({ headers: {} });
    verifyToken(req, res, next);

    expect(res._status).toBe(401);
    expect(res._body.success).toBe(false);
    expect(res._body.error).toContain('No authentication token');
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 when header does not start with "Bearer "', () => {
    const { req, res, next } = makeReqResNext({
      headers: { authorization: 'Token abc123' },
    });
    verifyToken(req, res, next);

    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 for a malformed / invalid JWT', () => {
    const { req, res, next } = makeReqResNext({
      headers: { authorization: 'Bearer this.is.not.a.valid.token' },
    });
    verifyToken(req, res, next);

    expect(res._status).toBe(401);
    expect(res._body.error).toContain('Invalid token');
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 for an expired JWT', () => {
    const expiredToken = jwt.sign(
      { user_id: 'test', role: 'CUSTOMER' },
      process.env.JWT_SECRET,
      { expiresIn: '-1s' } // Already expired
    );
    const { req, res, next } = makeReqResNext({
      headers: { authorization: `Bearer ${expiredToken}` },
    });
    verifyToken(req, res, next);

    expect(res._status).toBe(401);
    expect(res._body.error).toContain('expired');
    expect(next).not.toHaveBeenCalled();
  });

  it('should call next() and set req.user for a valid JWT', () => {
    const token = makeValidToken({ role: 'MANAGER' });
    const { req, res, next } = makeReqResNext({
      headers: { authorization: `Bearer ${token}` },
    });
    verifyToken(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.user).toBeDefined();
    expect(req.user.role).toBe('MANAGER');
    expect(req.user.email).toBe('test@test.com');
  });

  it('should decode all JWT payload fields correctly', () => {
    const token = makeValidToken({
      user_id: 'uuid-123',
      email: 'alice@demo.com',
      name: 'Alice',
      role: 'STAFF',
    });
    const { req, res, next } = makeReqResNext({
      headers: { authorization: `Bearer ${token}` },
    });
    verifyToken(req, res, next);

    expect(req.user.user_id).toBe('uuid-123');
    expect(req.user.email).toBe('alice@demo.com');
    expect(req.user.name).toBe('Alice');
    expect(req.user.role).toBe('STAFF');
    expect(next).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: checkRole Middleware — RBAC Enforcement
// ─────────────────────────────────────────────────────────────────────────────
describe('checkRole middleware', () => {

  it('should throw when called without an array argument', () => {
    expect(() => checkRole()).toThrow();
    expect(() => checkRole([])).toThrow();
    expect(() => checkRole('MANAGER')).toThrow();
  });

  it('should return 401 when req.user is not set (no verifyToken)', () => {
    const middleware = checkRole(['MANAGER']);
    const { req, res, next } = makeReqResNext({ user: null });
    middleware(req, res, next);

    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 403 when CUSTOMER tries to access a MANAGER route', () => {
    const middleware = checkRole(['MANAGER', 'ADMIN']);
    const { req, res, next } = makeReqResNext({
      user: { user_id: 'cust-1', role: 'CUSTOMER', email: 'customer@demo.com' },
    });
    middleware(req, res, next);

    expect(res._status).toBe(403);
    expect(res._body.success).toBe(false);
    expect(res._body.error).toContain('MANAGER');
    expect(res._body.error).toContain('CUSTOMER');
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 403 when CUSTOMER tries to access STAFF-only route', () => {
    const middleware = checkRole(['STAFF']);
    const { req, res, next } = makeReqResNext({
      user: { role: 'CUSTOMER' },
    });
    middleware(req, res, next);

    expect(res._status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 403 when STAFF tries to access MANAGER-only route', () => {
    const middleware = checkRole(['MANAGER', 'ADMIN']);
    const { req, res, next } = makeReqResNext({
      user: { role: 'STAFF' },
    });
    middleware(req, res, next);

    expect(res._status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('should call next() when MANAGER accesses a MANAGER route', () => {
    const middleware = checkRole(['MANAGER', 'ADMIN']);
    const { req, res, next } = makeReqResNext({
      user: { role: 'MANAGER' },
    });
    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res._status).toBe(200); // unchanged
  });

  it('should call next() when ADMIN accesses a MANAGER route (ADMIN can do everything)', () => {
    const middleware = checkRole(['MANAGER', 'ADMIN']);
    const { req, res, next } = makeReqResNext({
      user: { role: 'ADMIN' },
    });
    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('should call next() when STAFF accesses a multi-role route that includes STAFF', () => {
    const middleware = checkRole(['STAFF', 'MANAGER', 'ADMIN']);
    const { req, res, next } = makeReqResNext({
      user: { role: 'STAFF' },
    });
    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('should call next() when CUSTOMER accesses a CUSTOMER route', () => {
    const middleware = checkRole(['CUSTOMER']);
    const { req, res, next } = makeReqResNext({
      user: { role: 'CUSTOMER' },
    });
    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  // ── Critical hackathon guard: Confirm Customer → Manager blocked ────────────
  it('CRITICAL: CUSTOMER must not be able to access Manager Analytics dashboard route', () => {
    // Simulates full middleware chain: verifyToken -> checkRole
    const token = makeValidToken({ role: 'CUSTOMER' });

    // Step 1: verifyToken
    const { req: req1, res: res1, next: next1 } = makeReqResNext({
      headers: { authorization: `Bearer ${token}` },
    });
    verifyToken(req1, res1, next1);
    expect(next1).toHaveBeenCalledOnce(); // token is valid

    // Step 2: checkRole(['MANAGER'])
    const middleware = checkRole(['MANAGER', 'ADMIN']);
    const { req: req2, res: res2, next: next2 } = makeReqResNext({
      user: req1.user,
    });
    middleware(req2, res2, next2);

    // CUSTOMER must be blocked at role gate
    expect(res2._status).toBe(403);
    expect(next2).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: Password Hashing Verification
// ─────────────────────────────────────────────────────────────────────────────
describe('bcrypt password hash validation', () => {
  it('should correctly verify a bcrypt hashed password', async () => {
    const bcrypt = await import('bcryptjs');
    const password = 'demo123';
    const hash = await bcrypt.default.hash(password, 10);

    const isMatch = await bcrypt.default.compare(password, hash);
    const isWrong = await bcrypt.default.compare('wrongpassword', hash);

    expect(isMatch).toBe(true);
    expect(isWrong).toBe(false);
  });

  it('should never store plaintext passwords (hash should differ from input)', async () => {
    const bcrypt = await import('bcryptjs');
    const password = 'demo123';
    const hash = await bcrypt.default.hash(password, 10);

    expect(hash).not.toBe(password);
    expect(hash.startsWith('$2')).toBe(true); // bcrypt hash prefix
  });
});
