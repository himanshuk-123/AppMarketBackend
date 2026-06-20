require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const appRoutes = require('./routes/apps');
const purchaseRoutes = require('./routes/purchases');
const adminRoutes = require('./routes/admin');
const uploadRoutes = require('./routes/upload');

const app = express();

app.use(cors());
app.use(express.json());

// Serve uploaded files as static assets
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.use('/api/auth', authRoutes);
app.use('/api/apps', appRoutes);
app.use('/api/purchases', purchaseRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/upload', uploadRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
