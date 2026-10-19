const router = require('express').Router();
const { sql, getPool } = require('../db/config');
const { authenticate, requireVerified } = require('../middleware/auth');
const { getPresignedUrl, isR2Key } = require('../services/r2');
const {SCHEMA_NAME} = require('../constants')
const { serverError } = require('../utils/serverError');
const {
  CURRENCY, getRazorpay, toPaise, verifyAndCompletePayment,
} = require('../services/razorpay');

// Start a purchase. Free apps are granted immediately; paid apps get a
// Razorpay order and a 'pending' purchase that is completed only after the
// payment is verified (POST /verify or the webhook).
router.post('/order', authenticate, requireVerified, async (req, res) => {
  try {
    const appId = parseInt(req.body.appId);
    if (!appId) return res.status(400).json({ message: 'appId is required' });
    const pool = await getPool();

    // Check if already purchased
    const existing = await pool.request()
      .input('userId', sql.Int, req.user.id)
      .input('appId', sql.Int, appId)
      .query(`SELECT id FROM ${SCHEMA_NAME}.Purchases WHERE userId=@userId AND appId=@appId AND status='completed'`);

    if (existing.recordset.length)
      return res.status(409).json({ message: 'You already own this app' });

    // Get app price
    const appResult = await pool.request()
      .input('appId', sql.Int, appId)
      .query(`SELECT price, name FROM ${SCHEMA_NAME}.Apps WHERE id = @appId AND isActive = 1`);

    if (!appResult.recordset[0])
      return res.status(404).json({ message: 'App not found' });

    const { price, name } = appResult.recordset[0];

    if (Number(price) <= 0) {
      const result = await pool.request()
        .input('userId', sql.Int, req.user.id)
        .input('appId', sql.Int, appId)
        .query(`INSERT INTO ${SCHEMA_NAME}.Purchases (userId, appId, amount, paymentId, status)
                OUTPUT INSERTED.*
                VALUES (@userId, @appId, 0, 'FREE', 'completed')`);
      return res.status(201).json({ free: true, purchase: result.recordset[0] });
    }

    const amount = toPaise(price);
    const order = await getRazorpay().orders.create({
      amount,
      currency: CURRENCY,
      receipt: `u${req.user.id}_a${appId}_${Date.now()}`,
      notes: { userId: String(req.user.id), appId: String(appId) },
    });

    await pool.request()
      .input('userId', sql.Int, req.user.id)
      .input('appId', sql.Int, appId)
      .input('amount', sql.Decimal(10, 2), price)
      .input('orderId', sql.NVarChar, order.id)
      .query(`INSERT INTO ${SCHEMA_NAME}.Purchases (userId, appId, amount, orderId, status)
              VALUES (@userId, @appId, @amount, @orderId, 'pending')`);

    res.status(201).json({
      free: false,
      keyId: process.env.RAZORPAY_KEY_ID,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      appName: name,
      user: { email: req.user.email },
    });
  } catch (err) {
    serverError(res, err, 'Could not start the payment. Please try again.');
  }
});

// Verify the checkout result and complete the purchase
router.post('/verify', authenticate, async (req, res) => {
  try {
    const purchase = await verifyAndCompletePayment({
      orderId: req.body.razorpay_order_id,
      paymentId: req.body.razorpay_payment_id,
      signature: req.body.razorpay_signature,
      userId: req.user.id,
    });
    res.json({ purchase });
  } catch (err) {
    if (err.verification) return res.status(400).json({ message: err.message });
    serverError(res, err, 'Could not confirm the payment yet. If money was deducted, the app will appear in My Apps shortly.');
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
              FROM ${SCHEMA_NAME}.Purchases p
              JOIN ${SCHEMA_NAME}.Apps a ON a.id = p.appId
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
    serverError(res, err);
  }
});

// Get download links (only if purchased)
router.get('/download/:appId', authenticate, async (req, res) => {
  try {
    const pool = await getPool();

    const purchased = await pool.request()
      .input('userId', sql.Int, req.user.id)
      .input('appId', sql.Int, req.params.appId)
      .query(`SELECT id FROM ${SCHEMA_NAME}.Purchases WHERE userId=@userId AND appId=@appId AND status='completed'`);

    if (!purchased.recordset.length)
      return res.status(403).json({ message: 'Purchase this app to download' });

    const files = await pool.request()
      .input('appId', sql.Int, req.params.appId)
      .query(`SELECT apkUrl, aabUrl, codeZipUrl FROM ${SCHEMA_NAME}.AppFiles WHERE appId = @appId`);

    const row = files.recordset[0] || {};

    // R2-stored values are bare object keys → swap them for short-lived signed URLs.
    // Old Cloudinary values are already full URLs and pass through untouched.
    const names = { apkUrl: 'app.apk', aabUrl: 'app.aab', codeZipUrl: 'code.zip' };
    const signed = {};
    for (const field of Object.keys(names)) {
      const value = row[field];
      signed[field] = isR2Key(value)
        ? await getPresignedUrl(value, { downloadName: names[field] })
        : value;
    }

    res.json(signed);
  } catch (err) {
    serverError(res, err);
  }
});

module.exports = router;
