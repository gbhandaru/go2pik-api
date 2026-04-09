const dotenv = require('dotenv');

const isTest = process.env.NODE_ENV === 'test';
if (!process.env.NO_DOTENV) {
  dotenv.config();
}

function bool(value, fallback = false) {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value).toLowerCase();
  return ['1', 'true', 'yes', 'y'].includes(normalized);
}

function number(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function array(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const config = {
  env: process.env.NODE_ENV || 'development',
  isTest,
  server: {
    host: process.env.HOST || '0.0.0.0',
    port: number(process.env.PORT, 5000),
  },
  cors: {
    origins: array(process.env.CORS_ORIGINS),
  },
  db: {
    connectionString: process.env.DATABASE_URL || process.env.PGURL || null,
    host: process.env.PGHOST || process.env.PGHOSTADDR || '127.0.0.1',
    port: number(process.env.PGPORT, 5432),
    user: process.env.PGUSER || process.env.DB_USER || process.env.USER || 'postgres',
    password: process.env.PGPASSWORD || process.env.DB_PASSWORD || null,
    database: process.env.PGDATABASE || process.env.PGDB || 'food_orders_db',
    ssl: bool(process.env.PGSSL) ? { rejectUnauthorized: false } : false,
    max: number(process.env.PGPOOL_MAX, 10),
    idleTimeoutMillis: number(process.env.PGPOOL_IDLE_TIMEOUT, 30_000),
    connectionTimeoutMillis: number(process.env.PGPOOL_CONN_TIMEOUT, 5_000),
  },
  auth: {
    accessTokenSecret: process.env.ACCESS_TOKEN_SECRET || process.env.JWT_SECRET || 'dev-access-secret',
    refreshTokenSecret: process.env.REFRESH_TOKEN_SECRET || 'dev-refresh-secret',
    accessTokenTtl: number(process.env.ACCESS_TOKEN_TTL, 15 * 60),
    customerRefreshTtl: number(process.env.CUSTOMER_REFRESH_TTL, 60 * 60 * 24 * 30),
    restaurantRefreshTtl: number(process.env.RESTAURANT_REFRESH_TTL, 60 * 60 * 24 * 30),
  },
  orders: {
    defaultTaxRate: Number(process.env.DEFAULT_TAX_RATE || 0.08),
  },
};

module.exports = config;
