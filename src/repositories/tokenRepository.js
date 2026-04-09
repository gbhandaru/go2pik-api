const pool = require('../config/db');
const { hashRefreshTokenValue } = require('../utils/token');

const TABLE = 'auth_refresh_tokens';
const SUPPORTED_TYPES = new Set(['customer', 'restaurant_user']);
const SCHEMA_ERRORS = new Set(['42P01', '42703']);
let tableAvailable = true;

const memoryStore = {
  customer: new Map(),
  restaurant_user: new Map(),
};

function cleanup(type) {
  const store = memoryStore[type];
  if (!store) return;
  const now = Date.now();
  for (const [tokenHash, record] of store.entries()) {
    if (record.expiresAt && record.expiresAt.getTime() < now) {
      store.delete(tokenHash);
    }
  }
}

async function execWithFallback(type, dbFn, fallbackFn) {
  if (!SUPPORTED_TYPES.has(type)) {
    throw new Error(`Unsupported token type: ${type}`);
  }
  if (!tableAvailable) {
    return fallbackFn();
  }
  try {
    return await dbFn();
  } catch (error) {
    if (SCHEMA_ERRORS.has(error.code)) {
      tableAvailable = false;
      console.warn('[tokenRepository] Falling back to memory store:', error.message);
      return fallbackFn();
    }
    throw error;
  }
}

async function saveRefreshToken(type, userId, rawToken, expiresAt) {
  const tokenHash = hashRefreshTokenValue(rawToken);
  const dbOperation = async () => {
    const query = `
      INSERT INTO ${TABLE} (user_type, user_id, refresh_token_hash, expires_at)
      VALUES ($1, $2, $3, $4)
      RETURNING id;
    `;
    await pool.query(query, [type, userId, tokenHash, expiresAt]);
    return true;
  };
  const fallback = () => {
    cleanup(type);
    memoryStore[type].set(tokenHash, {
      userId,
      userType: type,
      expiresAt,
      isRevoked: false,
    });
    return true;
  };
  await execWithFallback(type, dbOperation, fallback);
  return { token: rawToken, expiresAt };
}

async function findRefreshToken(type, rawToken) {
  const tokenHash = hashRefreshTokenValue(rawToken);
  const dbOperation = async () => {
    const query = `
      SELECT user_type, user_id, expires_at, is_revoked
      FROM ${TABLE}
      WHERE refresh_token_hash = $1
      LIMIT 1;
    `;
    const { rows } = await pool.query(query, [tokenHash]);
    if (rows.length === 0) {
      return null;
    }
    const row = rows[0];
    return {
      userType: row.user_type,
      userId: row.user_id,
      expiresAt: row.expires_at ? new Date(row.expires_at) : null,
      isRevoked: row.is_revoked,
    };
  };
  const fallback = () => {
    cleanup(type);
    return memoryStore[type].get(tokenHash) || null;
  };
  const tokenRecord = await execWithFallback(type, dbOperation, fallback);
  if (!tokenRecord) {
    return null;
  }
  if (tokenRecord.userType !== type) {
    return null;
  }
  if (tokenRecord.isRevoked) {
    return null;
  }
  if (tokenRecord.expiresAt && tokenRecord.expiresAt.getTime() < Date.now()) {
    return null;
  }
  return tokenRecord;
}

async function revokeRefreshToken(type, rawToken) {
  const tokenHash = hashRefreshTokenValue(rawToken);
  const dbOperation = async () => {
    const query = `
      UPDATE ${TABLE}
      SET is_revoked = true
      WHERE refresh_token_hash = $1 AND user_type = $2 AND is_revoked = false
      RETURNING 1;
    `;
    const { rows } = await pool.query(query, [tokenHash, type]);
    return rows.length > 0;
  };
  const fallback = () => {
    cleanup(type);
    const record = memoryStore[type].get(tokenHash);
    if (!record) {
      return false;
    }
    record.isRevoked = true;
    memoryStore[type].set(tokenHash, record);
    return true;
  };
  return execWithFallback(type, dbOperation, fallback);
}

module.exports = {
  saveRefreshToken,
  findRefreshToken,
  revokeRefreshToken,
};
