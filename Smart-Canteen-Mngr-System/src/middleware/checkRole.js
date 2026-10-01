// src/middleware/checkRole.js
// Role-Based Access Control (RBAC) Middleware
// Must be used AFTER verifyToken middleware in the chain

/**
 * checkRole(allowedRoles)
 * -----------------------
 * Factory function that returns middleware enforcing role-based access.
 *
 * Usage:
 *   router.get('/manager-stats', verifyToken, checkRole(['MANAGER', 'ADMIN']), handler);
 *
 * @param {string[]} allowedRoles - Array of permitted role strings
 * @returns Express middleware function
 */
export function checkRole(allowedRoles) {
  if (!Array.isArray(allowedRoles) || allowedRoles.length === 0) {
    throw new Error('checkRole() requires a non-empty array of role strings.');
  }

  return (req, res, next) => {
    // req.user must be set by verifyToken first
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required before role check.',
      });
    }

    const { role } = req.user;

    if (!allowedRoles.includes(role)) {
      return res.status(403).json({
        success: false,
        error: `Access forbidden. Required role(s): [${allowedRoles.join(', ')}]. Your role: ${role}.`,
      });
    }

    next();
  };
}
