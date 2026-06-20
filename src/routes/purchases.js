const router = require('express').Router();
const { sql, getPool } = require('../db/config');
const { authenticate } = require('../middleware/auth');

// Buy an app (dummy payment — marks as completed instantly)
router.post('/', authenticate, async (req, res) => {
  try {
    const { appId } = req.body;
    const pool = await getPool();

    // Check if already purchased
    const existing = await pool.request()
      .input('userId', sql.Int, req.user.id)
      .input('appId', sql.Int, appId)
      .query(`SELECT id FROM AppMarket.Purchases WHERE userId=@userId AND appId=@appId AND status='completed'`);

    if (existing.recordset.length)
      return res.status(409).json({ message: 'You already own this app' });

    // Get app price
    const appResult = await pool.request()
      .input('appId', sql.Int, appId)
      .query('SELECT price FROM AppMarket.Apps WHERE id = @appId AND isActive = 1');

    if (!appResult.recordset[0])
      return res.status(404).json({ message: 'App not found' });

    const { price } = appResult.recordset[0];

    const result = await pool.request()
      .input('userId', sql.Int, req.user.id)
      .input('appId', sql.Int, appId)
      .input('amount', sql.Decimal(10, 2), price)
      .input('paymentId', sql.NVarChar, `DUMMY_${Date.now()}`)
      .query(`INSERT INTO AppMarket.Purchases (userId, appId, amount, paymentId, status)
              OUTPUT INSERTED.*
              VALUES (@userId, @appId, @amount, @paymentId, 'completed')`);

    res.status(201).json({ purchase: result.recordset[0] });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get my purchases
router.get('/my', authenticate, async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('userId', sql.Int, req.user.id)
      .query(`SELECT p.*, a.name as [app.name], a.thumbnail as [app.thumbnail],
              a.category as [app.category]
              FROM AppMarket.Purchases p
              JOIN AppMarket.Apps a ON a.id = p.appId
              WHERE p.userId = @userId AND p.status = 'completed'
              ORDER BY p.purchasedAt DESC`);

    // Re-shape to nested app object
    const purchases = result.recordset.map((row) => ({
      id: row.id,
      appId: row.appId,
      amount: row.amount,
      status: row.status,
      purchasedAt: row.purchasedAt,
      app: {
        name: row['app.name'],
        thumbnail: row['app.thumbnail'],
        category: row['app.category'],
      },
    }));

    res.json({ purchases });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get download links (only if purchased)
router.get('/download/:appId', authenticate, async (req, res) => {
  try {
    const pool = await getPool();

    const purchased = await pool.request()
      .input('userId', sql.Int, req.user.id)
      .input('appId', sql.Int, req.params.appId)
      .query(`SELECT id FROM AppMarket.Purchases WHERE userId=@userId AND appId=@appId AND status='completed'`);

    if (!purchased.recordset.length)
      return res.status(403).json({ message: 'Purchase this app to download' });

    const files = await pool.request()
      .input('appId', sql.Int, req.params.appId)
      .query('SELECT apkUrl, aabUrl, codeZipUrl FROM AppMarket.AppFiles WHERE appId = @appId');

    res.json(files.recordset[0] || {});
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
