const pool = require('../config/db');

function mapCustomer(row) {
  if (!row) return null;
  return {
    id: row.id,
    full_name: row.full_name,
    phone: row.phone,
    email: row.email,
    is_active: row.is_active !== false,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function insertCustomer({ fullName, phone, email, passwordHash }) {
  const query = `
    INSERT INTO customers (full_name, phone, email, password_hash)
    VALUES ($1, $2, $3, $4)
    RETURNING *;
  `;
  const { rows } = await pool.query(query, [fullName, phone, email, passwordHash]);
  return rows[0];
}

async function insertCustomerAdmin({ fullName, phone, email, passwordHash }) {
  const fields = ['full_name', 'phone', 'email'];
  const values = [fullName, phone, email];
  const placeholders = ['$1', '$2', '$3'];
  if (passwordHash) {
    fields.push('password_hash');
    values.push(passwordHash);
    placeholders.push(`$${values.length}`);
  }
  const query = `
    INSERT INTO customers (${fields.join(', ')})
    VALUES (${placeholders.join(', ')})
    RETURNING *;
  `;
  const { rows } = await pool.query(query, values);
  return rows[0];
}

async function findCustomerByEmail(email, { includeSensitive = false } = {}) {
  const query = `SELECT * FROM customers WHERE LOWER(email) = LOWER($1) LIMIT 1;`;
  const { rows } = await pool.query(query, [email]);
  if (rows.length === 0) {
    return null;
  }
  const row = rows[0];
  return includeSensitive ? row : mapCustomer(row);
}

async function findCustomerById(id, { includeSensitive = false } = {}) {
  const query = `SELECT * FROM customers WHERE id = $1 LIMIT 1;`;
  const { rows } = await pool.query(query, [id]);
  if (rows.length === 0) {
    return null;
  }
  const row = rows[0];
  return includeSensitive ? row : mapCustomer(row);
}

async function updateCustomerFields(id, fields) {
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
    UPDATE customers
    SET ${updates.join(', ')}, updated_at = now()
    WHERE id = $${values.length}
    RETURNING *;
  `;
  const { rows } = await pool.query(query, values);
  return rows[0] || null;
}

async function deactivateCustomer(id) {
  const query = `
    UPDATE customers
    SET is_active = false, updated_at = now()
    WHERE id = $1
    RETURNING *;
  `;
  const { rows } = await pool.query(query, [id]);
  return rows[0] || null;
}

module.exports = {
  mapCustomer,
  insertCustomer,
  insertCustomerAdmin,
  findCustomerByEmail,
  findCustomerById,
  updateCustomerFields,
  deactivateCustomer,
};
