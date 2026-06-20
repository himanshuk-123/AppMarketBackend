const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { sql, getPool } = require('../db/config');
const { authenticate } = require('../middleware/auth');

const signToken = (user) =>
  jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );

// Register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ message: 'All fields required' });

    const pool = await getPool();

    const existing = await pool.request()
      .input('email', sql.NVarChar, email)
      .query('SELECT id FROM AppMarket.Users WHERE email = @email');
    if (existing.recordset.length)
      return res.status(409).json({ message: 'Email already registered' });

    const hashed = await bcrypt.hash(password, 10);
    const result = await pool.request()
      .input('name', sql.NVarChar, name)
      .input('email', sql.NVarChar, email)
      .input('password', sql.NVarChar, hashed)
      .query('INSERT INTO AppMarket.Users (name, email, password) OUTPUT INSERTED.* VALUES (@name, @email, @password)');

    const user = result.recordset[0];
    delete user.password;
    res.status(201).json({ token: signToken(user), user });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: 'Email and password required' });

    const pool = await getPool();
    const result = await pool.request()
      .input('email', sql.NVarChar, email)
      .query('SELECT * FROM AppMarket.Users WHERE email = @email');

    const user = result.recordset[0];
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ message: 'Invalid credentials' });

    delete user.password;
    res.json({ token: signToken(user), user });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get profile
router.get('/profile', authenticate, async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('id', sql.Int, req.user.id)
      .query('SELECT id, name, email, role, createdAt FROM AppMarket.Users WHERE id = @id');
    if (!result.recordset[0]) return res.status(404).json({ message: 'User not found' });
    res.json({ user: result.recordset[0] });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
