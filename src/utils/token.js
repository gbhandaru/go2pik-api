const crypto = require('crypto');
const config = require('../config/env');

const {
  accessTokenSecret,
  refreshTokenSecret,
  accessTokenTtl,
  customerRefreshTtl,
  restaurantRefreshTtl,
} = config.auth;
const {
  orderReviewTokenTtlSeconds,
} = config.publicLinks || {};

function base64UrlEncode(buffer) {
  return Buffer.from(buffer)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(input) {
  const padded = input.padEnd(input.length + ((4 - (input.length % 4)) % 4), '=');
  const normalized = padded.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64');
}

function signJwt(payload, ttlSeconds = accessTokenTtl, secret = accessTokenSecret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const iat = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat };
  if (ttlSeconds) {
    body.exp = iat + ttlSeconds;
  }
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedBody = base64UrlEncode(JSON.stringify(body));
  const data = `${encodedHeader}.${encodedBody}`;
  const signature = crypto.createHmac('sha256', secret).update(data).digest();
  return `${data}.${base64UrlEncode(signature)}`;
}

function verifyJwt(token, secret = accessTokenSecret) {
  if (!token || typeof token !== 'string') {
    throw new Error('Token missing');
  }
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token format');
  }
  const [encodedHeader, encodedBody, signature] = parts;
  const data = `${encodedHeader}.${encodedBody}`;
  const expected = base64UrlEncode(crypto.createHmac('sha256', secret).update(data).digest());
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(signature);
  if (
    expectedBuffer.length !== providedBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    throw new Error('Invalid token signature');
  }
  const payload = JSON.parse(base64UrlDecode(encodedBody).toString('utf8'));
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
    throw new Error('Token expired');
  }
  return payload;
}

function generateRefreshTokenValue() {
  return base64UrlEncode(crypto.randomBytes(48));
}

function hashRefreshTokenValue(token) {
  return crypto.createHmac('sha256', refreshTokenSecret).update(token).digest('hex');
}

function computeAccessTokenPayload({ id, type, email }) {
  return {
    sub: String(id),
    type,
    email,
  };
}

function issueAccessToken(user, type, ttl = accessTokenTtl) {
  return signJwt(computeAccessTokenPayload({ id: user.id, type, email: user.email }), ttl);
}

function verifyAccessToken(token, expectedType) {
  const payload = verifyJwt(token, accessTokenSecret);
  if (expectedType && payload.type !== expectedType) {
    throw new Error('Token type mismatch');
  }
  return payload;
}

function issueOrderReviewToken(order, ttl = orderReviewTokenTtlSeconds) {
  return signJwt(
    {
      sub: String(order.id),
      type: 'order_review',
      orderNumber: order.orderNumber,
      email: order.customer?.email || null,
      phone: order.customer?.phone || null,
    },
    ttl,
    accessTokenSecret
  );
}

function verifyOrderReviewToken(token) {
  const payload = verifyJwt(token, accessTokenSecret);
  if (payload.type !== 'order_review') {
    throw new Error('Token type mismatch');
  }
  return payload;
}

function getRefreshExpiry(type) {
  const ttl = type === 'restaurant_user' ? restaurantRefreshTtl : customerRefreshTtl;
  return new Date(Date.now() + ttl * 1000);
}

module.exports = {
  signJwt,
  verifyJwt,
  issueAccessToken,
  verifyAccessToken,
  issueOrderReviewToken,
  verifyOrderReviewToken,
  generateRefreshTokenValue,
  hashRefreshTokenValue,
  getRefreshExpiry,
};
