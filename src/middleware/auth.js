const jwt = require('jsonwebtoken');
const { sql, getPool } = require('../db/config');
const { SCHEMA_NAME } = require('../constants');

// Verifies the JWT and re-reads the user, so a deleted account or a bumped
// tokenVersion (password reset, "log out everywhere") ends old sessions at once.
// Tokens issued before tokenVersion existed carry no `tv` and count as version 0.
const resolveUser = async (authHeader) => {
  if (!authHeader?.startsWith('Bearer ')) return null;
  let payload;
  try {
    payload = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
  } catch {
    return null;
  }

  const pool = await getPool();
  const result = await pool.request()
    .input('id', sql.Int, payload.id)
    .query(`SELECT id, email, role, emailVerified, tokenVersion, deletedAt
            FROM ${SCHEMA_NAME}.Users WHERE id = @id`);
  const user = result.recordset[0];
  if (!user || user.deletedAt || user.tokenVersion !== (payload.tv || 0)) return null;

  return { id: user.id, email: user.email, role: user.role, emailVerified: !!user.emailVerified };
};

const authenticate = async (req, res, next) => {
  if (!req.headers.authorization?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided' });
  }
  try {
    req.user = await resolveUser(req.headers.authorization);
  } catch (err) {
    return next(err);
  }
  if (!req.user) return res.status(401).json({ message: 'Session expired. Please log in again.' });
  next();
};

// For public routes that show extra data to signed-in users: sets req.user
// when a valid token is sent, otherwise continues anonymously.
const optionalAuth = async (req, res, next) => {
  try {
    req.user = (await resolveUser(req.headers.authorization)) || undefined;
  } catch {
    req.user = undefined;
  }
  next();
};

const isAdmin = (user) => user?.role?.trim().toLowerCase() === 'admin';

const adminOnly = (req, res, next) => {
  if (!isAdmin(req.user)) {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
};

// Buying / reviewing needs a confirmed email address
const requireVerified = (req, res, next) => {
  if (!req.user?.emailVerified) {
    return res.status(403).json({ code: 'EMAIL_NOT_VERIFIED', message: 'Please verify your email first.' });
  }
  next();
};

module.exports = { authenticate, optionalAuth, adminOnly, isAdmin, requireVerified };
