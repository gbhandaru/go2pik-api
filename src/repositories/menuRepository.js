const pool = require('../config/db');

async function listMenuItems(restaurantId) {
  const query = `
    SELECT
      mi.id,
      mi.category_id,
      mi.name,
      mi.description,
      mi.price,
      mi.is_vegetarian,
      mi.is_vegan,
      mi.is_available,
      mi.display_order
    FROM menu_items mi
    WHERE mi.restaurant_id = $1
    ORDER BY mi.category_id ASC NULLS LAST, mi.display_order ASC, mi.id ASC;
  `;
  const { rows } = await pool.query(query, [restaurantId]);
  return rows;
}

async function insertMenuItem(restaurantId, fields) {
  const allowed = ['category_id', 'name', 'description', 'price', 'is_vegetarian', 'is_vegan', 'is_available'];
  const columns = ['restaurant_id'];
  const values = [restaurantId];
  const placeholders = ['$1'];
  let idx = 2;
  allowed.forEach((field) => {
    if (fields[field] !== undefined) {
      columns.push(field);
      values.push(fields[field]);
      placeholders.push(`$${idx}`);
      idx += 1;
    }
  });
  const query = `
    INSERT INTO menu_items (${columns.join(', ')})
    VALUES (${placeholders.join(', ')})
    RETURNING *;
  `;
  const { rows } = await pool.query(query, values);
  return rows[0] || null;
}

async function updateMenuItem(menuItemId, fields) {
  const allowed = ['category_id', 'name', 'description', 'price', 'is_vegetarian', 'is_vegan', 'is_available'];
  const updates = [];
  const values = [];
  allowed.forEach((field) => {
    if (fields[field] !== undefined) {
      values.push(fields[field]);
      updates.push(`${field} = $${values.length}`);
    }
  });
  if (updates.length === 0) {
    return null;
  }
  values.push(menuItemId);
  const query = `
    UPDATE menu_items
    SET ${updates.join(', ')}
    WHERE id = $${values.length}
    RETURNING *;
  `;
  const { rows } = await pool.query(query, values);
  return rows[0] || null;
}

async function setMenuItemAvailability(menuItemId, isAvailable) {
  const query = `
    UPDATE menu_items
    SET is_available = $1
    WHERE id = $2
    RETURNING *;
  `;
  const { rows } = await pool.query(query, [isAvailable, menuItemId]);
  return rows[0] || null;
}

module.exports = {
  listMenuItems,
  insertMenuItem,
  updateMenuItem,
  setMenuItemAvailability,
};
