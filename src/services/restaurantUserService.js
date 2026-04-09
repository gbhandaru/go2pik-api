const ApiError = require('../utils/errors');
const { hashPassword } = require('../utils/password');
const {
  mapUser,
  createRestaurantUser,
  findByEmail,
  findById,
  listByRestaurant,
  updateUser,
  deactivateUser,
} = require('../repositories/restaurantUserRepository');

function normalizeEmail(email) {
  return email ? email.toLowerCase() : email;
}

async function createUser(restaurantId, payload = {}) {
  if (!restaurantId) {
    throw ApiError.badRequest('restaurantId is required');
  }
  const { full_name: fullName, phone = null, email, password, role = 'staff' } = payload;
  if (!fullName || !email || !password) {
    throw ApiError.badRequest('full_name, email and password are required');
  }
  const passwordHash = await hashPassword(password);
  try {
    const row = await createRestaurantUser({
      restaurantId,
      fullName,
      phone,
      email: normalizeEmail(email),
      passwordHash,
      role,
    });
    return mapUser(row);
  } catch (error) {
    if (error.code === '23505') {
      throw ApiError.conflict('User with this email already exists');
    }
    throw error;
  }
}

async function listUsers(restaurantId) {
  return listByRestaurant(restaurantId);
}

async function updateUserRecord(userId, payload = {}) {
  const allowed = ['full_name', 'phone', 'email', 'role'];
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
    const row = await updateUser(userId, fields);
    if (!row) {
      throw ApiError.notFound('Restaurant user not found');
    }
    return mapUser(row);
  } catch (error) {
    if (error.code === '23505') {
      throw ApiError.conflict('User with this email already exists');
    }
    throw error;
  }
}

async function deactivate(userId) {
  const row = await deactivateUser(userId);
  if (!row) {
    throw ApiError.notFound('Restaurant user not found');
  }
  return mapUser(row);
}

module.exports = {
  createUser,
  listUsers,
  updateUser: updateUserRecord,
  deactivate,
  findRestaurantUserWithSensitiveByEmail: (email) => findByEmail(email, { includeSensitive: true }),
  findRestaurantUserById: (id) => findById(id, { includeSensitive: false }),
};
