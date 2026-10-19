const crypto = require('crypto');
const { sql, getPool } = require('../db/config');
const { SCHEMA_NAME } = require('../constants');

const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 60;

// Codes are short, so they're stored as an HMAC keyed with the server secret
// (useless without it) and protected by expiry + an attempt limit.
const hashCode = (userId, purpose, code) =>
  crypto.createHmac('sha256', process.env.JWT_SECRET).update(`${userId}:${purpose}:${code}`).digest('hex');

const generateCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');

// Seconds until another code may be sent (0 = allowed now)
const cooldownRemaining = async (userId, purpose) => {
  const pool = await getPool();
  const result = await pool.request()
    .input('userId', sql.Int, userId)
    .input('purpose', sql.NVarChar, purpose)
    .query(`SELECT TOP 1 DATEDIFF(SECOND, createdAt, GETUTCDATE()) AS age
            FROM ${SCHEMA_NAME}.AuthCodes WHERE userId = @userId AND purpose = @purpose
            ORDER BY createdAt DESC`);
  const age = result.recordset[0]?.age;
  return age === undefined ? 0 : Math.max(0, RESEND_COOLDOWN_SECONDS - age);
};

// Create a new code; any earlier unused code for the same purpose stops working
const issueCode = async (userId, purpose) => {
  const code = generateCode();
  const pool = await getPool();
  await pool.request()
    .input('userId', sql.Int, userId)
    .input('purpose', sql.NVarChar, purpose)
    .input('codeHash', sql.NVarChar, hashCode(userId, purpose, code))
    .input('ttl', sql.Int, CODE_TTL_MINUTES)
    .query(`UPDATE ${SCHEMA_NAME}.AuthCodes SET usedAt = GETUTCDATE()
              WHERE userId = @userId AND purpose = @purpose AND usedAt IS NULL;
            INSERT INTO ${SCHEMA_NAME}.AuthCodes (userId, purpose, codeHash, expiresAt)
              VALUES (@userId, @purpose, @codeHash, DATEADD(MINUTE, @ttl, GETUTCDATE()));`);
  return code;
};

// true if the code is correct (and burns it); false otherwise
const consumeCode = async (userId, purpose, code) => {
  const pool = await getPool();
  const result = await pool.request()
    .input('userId', sql.Int, userId)
    .input('purpose', sql.NVarChar, purpose)
    .query(`SELECT TOP 1 id, codeHash, attempts FROM ${SCHEMA_NAME}.AuthCodes
            WHERE userId = @userId AND purpose = @purpose AND usedAt IS NULL AND expiresAt > GETUTCDATE()
            ORDER BY createdAt DESC`);
  const row = result.recordset[0];
  if (!row || row.attempts >= MAX_ATTEMPTS) return false;

  const expected = Buffer.from(row.codeHash, 'utf8');
  const given = Buffer.from(hashCode(userId, purpose, String(code || '').trim()), 'utf8');
  const ok = expected.length === given.length && crypto.timingSafeEqual(expected, given);

  await pool.request()
    .input('id', sql.Int, row.id)
    .query(ok
      ? `UPDATE ${SCHEMA_NAME}.AuthCodes SET usedAt = GETUTCDATE() WHERE id = @id`
      : `UPDATE ${SCHEMA_NAME}.AuthCodes SET attempts = attempts + 1 WHERE id = @id`);
  return ok;
};

module.exports = { CODE_TTL_MINUTES, cooldownRemaining, issueCode, consumeCode };
