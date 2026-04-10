const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/errors');
const {
  signupCustomer,
  loginCustomer,
  logoutCustomer,
  refreshCustomerSession,
  updateCustomerProfileByEmail,
} = require('../services/customerAuthService');
const { findCustomerById } = require('../services/customerService');
const { verifyAccessToken } = require('../utils/token');

function extractBearerToken(req) {
  const header = req.headers.authorization || '';
  if (header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim();
  }
  return null;
}

const register = asyncHandler(async (req, res) => {
  const result = await signupCustomer(req.body || {});
  res.status(201).json({
    message: 'Customer account created',
    customer: result.customer,
    access_token: result.access_token,
    refresh_token: result.refresh_token,
  });
});

const login = asyncHandler(async (req, res) => {
  const result = await loginCustomer(req.body || {});
  res.json({
    message: 'Login successful',
    customer: result.customer,
    access_token: result.access_token,
    refresh_token: result.refresh_token,
  });
});

const logout = asyncHandler(async (req, res) => {
  const { refresh_token: refreshToken } = req.body || {};
  await logoutCustomer(refreshToken);
  res.json({ message: 'Logged out' });
});

const refresh = asyncHandler(async (req, res) => {
  const { refresh_token: refreshToken } = req.body || {};
  const result = await refreshCustomerSession(refreshToken);
  res.json({
    message: 'Token refreshed',
    customer: result.customer,
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
    payload = verifyAccessToken(token, 'customer');
  } catch (error) {
    throw ApiError.unauthorized('Invalid or expired token');
  }
  const customer = await findCustomerById(Number(payload.sub));
  if (!customer) {
    throw ApiError.notFound('Customer not found');
  }
  res.json({ customer });
});

const updateProfile = asyncHandler(async (req, res) => {
  const result = await updateCustomerProfileByEmail(req.body || {});
  res.json({
    message: 'Customer profile updated',
    customer: result.customer,
  });
});

module.exports = {
  register,
  login,
  logout,
  refresh,
  profile,
  updateProfile,
};
