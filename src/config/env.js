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

const DEFAULT_SENDGRID_API_KEY = '';
const DEFAULT_SENDGRID_FROM_EMAIL = 'orders@go2pik.com';
const DEFAULT_SENDGRID_FROM_NAME = 'Go2Pik';

const stageAliasMap = {
  development: 'local',
  dev: 'local',
  staging: 'preview',
  stage: 'preview',
  preview: 'preview',
  production: 'production',
  prod: 'production',
};

function resolveDeploymentStage() {
  const raw =
    process.env.APP_ENV || process.env.DEPLOYMENT_ENV || process.env.NODE_ENV || 'local';
  const normalized = raw.toLowerCase();
  return stageAliasMap[normalized] || normalized || 'local';
}

const deploymentStage = resolveDeploymentStage();

function valueForStage(baseKey, fallback = '') {
  const stageKey = `${baseKey}_${deploymentStage.toUpperCase()}`;
  return process.env[stageKey] || process.env[baseKey] || fallback;
}

const config = {
  env: process.env.NODE_ENV || 'development',
  deploymentStage,
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
  reports: {
    defaultCommissionRate: number(process.env.REPORTS_DEFAULT_COMMISSION_RATE, 0.05),
  },
  verification: {
    otpExpiryMinutes: number(process.env.OTP_EXPIRY_MINUTES, 10),
    otpResendCooldownSeconds: number(process.env.OTP_RESEND_COOLDOWN_SECONDS, 30),
    otpMaxAttempts: number(process.env.OTP_MAX_ATTEMPTS, 5),
    otpLength: number(process.env.OTP_LENGTH, 6),
  },
  publicLinks: {
    orderReviewBaseUrl:
      process.env.PUBLIC_ORDER_REVIEW_BASE_URL || 'https://go2pik.com/order',
    orderReviewTokenTtlSeconds: number(
      process.env.PUBLIC_ORDER_REVIEW_TOKEN_TTL_SECONDS,
      60 * 60 * 24 * 7
    ),
  },
  docs: {
    adminUsername: process.env.ADMIN_DOCS_USERNAME || '',
    adminPassword: process.env.ADMIN_DOCS_PASSWORD || '',
  },
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    phoneNumber: process.env.TWILIO_PHONE_NUMBER || '',
    messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID || '',
    verifyServiceSid: process.env.TWILIO_VERIFY_SERVICE_SID || '',
  },
  notifications: (function buildNotificationsConfig() {
  const sendgrid = {
    apiKey: valueForStage('SENDGRID_API_KEY', DEFAULT_SENDGRID_API_KEY),
    fromEmail: valueForStage('SENDGRID_FROM_EMAIL', DEFAULT_SENDGRID_FROM_EMAIL),
    fromName: valueForStage('SENDGRID_FROM_NAME', DEFAULT_SENDGRID_FROM_NAME),
  };
    const providerOverride = process.env.NOTIFICATIONS_PROVIDER;
    const provider = providerOverride || (sendgrid.apiKey ? 'sendgrid' : 'custom');
    const baseFromEmail = sendgrid.fromEmail || process.env.EMAIL_FROM || 'no-reply@go2pik.com';
    const baseFromName = sendgrid.fromName || process.env.EMAIL_FROM_NAME || 'Go2Pik Notifications';
    return {
      enabled: bool(process.env.NOTIFICATIONS_ENABLED, true),
      provider,
      providerUrl:
        provider === 'sendgrid'
          ? 'https://api.sendgrid.com/v3/mail/send'
          : process.env.EMAIL_PROVIDER_URL || process.env.NOTIFICATION_PROVIDER_URL || '',
      apiKey:
        provider === 'sendgrid'
          ? sendgrid.apiKey
          : process.env.EMAIL_PROVIDER_API_KEY || process.env.NOTIFICATION_API_KEY || '',
      fromEmail: baseFromEmail,
      fromName: baseFromName,
      timezone: process.env.NOTIFICATION_TIMEZONE || 'UTC',
      timeoutMs: number(process.env.EMAIL_PROVIDER_TIMEOUT_MS, 8000),
      sendgrid,
    };
  })(),
};

if (!isTest) {
  const sendgridConfig = config.notifications?.sendgrid || {};
  console.log('[config] SendGrid settings resolved', {
    deploymentStage: config.deploymentStage,
    provider: config.notifications?.provider,
    sendgridApiKeyPresent: Boolean(sendgridConfig.apiKey),
    sendgridFromEmail: sendgridConfig.fromEmail || null,
    sendgridFromName: sendgridConfig.fromName || null,
  });
}

module.exports = config;
