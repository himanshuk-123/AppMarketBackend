require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');

const authRoutes = require('./routes/auth');
const appRoutes = require('./routes/apps');
const purchaseRoutes = require('./routes/purchases');
const adminRoutes = require('./routes/admin');
const uploadRoutes = require('./routes/upload');
const webhookRoutes = require('./routes/webhook');
const paymentCallbackRoutes = require('./routes/paymentCallback');

const app = express();

// Render sits behind a proxy — needed so rate limits see the real client IP
app.set('trust proxy', 1);

app.use(cors());
// Webhook needs the raw body for signature verification, so it goes before express.json()
app.use('/api/payments/webhook', express.raw({ type: '*/*' }), webhookRoutes);
app.use(express.json());
// Razorpay redirect callback posts form-encoded fields like error[description]
app.use('/api/payments', express.urlencoded({ extended: true }), paymentCallbackRoutes);

app.use('/api/auth', authRoutes);
app.use('/api/apps', appRoutes);
app.use('/api/purchases', purchaseRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/upload', uploadRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Errors not caught in a route (upload size / file type, bad JSON) → JSON, no stack traces
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : 'Invalid upload';
    return res.status(400).json({ message });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ message: 'Invalid request body' });
  if (err.message?.startsWith('File type not allowed')) return res.status(400).json({ message: err.message });
  console.error(`[${new Date().toISOString()}]`, err.message || err);
  res.status(500).json({ message: 'Something went wrong. Please try again.' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
