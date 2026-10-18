const crypto = require('crypto');
const Razorpay = require('razorpay');
const { sql, getPool } = require('../db/config');
const { SCHEMA_NAME } = require('../constants');

const CURRENCY = 'INR';

let instance = null;
const getRazorpay = () => {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    throw new Error('Razorpay is not configured — set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET');
  }
  if (!instance) {
    instance = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return instance;
};

// Rupees (DECIMAL from SQL) → paise (integer Razorpay expects)
const toPaise = (amount) => Math.round(Number(amount) * 100);

// Errors from our own checks (bad signature, wrong amount, unpaid) — as opposed
// to network / Razorpay API errors, where the payment may still be fine.
const verificationError = (message) => Object.assign(new Error(message), { verification: true });

const safeEqual = (a, b) => {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
};

// Checkout handler signature: HMAC_SHA256(order_id + "|" + payment_id, key_secret)
const verifyPaymentSignature = ({ orderId, paymentId, signature }) => {
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  return safeEqual(expected, signature);
};

// Webhook signature: HMAC_SHA256(raw request body, webhook_secret)
const verifyWebhookSignature = (rawBody, signature) => {
  if (!process.env.RAZORPAY_WEBHOOK_SECRET) return false;
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  return safeEqual(expected, signature);
};

// Make sure the money is actually ours: capture an authorized payment so it
// isn't auto-refunded, and reject anything that doesn't match the order.
const ensureCaptured = async (payment, { orderId, amount }) => {
  if (payment.order_id !== orderId) throw verificationError('Payment does not belong to this order');
  if (Number(payment.amount) !== Number(amount)) throw verificationError('Payment amount mismatch');
  if (payment.status === 'captured') return payment;
  if (payment.status === 'authorized') {
    return getRazorpay().payments.capture(payment.id, payment.amount, payment.currency);
  }
  throw verificationError(`Payment not successful (status: ${payment.status})`);
};

// Idempotent: flips a pending purchase to completed. Called from both the
// client verify endpoint and the webhook, whichever arrives first.
const markPurchaseCompleted = async ({ orderId, paymentId }) => {
  const pool = await getPool();
  const result = await pool.request()
    .input('orderId', sql.NVarChar, orderId)
    .input('paymentId', sql.NVarChar, paymentId)
    .query(`UPDATE ${SCHEMA_NAME}.Purchases
            SET status = 'completed', paymentId = @paymentId, purchasedAt = GETDATE()
            OUTPUT INSERTED.*
            WHERE orderId = @orderId AND status <> 'completed'`);
  if (result.recordset[0]) return result.recordset[0];

  const existing = await pool.request()
    .input('orderId', sql.NVarChar, orderId)
    .query(`SELECT * FROM ${SCHEMA_NAME}.Purchases WHERE orderId = @orderId`);
  return existing.recordset[0] || null;
};

// Full verification used by both the in-app verify call and the redirect
// callback: signature → known order (optionally owned by userId) → captured
// payment with the right amount → purchase completed.
const verifyAndCompletePayment = async ({ orderId, paymentId, signature, userId }) => {
  if (!orderId || !paymentId || !signature) throw verificationError('Missing payment details');
  if (!verifyPaymentSignature({ orderId, paymentId, signature })) throw verificationError('Payment verification failed');

  const pool = await getPool();
  const request = pool.request().input('orderId', sql.NVarChar, orderId);
  let query = `SELECT id, amount FROM ${SCHEMA_NAME}.Purchases WHERE orderId = @orderId`;
  if (userId) {
    request.input('userId', sql.Int, userId);
    query += ' AND userId = @userId';
  }
  const pending = await request.query(query);
  if (!pending.recordset[0]) throw verificationError('Order not found');

  const payment = await getRazorpay().payments.fetch(paymentId);
  await ensureCaptured(payment, { orderId, amount: toPaise(pending.recordset[0].amount) });
  return markPurchaseCompleted({ orderId, paymentId });
};

const markPurchaseFailed = async ({ orderId, paymentId }) => {
  const pool = await getPool();
  await pool.request()
    .input('orderId', sql.NVarChar, orderId)
    .input('paymentId', sql.NVarChar, paymentId || null)
    .query(`UPDATE ${SCHEMA_NAME}.Purchases
            SET status = 'failed', paymentId = @paymentId
            WHERE orderId = @orderId AND status = 'pending'`);
};

module.exports = {
  CURRENCY,
  getRazorpay,
  toPaise,
  verifyPaymentSignature,
  verifyWebhookSignature,
  ensureCaptured,
  markPurchaseCompleted,
  markPurchaseFailed,
  verifyAndCompletePayment,
};
