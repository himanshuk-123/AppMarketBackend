const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const cloudinary = require('cloudinary').v2;
const { authenticate, adminOnly } = require('../middleware/auth');
const { uploadToR2 } = require('../services/r2');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Cloudinary resource type per upload type
const RESOURCE_TYPES = {
  thumbnail:  'image',
  screenshot: 'image',
  video:      'video',
};

// Large binaries go to Cloudflare R2 (private bucket) instead of Cloudinary
const R2_TYPES = new Set(['apk', 'aab', 'code']);

const fileFilter = (req, file, cb) => {
  const allowed = [
    'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
    'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm',
    'application/vnd.android.package-archive',
    'application/octet-stream',
    'application/zip',
    'application/x-zip-compressed',
    'application/x-zip',
  ];
  const allowedExts = ['.jpg', '.jpeg', '.png', '.webp', '.mp4', '.mov', '.avi', '.webm', '.apk', '.aab', '.zip'];
  const ext = path.extname(file.originalname).toLowerCase();

  if (allowed.includes(file.mimetype) || allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`File type not allowed: ${file.mimetype}`), false);
  }
};

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
});

// POST /api/upload?type=thumbnail|screenshot|video|apk|aab|code
router.post('/', authenticate, adminOnly, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    const type = req.query.type || 'thumbnail';

    // APK / AAB / source-code zip → Cloudflare R2 (no 10MB limit, kept private)
    if (R2_TYPES.has(type)) {
      const ext = path.extname(req.file.originalname).toLowerCase();
      const key = `${type}/${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
      await uploadToR2({
        buffer: req.file.buffer,
        key,
        contentType: req.file.mimetype || 'application/octet-stream',
      });
      return res.json({
        url:          key,   // stored in AppFiles; presigned at download time
        key,
        storage:      'r2',
        size:         req.file.size,
        originalName: req.file.originalname,
      });
    }

    const resourceType = RESOURCE_TYPES[type] || 'image';

    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: `appmarket/${type}`,
          resource_type: resourceType,
          use_filename: true,
          unique_filename: true,
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      stream.end(req.file.buffer);
    });

    res.json({
      url:          result.secure_url,
      publicId:     result.public_id,
      filename:     result.original_filename,
      size:         result.bytes,
      originalName: req.file.originalname,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
