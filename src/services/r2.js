const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const BUCKET = process.env.R2_BUCKET;

const client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT, // https://<ACCOUNT_ID>.r2.cloudflarestorage.com
  forcePathStyle: true, // R2 has no per-bucket DNS; use endpoint/bucket/key
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

// Upload a buffer to R2. Returns the object key (stored in the DB).
const uploadToR2 = async ({ buffer, key, contentType }) => {
  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );
  return key;
};

// Generate a short-lived download link for a private object.
// `downloadName` makes the browser save it with a friendly filename.
const getPresignedUrl = async (key, { expiresIn = 600, downloadName } = {}) => {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ...(downloadName
      ? { ResponseContentDisposition: `attachment; filename="${downloadName}"` }
      : {}),
  });
  return getSignedUrl(client, command, { expiresIn });
};

const deleteFromR2 = async (key) => {
  await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
};

// Anything we store on R2 is a bare object key; Cloudinary values are full URLs.
const isR2Key = (value) => !!value && !/^https?:\/\//i.test(value);

module.exports = { uploadToR2, getPresignedUrl, deleteFromR2, isR2Key };
