const router = require('express').Router();
const { verifyAndCompletePayment, markPurchaseFailed } = require('../services/razorpay');

// Razorpay redirect-mode callback. The in-app WebView can't open the popup
// windows netbanking / wallets / cards (3-D Secure) need, so checkout runs with
// redirect: true and Razorpay form-POSTs the result here. We verify it, then
// redirect to /result, which the app intercepts to close checkout.
const resultUrl = (req, params) =>
  `${req.baseUrl}/result?${new URLSearchParams(params).toString()}`;

router.post('/callback', async (req, res) => {
  const body = req.body || {};
  const orderId = body.razorpay_order_id;

  if (body.error) {
    let meta = {};
    try { meta = JSON.parse(body.error.metadata || '{}'); } catch { /* ignore */ }
    if (meta.order_id) {
      await markPurchaseFailed({ orderId: meta.order_id, paymentId: meta.payment_id }).catch(() => {});
    }
    return res.redirect(303, resultUrl(req, {
      status: 'failed',
      message: body.error.description || 'Payment failed',
    }));
  }

  try {
    await verifyAndCompletePayment({
      orderId,
      paymentId: body.razorpay_payment_id,
      signature: body.razorpay_signature,
    });
    res.redirect(303, resultUrl(req, { status: 'success', order_id: orderId }));
  } catch (err) {
    console.error('Razorpay callback error:', err.message || err.error?.description);
    if (err.verification) {
      return res.redirect(303, resultUrl(req, { status: 'failed', message: 'Payment could not be verified' }));
    }
    // Razorpay / network hiccup — the webhook will still complete a genuine payment
    res.redirect(303, resultUrl(req, {
      status: 'pending',
      payment_id: body.razorpay_payment_id || '',
    }));
  }
});

// Landing page after the callback: hands the result to the app's WebView
router.get('/result', (req, res) => {
  const result = {
    type: 'result',
    status: String(req.query.status || 'pending'),
    message: String(req.query.message || ''),
    paymentId: String(req.query.payment_id || ''),
  };
  const json = JSON.stringify(result).replace(/</g, '\\u003c');
  res.type('html').send(
    '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>' +
    '<body style="font-family:sans-serif;text-align:center;padding-top:40vh;">Returning to the app…' +
    `<script>window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(${json}));</script>` +
    '</body></html>'
  );
});

module.exports = router;
