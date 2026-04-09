const pool = require('../config/db');

function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    restaurant_id: row.restaurant_id,
    full_name: row.full_name,
    phone: row.phone,
    email: row.email,
    role: row.role,
    is_active: row.is_active !== false,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function createRestaurantUser({ restaurantId, fullName, phone, email, passwordHash, role }) {
  const query = `
    INSERT INTO restaurant_users (restaurant_id, full_name, phone, email, password_hash, role)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *;
  `;
  const { rows } = await pool.query(query, [restaurantId, fullName, phone, email, passwordHash, role]);
  return rows[0];
}

async function findByEmail(email, { includeSensitive = false } = {}) {
  const query = 'SELECT * FROM restaurant_users WHERE LOWER(email) = LOWER($1) LIMIT 1;';
  const { rows } = await pool.query(query, [email]);
  if (rows.length === 0) {
    return null;
  }
  const row = rows[0];
  return includeSensitive ? row : mapUser(row);
}

async function findById(id, { includeSensitive = false } = {}) {
  const query = 'SELECT * FROM restaurant_users WHERE id = $1 LIMIT 1;';
  const { rows } = await pool.query(query, [id]);
  if (rows.length === 0) {
    return null;
  }
  const row = rows[0];
  return includeSensitive ? row : mapUser(row);
}

async function listByRestaurant(restaurantId) {
  const query = `
    SELECT *
    FROM restaurant_users
    WHERE restaurant_id = $1
    ORDER BY full_name ASC;
  `;
  const { rows } = await pool.query(query, [restaurantId]);
  return rows.map(mapUser);
}

async function updateUser(id, fields) {
  const updates = [];
  const values = [];
  Object.entries(fields).forEach(([key, value]) => {
    if (value !== undefined) {
      values.push(value);
      updates.push(`${key} = $${values.length}`);
    }
  });
  if (updates.length === 0) {
    return null;
  }
  values.push(id);
  const query = `
    UPDATE restaurant_users
    SET ${updates.join(', ')}, updated_at = now()
    WHERE id = $${values.length}
    RETURNING *;
  `;
  const { rows } = await pool.query(query, values);
  return rows[0] || null;
}

async function deactivateUser(id) {
  const query = `
    UPDATE restaurant_users
    SET is_active = false, updated_at = now()
    WHERE id = $1
    RETURNING *;
  `;
  const { rows } = await pool.query(query, [id]);
  return rows[0] || null;
}

module.exports = {
  mapUser,
  createRestaurantUser,
  findByEmail,
  findById,
  listByRestaurant,
  updateUser,
  deactivateUser,
};
