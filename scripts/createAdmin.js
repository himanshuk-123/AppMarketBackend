// Create an admin account, or promote an existing user to admin.
// Usage: npm run create-admin -- "Your Name" you@example.com "a-strong-password"
const bcrypt = require('bcryptjs');
const { sql, getPool } = require('../src/db/config');
const { SCHEMA_NAME } = require('../src/constants');

const [name, email, password] = process.argv.slice(2);

(async () => {
  if (!name || !email || !password) {
    console.error('Usage: npm run create-admin -- "Your Name" you@example.com "a-strong-password"');
    process.exit(1);
  }
  if (password.length < 10) {
    console.error('Use a password of at least 10 characters.');
    process.exit(1);
  }

  const pool = await getPool();
  const hashed = await bcrypt.hash(password, 10);
  await pool.request()
    .input('name', sql.NVarChar, name)
    .input('email', sql.NVarChar, email)
    .input('password', sql.NVarChar, hashed)
    .query(`IF EXISTS (SELECT 1 FROM ${SCHEMA_NAME}.Users WHERE email = @email)
              UPDATE ${SCHEMA_NAME}.Users SET name = @name, password = @password, role = 'admin' WHERE email = @email
            ELSE
              INSERT INTO ${SCHEMA_NAME}.Users (name, email, password, role) VALUES (@name, @email, @password, 'admin')`);

  console.log(`Admin ready: ${email}`);
  process.exit(0);
})().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
