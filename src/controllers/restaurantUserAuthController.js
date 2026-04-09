const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/errors');
const {
  loginRestaurantUser,
  logoutRestaurantUser,
  refreshRestaurantUserSession,
} = require('../services/restaurantUserAuthService');
const { findRestaurantUserById } = require('../services/restaurantUserService');
const { verifyAccessToken } = require('../utils/token');

function extractBearerToken(req) {
  const header = req.headers.authorization || '';
  if (header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim();
  }
  return null;
}

const login = asyncHandler(async (req, res) => {
  const result = await loginRestaurantUser(req.body || {});
  res.json({
    message: 'Login successful',
    user: result.user,
    access_token: result.access_token,
    refresh_token: result.refresh_token,
  });
});

const logout = asyncHandler(async (req, res) => {
  const { refresh_token: refreshToken } = req.body || {};
  await logoutRestaurantUser(refreshToken);
  res.json({ message: 'Logged out' });
});

const refresh = asyncHandler(async (req, res) => {
  const { refresh_token: refreshToken } = req.body || {};
  const result = await refreshRestaurantUserSession(refreshToken);
  res.json({
    message: 'Token refreshed',
    user: result.user,
    access_token: result.access_token,
    refresh_token: result.refresh_token,
  });
});

const profile = asyncHandler(async (req, res) => {
  const token = extractBearerToken(req);
  if (!token) {
    throw ApiError.unauthorized('Authorization token missing');
  }
  let payload;
  try {
    payload = verifyAccessToken(token, 'restaurant_user');
  } catch (error) {
    throw ApiError.unauthorized('Invalid or expired token');
  }
  const user = await findRestaurantUserById(Number(payload.sub));
  if (!user) {
    throw ApiError.notFound('User not found');
  }
  res.json({ user });
});

module.exports = {
  login,
  logout,
  refresh,
  profile,
};
