const fs = require('fs/promises');
const path = require('path');
const { google } = require('googleapis');

const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const driveScope = ['https://www.googleapis.com/auth/drive'];

const folderCache = new Map();

const getDriveClient = () => {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!clientEmail || !privateKey) {
    throw new Error('Google Drive credentials are not configured');
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: driveScope,
  });

  return google.drive({ version: 'v3', auth });
};

const ensureFolder = async (drive, folderName, parentId) => {
  const cacheKey = `${parentId || 'root'}:${folderName}`;
  if (folderCache.has(cacheKey)) {
    return folderCache.get(cacheKey);
  }

  const queryParts = [
    `mimeType='${FOLDER_MIME_TYPE}'`,
    `name='${folderName.replace(/'/g, "\\'")}'`,
    'trashed=false',
  ];

  if (parentId) {
    queryParts.push(`'${parentId}' in parents`);
  }

  const listResponse = await drive.files.list({
    q: queryParts.join(' and '),
    fields: 'files(id, name)',
    spaces: 'drive',
    pageSize: 1,
  });

  const existing = listResponse.data.files?.[0];
  if (existing?.id) {
    folderCache.set(cacheKey, existing.id);
    return existing.id;
  }

  const createResponse = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: FOLDER_MIME_TYPE,
      parents: parentId ? [parentId] : undefined,
    },
    fields: 'id',
  });

  const folderId = createResponse.data.id;
  folderCache.set(cacheKey, folderId);
  return folderId;
};

const ensureFolderPath = async (drive, folderParts) => {
  const rootFolderId = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID || null;
  let parentId = rootFolderId;

  for (const folderName of folderParts) {
    parentId = await ensureFolder(drive, folderName, parentId);
  }

  return parentId;
};

const uploadFile = async ({ localFilePath, fileName, mimeType, folderParts }) => {
  const drive = getDriveClient();
  const folderId = await ensureFolderPath(drive, folderParts);

  const response = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: require('fs').createReadStream(localFilePath),
    },
    fields: 'id, name, mimeType, size, webViewLink, webContentLink',
  });

  const fileId = response.data.id;

  await drive.permissions.create({
    fileId,
    requestBody: {
      role: 'reader',
      type: 'anyone',
    },
  });

  return {
    fileId,
    fileName: response.data.name,
    size: response.data.size ? Number(response.data.size) : null,
    webViewLink: response.data.webViewLink,
    webContentLink: response.data.webContentLink,
    downloadUrl: `https://drive.google.com/uc?export=download&id=${fileId}`,
    folderId,
  };
};

const deleteTempFile = async (tempPath) => {
  if (!tempPath) return;
  await fs.rm(tempPath, { force: true });
};

module.exports = {
  uploadFile,
  deleteTempFile,
};