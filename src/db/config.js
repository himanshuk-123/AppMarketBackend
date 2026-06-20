const sql = require('mssql');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

if (!process.env.DB_SERVER) {
  throw new Error('DB_SERVER is not set — check your .env file at ' + path.join(__dirname, '../../.env'));
}

const dbConfig = {
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT) || 1433,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERT === 'true',
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
};

let pool = null;

const getPool = async () => {
  if (!pool) {
    pool = await sql.connect(dbConfig);
  }
  return pool;
};

module.exports = { sql, getPool };
