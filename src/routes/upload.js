const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticate, adminOnly } = require('../middleware/auth');

// Map file type to upload folder
const UPLOAD_DIRS = {
  thumbnail:  'uploads/thumbnails',
  screenshot: 'uploads/screenshots',
  video:      'uploads/videos',
  apk:        'uploads/apk',
  aab:        'uploads/aab',
  code:       'uploads/code',
};

// Dynamic storage — folder depends on req.query.type
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const type = req.query.type || 'thumbnail';
    const dir = path.join(__dirname, '../../', UPLOAD_DIRS[type] || 'uploads/thumbnails');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const ext = path.extname(file.originalname);
    cb(null, `${unique}${ext}`);
  },
});

// File filter — allow images + video + APK + AAB + ZIP
const fileFilter = (req, file, cb) => {
  const allowed = [
    'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
    'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm',
    'application/vnd.android.package-archive', // APK
    'application/octet-stream',                // AAB / generic binary
    'application/zip',
    'application/x-zip-compressed',
    'application/x-zip',
  ];
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExts = ['.jpg', '.jpeg', '.png', '.webp', '.mp4', '.mov', '.avi', '.webm', '.apk', '.aab', '.zip'];

  if (allowed.includes(file.mimetype) || allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`File type not allowed: ${file.mimetype}`), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max
});

// POST /api/upload?type=thumbnail|apk|aab|code
router.post('/', authenticate, adminOnly, upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    const type = req.query.type || 'thumbnail';
    const serverUrl = `${req.protocol}://${req.get('host')}`;
    const folder = UPLOAD_DIRS[type] || 'uploads/thumbnails';
    const fileUrl = `${serverUrl}/${folder}/${req.file.filename}`;

    res.json({
      url: fileUrl,
      filename: req.file.filename,
      size: req.file.size,
      originalName: req.file.originalname,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
