const ApiError = require('../utils/errors');
const { hashPassword } = require('../utils/password');
const {
  mapCustomer,
  insertCustomer,
  insertCustomerAdmin,
  findCustomerByEmail,
  findCustomerById: findCustomerByIdRepo,
  updateCustomerFields,
  deactivateCustomer: deactivateCustomerRepo,
} = require('../repositories/customerRepository');

function normalizeEmail(email) {
  return email ? email.toLowerCase() : email;
}

async function createCustomer(payload = {}) {
  const { full_name: fullName, phone = null, email, password } = payload;
  if (!fullName || !email || !password) {
    throw ApiError.badRequest('full_name, email and password are required');
  }
  const passwordHash = await hashPassword(password);
  try {
    const row = await insertCustomer({
      fullName,
      phone,
      email: normalizeEmail(email),
      passwordHash,
    });
    return mapCustomer(row);
  } catch (error) {
    if (error.code === '23505') {
      throw ApiError.conflict('Customer with this email already exists');
    }
    throw error;
  }
}

async function createCustomerAdmin(payload = {}) {
  const { full_name: fullName, phone = null, email, password } = payload;
  if (!fullName || !email) {
    throw ApiError.badRequest('full_name and email are required');
  }
  const passwordHash = password ? await hashPassword(password) : null;
  try {
    const row = await insertCustomerAdmin({
      fullName,
      phone,
      email: normalizeEmail(email),
      passwordHash,
    });
    return mapCustomer(row);
  } catch (error) {
    if (error.code === '23505') {
      throw ApiError.conflict('Customer with this email already exists');
    }
    throw error;
  }
}

async function findCustomerWithSensitiveByEmail(email) {
  if (!email) return null;
  return findCustomerByEmail(email, { includeSensitive: true });
}

async function findCustomerById(id) {
  const row = await findCustomerByIdRepo(id, { includeSensitive: false });
  return row;
}

async function updateCustomer(id, payload = {}) {
  const allowed = ['full_name', 'phone', 'email'];
  const fields = {};
  allowed.forEach((field) => {
    if (payload[field] !== undefined) {
      fields[field] = field === 'email' ? normalizeEmail(payload[field]) : payload[field];
    }
  });
  if (payload.password) {
    fields.password_hash = await hashPassword(payload.password);
  }
  if (Object.keys(fields).length === 0) {
    throw ApiError.badRequest('No fields to update');
  }
  try {
    const row = await updateCustomerFields(id, fields);
    if (!row) {
      throw ApiError.notFound('Customer not found');
    }
    return mapCustomer(row);
  } catch (error) {
    if (error.code === '23505') {
      throw ApiError.conflict('Customer with this email already exists');
    }
    throw error;
  }
}

async function deactivateCustomer(id) {
  const row = await deactivateCustomerRepo(id);
  if (!row) {
    throw ApiError.notFound('Customer not found');
  }
  return mapCustomer(row);
}

module.exports = {
  createCustomer,
  createCustomerAdmin,
  findCustomerWithSensitiveByEmail,
  findCustomerById,
  updateCustomer,
  deactivateCustomer,
};
