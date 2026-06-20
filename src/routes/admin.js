const router = require('express').Router();
const { sql, getPool } = require('../db/config');
const { authenticate, adminOnly } = require('../middleware/auth');

router.use(authenticate, adminOnly);

// Dashboard stats
router.get('/stats', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT
        (SELECT COUNT(*) FROM AppMarket.Apps WHERE isActive = 1) AS apps,
        (SELECT COUNT(*) FROM AppMarket.Purchases WHERE status = 'completed') AS orders,
        (SELECT COUNT(*) FROM AppMarket.Users WHERE role = 'user') AS users,
        (SELECT ISNULL(SUM(amount), 0) FROM AppMarket.Purchases WHERE status = 'completed') AS revenue
    `);
    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// All orders
router.get('/orders', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT p.*, a.name as [app.name], u.name as [user.name], u.email as [user.email]
      FROM AppMarket.Purchases p
      JOIN AppMarket.Apps a ON a.id = p.appId
      JOIN AppMarket.Users u ON u.id = p.userId
      ORDER BY p.purchasedAt DESC
    `);
    const orders = result.recordset.map((row) => ({
      id: row.id,
      amount: row.amount,
      status: row.status,
      purchasedAt: row.purchasedAt,
      app: { name: row['app.name'] },
      user: { name: row['user.name'], email: row['user.email'] },
    }));
    res.json({ orders });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// All users
router.get('/users', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT u.id, u.name, u.email, u.createdAt,
             (SELECT COUNT(*) FROM AppMarket.Purchases p WHERE p.userId = u.id AND p.status = 'completed') AS purchaseCount
      FROM AppMarket.Users u
      WHERE u.role = 'user'
      ORDER BY u.createdAt DESC
    `);
    res.json({ users: result.recordset });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
