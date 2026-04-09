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
  findRestaurantUserWithSensitiveByEmail,
  findRestaurantUserById,
} = require('./restaurantUserService');

async function loginRestaurantUser(payload = {}) {
  const { email, password } = payload;
  if (!email || !password) {
    throw ApiError.badRequest('email and password are required');
  }
  const record = await findRestaurantUserWithSensitiveByEmail(email);
  if (!record) {
    throw ApiError.unauthorized('Invalid email or password');
  }
  const passwordMatch = await verifyPassword(password, record.password_hash);
  if (!passwordMatch) {
    throw ApiError.unauthorized('Invalid email or password');
  }
  if (record.is_active === false) {
    throw ApiError.forbidden('User is inactive');
  }
  const user = await findRestaurantUserById(record.id);
  const tokens = await issueRestaurantUserTokens(user);
  return { user, ...tokens };
}

async function logoutRestaurantUser(refreshToken) {
  if (!refreshToken) {
    throw ApiError.badRequest('refresh_token is required');
  }
  await revokeRefreshToken('restaurant_user', refreshToken);
  return { success: true };
}

async function refreshRestaurantUserSession(refreshToken) {
  if (!refreshToken) {
    throw ApiError.badRequest('refresh_token is required');
  }
  const record = await findRefreshToken('restaurant_user', refreshToken);
  if (!record) {
    throw ApiError.unauthorized('Invalid refresh token');
  }
  await revokeRefreshToken('restaurant_user', refreshToken);
  const user = await findRestaurantUserById(record.userId);
  if (!user) {
    throw ApiError.notFound('Restaurant user not found');
  }
  if (user.is_active === false) {
    throw ApiError.forbidden('User is inactive');
  }
  const tokens = await issueRestaurantUserTokens(user);
  return { user, ...tokens };
}

async function issueRestaurantUserTokens(user) {
  const accessToken = issueAccessToken(user, 'restaurant_user');
  const refreshToken = generateRefreshTokenValue();
  const expiresAt = getRefreshExpiry('restaurant_user');
  await saveRefreshToken('restaurant_user', user.id, refreshToken, expiresAt);
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    refresh_token_expires_at: expiresAt,
  };
}

module.exports = {
  loginRestaurantUser,
  logoutRestaurantUser,
  refreshRestaurantUserSession,
};
