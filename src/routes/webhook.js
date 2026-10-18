const router = require('express').Router();
const {
  getRazorpay, verifyWebhookSignature, markPurchaseCompleted, markPurchaseFailed,
} = require('../services/razorpay');

// Razorpay webhook — mounted with express.raw() so the signature can be
// checked against the exact bytes Razorpay sent.
// Dashboard events to enable: payment.authorized, payment.captured, payment.failed, order.paid
router.post('/', async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  if (!Buffer.isBuffer(req.body) || !verifyWebhookSignature(req.body, signature)) {
    return res.status(400).json({ message: 'Invalid signature' });
  }

  let event;
  try {
    event = JSON.parse(req.body.toString('utf8'));
  } catch {
    return res.status(400).json({ message: 'Invalid payload' });
  }

  try {
    const payment = event.payload?.payment?.entity;
    const orderId = payment?.order_id || event.payload?.order?.entity?.id;
    if (!orderId) return res.json({ received: true });

    switch (event.event) {
      case 'payment.authorized':
        // Accounts without auto-capture: capture now, payment.captured follows
        await getRazorpay().payments.capture(payment.id, payment.amount, payment.currency);
        break;
      case 'payment.captured':
      case 'order.paid':
        await markPurchaseCompleted({ orderId, paymentId: payment?.id });
        break;
      case 'payment.failed':
        await markPurchaseFailed({ orderId, paymentId: payment?.id });
        break;
      default:
        break;
    }
    res.json({ received: true });
  } catch (err) {
    // Non-2xx makes Razorpay retry the delivery
    console.error('Razorpay webhook error:', err.message || err.error?.description);
    res.status(500).json({ message: 'Webhook processing failed' });
  }
});

module.exports = router;
