const router = require('express').Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { sql, getPool } = require('../db/config');
const rateLimit = require('express-rate-limit');
const { authenticate, isAdmin } = require('../middleware/auth');
const { SCHEMA_NAME } = require('../constants');
const { serverError } = require('../utils/serverError');
const { sendEmail, codeEmail } = require('../services/mailer');
const { CODE_TTL_MINUTES, cooldownRemaining, issueCode, consumeCode } = require('../services/authCodes');

const MIN_PASSWORD = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// `tv` ties the token to Users.tokenVersion — bumping it logs out every device
const signToken = (user) =>
  jwt.sign(
    { id: user.id, email: user.email, role: user.role, tv: user.tokenVersion || 0 },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );

const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  emailVerified: !!u.emailVerified,
  createdAt: u.createdAt,
});

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

const findUserByEmail = async (email) => {
  const pool = await getPool();
  const result = await pool.request()
    .input('email', sql.NVarChar, email)
    .query(`SELECT * FROM ${SCHEMA_NAME}.Users WHERE email = @email AND deletedAt IS NULL`);
  return result.recordset[0];
};

const sendCode = async (user, purpose) => {
  const code = await issueCode(user.id, purpose);
  const content = purpose === 'verify'
    ? codeEmail({
      heading: 'Verify your email',
      intro: `Hi ${user.name}, enter this code in the Appure app to confirm your email address.`,
      code, minutes: CODE_TTL_MINUTES,
    })
    : codeEmail({
      heading: 'Reset your password',
      intro: `Hi ${user.name}, enter this code in the Appure app to choose a new password.`,
      code, minutes: CODE_TTL_MINUTES,
    });
  await sendEmail({
    to: user.email,
    subject: purpose === 'verify' ? `${code} is your Appure verification code` : 'Reset your Appure password',
    ...content,
  });
};

// Per-IP limits against password guessing, signup spam and email flooding
const limit = (windowMinutes, max, message, extra = {}) => rateLimit({
  windowMs: windowMinutes * 60 * 1000,
  limit: max,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ message }),
  ...extra,
});
const loginLimiter = limit(15, 10, 'Too many login attempts. Please try again in 15 minutes.',
  { skipSuccessfulRequests: true }); // only failed attempts count
const registerLimiter = limit(60, 5, 'Too many accounts created from this network. Please try again later.');
const emailLimiter = limit(15, 5, 'Too many emails requested. Please try again in 15 minutes.');
const codeLimiter = limit(15, 20, 'Too many attempts. Please try again in 15 minutes.');

// Register — account starts unverified and a code is emailed
router.post('/register', registerLimiter, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = normalizeEmail(req.body.email);
    const { password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ message: 'All fields required' });
    if (!EMAIL_RE.test(email) || email.length > 150)
      return res.status(400).json({ message: 'Please enter a valid email address' });
    if (name.length > 100)
      return res.status(400).json({ message: 'Name is too long' });
    if (String(password).length < MIN_PASSWORD)
      return res.status(400).json({ message: `Password must be at least ${MIN_PASSWORD} characters` });

    if (await findUserByEmail(email))
      return res.status(409).json({ message: 'Email already registered. Try signing in or resetting your password.' });

    const pool = await getPool();
    const hashed = await bcrypt.hash(password, 10);
    const result = await pool.request()
      .input('name', sql.NVarChar, name)
      .input('email', sql.NVarChar, email)
      .input('password', sql.NVarChar, hashed)
      .query(`INSERT INTO ${SCHEMA_NAME}.Users (name, email, password) OUTPUT INSERTED.* VALUES (@name, @email, @password)`);

    const user = result.recordset[0];
    // Account exists even if the email fails — the user can tap "Resend code"
    await sendCode(user, 'verify').catch((err) => console.error('Verification email failed:', err.message));

    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    serverError(res, err);
  }
});

// Login
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const { password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: 'Email and password required' });

    const user = await findUserByEmail(email);
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ message: 'Invalid credentials' });

    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    serverError(res, err);
  }
});

// Get profile
router.get('/profile', authenticate, async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('id', sql.Int, req.user.id)
      .query(`SELECT id, name, email, role, emailVerified, createdAt FROM ${SCHEMA_NAME}.Users WHERE id = @id`);
    if (!result.recordset[0]) return res.status(404).json({ message: 'User not found' });
    res.json({ user: publicUser(result.recordset[0]) });
  } catch (err) {
    serverError(res, err);
  }
});

// Confirm email with the 6-digit code
router.post('/verify-email', authenticate, codeLimiter, async (req, res) => {
  try {
    if (req.user.emailVerified) return res.json({ message: 'Email already verified' });

    if (!(await consumeCode(req.user.id, 'verify', req.body.code)))
      return res.status(400).json({ message: 'Invalid or expired code' });

    const pool = await getPool();
    const result = await pool.request()
      .input('id', sql.Int, req.user.id)
      .query(`UPDATE ${SCHEMA_NAME}.Users SET emailVerified = 1 OUTPUT INSERTED.* WHERE id = @id`);
    res.json({ user: publicUser(result.recordset[0]) });
  } catch (err) {
    serverError(res, err);
  }
});

router.post('/resend-verification', authenticate, emailLimiter, async (req, res) => {
  try {
    if (req.user.emailVerified) return res.json({ message: 'Email already verified' });

    const wait = await cooldownRemaining(req.user.id, 'verify');
    if (wait > 0) return res.status(429).json({ message: `Please wait ${wait}s before requesting another code`, retryAfter: wait });

    const pool = await getPool();
    const result = await pool.request()
      .input('id', sql.Int, req.user.id)
      .query(`SELECT id, name, email FROM ${SCHEMA_NAME}.Users WHERE id = @id`);
    await sendCode(result.recordset[0], 'verify');
    res.json({ message: 'A new code has been sent to your email' });
  } catch (err) {
    serverError(res, err, 'Could not send the email. Please try again.');
  }
});

// Forgot password — same answer whether or not the email exists (no account probing)
router.post('/forgot-password', emailLimiter, async (req, res) => {
  const message = 'If an account exists for this email, a reset code has been sent.';
  try {
    const email = normalizeEmail(req.body.email);
    if (!EMAIL_RE.test(email)) return res.status(400).json({ message: 'Please enter a valid email address' });

    const user = await findUserByEmail(email);
    if (user && (await cooldownRemaining(user.id, 'reset')) === 0) {
      await sendCode(user, 'reset');
    }
    res.json({ message });
  } catch (err) {
    serverError(res, err, 'Could not send the email. Please try again.');
  }
});

// Reset with the emailed code → new password, every other device logged out, signed in here
router.post('/reset-password', codeLimiter, async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const { code, password } = req.body;
    if (!email || !code || !password)
      return res.status(400).json({ message: 'Email, code and new password are required' });
    if (String(password).length < MIN_PASSWORD)
      return res.status(400).json({ message: `Password must be at least ${MIN_PASSWORD} characters` });

    const user = await findUserByEmail(email);
    if (!user || !(await consumeCode(user.id, 'reset', code)))
      return res.status(400).json({ message: 'Invalid or expired code' });

    const pool = await getPool();
    const result = await pool.request()
      .input('id', sql.Int, user.id)
      .input('password', sql.NVarChar, await bcrypt.hash(password, 10))
      // The code proved they own the inbox, so the email is verified too
      .query(`UPDATE ${SCHEMA_NAME}.Users
              SET password = @password, tokenVersion = tokenVersion + 1, emailVerified = 1
              OUTPUT INSERTED.* WHERE id = @id`);

    const updated = result.recordset[0];
    res.json({ token: signToken(updated), user: publicUser(updated) });
  } catch (err) {
    serverError(res, err);
  }
});

// Delete account (Play Store requirement). Personal data is erased; the purchase
// rows stay, unlinked from any identity, for payment/tax records.
router.delete('/account', authenticate, async (req, res) => {
  try {
    if (isAdmin(req.user))
      return res.status(403).json({ message: 'Admin accounts cannot be deleted from the app' });

    const pool = await getPool();
    const result = await pool.request()
      .input('id', sql.Int, req.user.id)
      .query(`SELECT password FROM ${SCHEMA_NAME}.Users WHERE id = @id`);
    if (!(await bcrypt.compare(String(req.body?.password || ''), result.recordset[0].password)))
      return res.status(400).json({ message: 'Incorrect password' }); // not 401: the app treats 401 as signed out

    const unusable = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
    await pool.request()
      .input('id', sql.Int, req.user.id)
      .input('email', sql.NVarChar, `deleted_${req.user.id}_${Date.now()}@deleted.invalid`)
      .input('password', sql.NVarChar, unusable)
      .query(`DELETE FROM ${SCHEMA_NAME}.AuthCodes WHERE userId = @id;
              DELETE FROM ${SCHEMA_NAME}.Reviews WHERE userId = @id;
              UPDATE ${SCHEMA_NAME}.Users
              SET name = 'Deleted user', email = @email, password = @password,
                  emailVerified = 0, tokenVersion = tokenVersion + 1, deletedAt = GETUTCDATE()
              WHERE id = @id;`);

    res.json({ message: 'Your account has been deleted' });
  } catch (err) {
    serverError(res, err);
  }
});

module.exports = router;
