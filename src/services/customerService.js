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

const DEFAULT_PHONE_NUMBER = '111-111-1111';

function normalizeEmail(email) {
  return email ? email.toLowerCase() : email;
}

function normalizePhone(phone) {
  if (phone === undefined || phone === null) {
    return DEFAULT_PHONE_NUMBER;
  }
  if (typeof phone === 'string' && phone.trim() === '') {
    return DEFAULT_PHONE_NUMBER;
  }
  return phone;
}

function deriveFullNameFromEmail(email) {
  if (!email) {
    return null;
  }
  const [localPart] = String(email).split('@');
  if (!localPart) {
    return null;
  }
  return localPart.trim() || null;
}

function resolveFullName(fullName, email) {
  if (typeof fullName === 'string' && fullName.trim() !== '') {
    return fullName;
  }
  return deriveFullNameFromEmail(email);
}

async function createCustomer(payload = {}) {
  const { full_name: fullName, phone, email, password } = payload;
  const resolvedFullName = resolveFullName(fullName, email);
  if (!resolvedFullName || !email || !password) {
    throw ApiError.badRequest('full_name, email and password are required');
  }
  const passwordHash = await hashPassword(password);
  try {
    const row = await insertCustomer({
      fullName: resolvedFullName,
      phone: normalizePhone(phone),
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
  const { full_name: fullName, phone, email, password } = payload;
  const resolvedFullName = resolveFullName(fullName, email);
  if (!resolvedFullName || !email) {
    throw ApiError.badRequest('full_name and email are required');
  }
  const passwordHash = password ? await hashPassword(password) : null;
  try {
    const row = await insertCustomerAdmin({
      fullName: resolvedFullName,
      phone: normalizePhone(phone),
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
  deriveFullNameFromEmail,
};
