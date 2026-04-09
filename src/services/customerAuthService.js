const ApiError = require('../utils/errors');
const {
  issueAccessToken,
  generateRefreshTokenValue,
  getRefreshExpiry,
} = require('../utils/token');
const { verifyPassword } = require('../utils/password');
const {
  saveRefreshToken,
  findRefreshToken,
  revokeRefreshToken,
} = require('../repositories/tokenRepository');
const {
  createCustomer,
  findCustomerWithSensitiveByEmail,
  findCustomerById,
} = require('./customerService');

async function signupCustomer(payload = {}) {
  const customer = await createCustomer(payload);
  const tokens = await issueCustomerTokens(customer);
  return { customer, ...tokens };
}

async function loginCustomer(payload = {}) {
  const { email, password } = payload;
  if (!email || !password) {
    throw ApiError.badRequest('email and password are required');
  }
  const record = await findCustomerWithSensitiveByEmail(email);
  if (!record) {
    throw ApiError.unauthorized('Invalid email or password');
  }
  const passwordMatch = await verifyPassword(password, record.password_hash);
  if (!passwordMatch) {
    throw ApiError.unauthorized('Invalid email or password');
  }
  if (record.is_active === false) {
    throw ApiError.forbidden('Account is inactive');
  }
  const customer = await findCustomerById(record.id);
  const tokens = await issueCustomerTokens(customer);
  return { customer, ...tokens };
}

async function logoutCustomer(refreshToken) {
  if (!refreshToken) {
    throw ApiError.badRequest('refresh_token is required');
  }
  await revokeRefreshToken('customer', refreshToken);
  return { success: true };
}

async function refreshCustomerSession(refreshToken) {
  if (!refreshToken) {
    throw ApiError.badRequest('refresh_token is required');
  }
  const tokenRecord = await findRefreshToken('customer', refreshToken);
  if (!tokenRecord) {
    throw ApiError.unauthorized('Invalid refresh token');
  }
  await revokeRefreshToken('customer', refreshToken);
  const customer = await findCustomerById(tokenRecord.userId);
  if (!customer) {
    throw ApiError.notFound('Customer not found');
  }
  if (customer.is_active === false) {
    throw ApiError.forbidden('Account is inactive');
  }
  const tokens = await issueCustomerTokens(customer);
  return { customer, ...tokens };
}

async function issueCustomerTokens(customer) {
  const accessToken = issueAccessToken(customer, 'customer');
  const refreshToken = generateRefreshTokenValue();
  const expiresAt = getRefreshExpiry('customer');
  await saveRefreshToken('customer', customer.id, refreshToken, expiresAt);
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    refresh_token_expires_at: expiresAt,
  };
}

module.exports = {
  signupCustomer,
  loginCustomer,
  logoutCustomer,
  refreshCustomerSession,
};
