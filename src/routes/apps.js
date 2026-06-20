const router = require('express').Router();
const { sql, getPool } = require('../db/config');
const { authenticate, adminOnly } = require('../middleware/auth');

// Get all apps (public)
router.get('/', async (req, res) => {
  try {
    const { search, category } = req.query;
    const pool = await getPool();
    const request = pool.request().input('isActive', sql.Bit, 1);

    let query = `
      SELECT a.id, a.name, a.description, a.category, a.price,
             a.thumbnail, a.previewUrl, a.version, a.createdAt
      FROM AppMarket.Apps a
      WHERE a.isActive = @isActive
    `;

    if (search) {
      request.input('search', sql.NVarChar, `%${search}%`);
      query += ` AND (a.name LIKE @search OR a.description LIKE @search)`;
    }
    if (category) {
      request.input('category', sql.NVarChar, category);
      query += ` AND a.category = @category`;
    }
    query += ` ORDER BY a.createdAt DESC`;

    const result = await request.query(query);
    res.json({ apps: result.recordset });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get single app with screenshots
router.get('/:id', async (req, res) => {
  try {
    const pool = await getPool();
    const appResult = await pool.request()
      .input('id', sql.Int, req.params.id)
      .query(`SELECT a.*, af.apkUrl, af.aabUrl, af.codeZipUrl
              FROM AppMarket.Apps a
              LEFT JOIN AppMarket.AppFiles af ON af.appId = a.id
              WHERE a.id = @id AND a.isActive = 1`);

    if (!appResult.recordset[0])
      return res.status(404).json({ message: 'App not found' });

    const screenshotsResult = await pool.request()
      .input('appId', sql.Int, req.params.id)
      .query('SELECT imageUrl FROM AppMarket.Screenshots WHERE appId = @appId ORDER BY sortOrder');

    const app = appResult.recordset[0];
    app.screenshots = screenshotsResult.recordset;
    res.json({ app });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Create app (admin only)
router.post('/', authenticate, adminOnly, async (req, res) => {
  try {
    const { name, description, category, price, thumbnail, previewUrl, version,
            apkUrl, aabUrl, codeZipUrl } = req.body;

    const pool = await getPool();
    const appResult = await pool.request()
      .input('name', sql.NVarChar, name)
      .input('description', sql.NVarChar, description)
      .input('category', sql.NVarChar, category)
      .input('price', sql.Decimal(10, 2), price)
      .input('thumbnail', sql.NVarChar, thumbnail || null)
      .input('previewUrl', sql.NVarChar, previewUrl || null)
      .input('version', sql.NVarChar, version || '1.0.0')
      .query(`INSERT INTO   AppMarket.Apps (name, description, category, price, thumbnail, previewUrl, version)
              OUTPUT INSERTED.*
              VALUES (@name, @description, @category, @price, @thumbnail, @previewUrl, @version)`);

    const app = appResult.recordset[0];

    await pool.request()
      .input('appId', sql.Int, app.id)
      .input('apkUrl', sql.NVarChar, apkUrl || null)
      .input('aabUrl', sql.NVarChar, aabUrl || null)
      .input('codeZipUrl', sql.NVarChar, codeZipUrl || null)
      .query(`INSERT INTO AppMarket.AppFiles (appId, apkUrl, aabUrl, codeZipUrl)
              VALUES (@appId, @apkUrl, @aabUrl, @codeZipUrl)`);

    res.status(201).json({ app });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update app (admin only)
router.put('/:id', authenticate, adminOnly, async (req, res) => {
  try {
    const { name, description, category, price, thumbnail, previewUrl, version, isActive,
            apkUrl, aabUrl, codeZipUrl } = req.body;
    const pool = await getPool();

    await pool.request()
      .input('id', sql.Int, req.params.id)
      .input('name', sql.NVarChar, name)
      .input('description', sql.NVarChar, description)
      .input('category', sql.NVarChar, category)
      .input('price', sql.Decimal(10, 2), price)
      .input('thumbnail', sql.NVarChar, thumbnail || null)
      .input('previewUrl', sql.NVarChar, previewUrl || null)
      .input('version', sql.NVarChar, version || '1.0.0')
      .input('isActive', sql.Bit, isActive !== undefined ? isActive : 1)
      .query(`UPDATE AppMarket.Apps SET name=@name, description=@description, category=@category,
              price=@price, thumbnail=@thumbnail, previewUrl=@previewUrl,
              version=@version, isActive=@isActive WHERE id=@id`);

    // Upsert AppFiles (insert if not exists, otherwise update)
    await pool.request()
      .input('appId', sql.Int, req.params.id)
      .input('apkUrl', sql.NVarChar, apkUrl || null)
      .input('aabUrl', sql.NVarChar, aabUrl || null)
      .input('codeZipUrl', sql.NVarChar, codeZipUrl || null)
      .query(`IF EXISTS (SELECT 1 FROM AppMarket.AppFiles WHERE appId = @appId)
                UPDATE AppMarket.AppFiles SET apkUrl=@apkUrl, aabUrl=@aabUrl, codeZipUrl=@codeZipUrl WHERE appId=@appId
              ELSE
                INSERT INTO AppMarket.AppFiles (appId, apkUrl, aabUrl, codeZipUrl) VALUES (@appId, @apkUrl, @aabUrl, @codeZipUrl)`);

    res.json({ message: 'App updated' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Add screenshot to an app (admin only)
router.post('/:id/screenshots', authenticate, adminOnly, async (req, res) => {
  try {
    const { imageUrl, sortOrder } = req.body;
    const pool = await getPool();
    const result = await pool.request()
      .input('appId', sql.Int, req.params.id)
      .input('imageUrl', sql.NVarChar, imageUrl)
      .input('sortOrder', sql.Int, sortOrder || 0)
      .query(`INSERT INTO AppMarket.Screenshots (appId, imageUrl, sortOrder)
              OUTPUT INSERTED.*
              VALUES (@appId, @imageUrl, @sortOrder)`);
    res.status(201).json({ screenshot: result.recordset[0] });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Delete a screenshot (admin only)
router.delete('/:id/screenshots/:screenshotId', authenticate, adminOnly, async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request()
      .input('id', sql.Int, req.params.screenshotId)
      .input('appId', sql.Int, req.params.id)
      .query('DELETE FROM AppMarket.Screenshots WHERE id = @id AND appId = @appId');
    res.json({ message: 'Screenshot deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Soft delete app (admin only) — sets isActive = 0, preserves purchase history
router.delete('/:id', authenticate, adminOnly, async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request()
      .input('id', sql.Int, req.params.id)
      .query('UPDATE AppMarket.Apps SET isActive = 0 WHERE id = @id');
    res.json({ message: 'App removed from marketplace' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
