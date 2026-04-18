const ApiError = require('./errors');
const { verifyAccessToken } = require('./token');
const { findCustomerById } = require('../services/customerService');

function extractBearerToken(req) {
  const header = req.headers.authorization || '';
  if (header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim();
  }
  return null;
}

async function resolveAuthenticatedCustomer(req) {
  const token = extractBearerToken(req);
  if (!token) {
    return null;
  }
  try {
    const payload = verifyAccessToken(token, 'customer');
    const customer = await findCustomerById(Number(payload.sub));
    if (!customer) {
      console.warn('[authenticatedCustomer] authenticated customer not found', { customerId: payload.sub });
      return null;
    }
    return customer;
  } catch (error) {
    console.warn('[authenticatedCustomer] failed to resolve authenticated customer', { error: error.message });
    return null;
  }
}

function mergeAuthenticatedCustomerPayload(body = {}, authCustomer = null) {
  const mergedCustomer = { ...(body.customer || {}) };
  const payload = { ...body };
  if (authCustomer) {
    mergedCustomer.id = authCustomer.id;
    mergedCustomer.email = mergedCustomer.email || authCustomer.email;
    mergedCustomer.name = mergedCustomer.name || authCustomer.full_name;
    mergedCustomer.phone = mergedCustomer.phone || authCustomer.phone;
    payload.customerId = authCustomer.id;
  }
  payload.customer = mergedCustomer;
  return payload;
}

module.exports = {
  extractBearerToken,
  resolveAuthenticatedCustomer,
  mergeAuthenticatedCustomerPayload,
};
