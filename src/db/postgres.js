const { Pool } = require('pg');
const config = require('../config');

let pool = null;

const getPool = () => {
  if (!pool) {
    pool = new Pool({
      connectionString: config.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000
    });

    pool.on('error', (err) => {
      console.error('Unexpected error on idle PostgreSQL client', err);
    });

    pool.on('connect', () => {
      console.log('Connected to PostgreSQL');
    });
  }
  return pool;
};

const query = async (text, params) => {
  const start = Date.now();
  const res = await getPool().query(text, params);
  const duration = Date.now() - start;

  if (config.NODE_ENV === 'development') {
    console.log('Executed query', { text: text.substring(0, 100), duration, rows: res.rowCount });
  }

  return res;
};

const getClient = async () => {
  return getPool().connect();
};

const closePool = async () => {
  if (pool) {
    await pool.end();
    pool = null;
  }
};

module.exports = {
  getPool,
  query,
  getClient,
  closePool
};
