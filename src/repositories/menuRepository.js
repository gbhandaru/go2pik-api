const pool = require('../config/db');

async function runQuery(db, query, params) {
  const executor = db || pool;
  return executor.query(query, params);
}

async function listMenuItems(restaurantId, db = pool) {
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
  const { rows } = await runQuery(db, query, [restaurantId]);
  return rows;
}

async function insertMenuItem(restaurantId, fields, db = pool) {
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
  const { rows } = await runQuery(db, query, values);
  return rows[0] || null;
}

async function updateMenuItem(menuItemId, fields, db = pool) {
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
  const { rows } = await runQuery(db, query, values);
  return rows[0] || null;
}

async function getMenuItemById(menuItemId, restaurantId, db = pool) {
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
    WHERE mi.id = $1 AND mi.restaurant_id = $2
    LIMIT 1;
  `;
  const { rows } = await runQuery(db, query, [menuItemId, restaurantId]);
  return rows[0] || null;
}

async function setMenuItemAvailability(menuItemId, isAvailable, db = pool) {
  const query = `
    UPDATE menu_items
    SET is_available = $1
    WHERE id = $2
    RETURNING *;
  `;
  const { rows } = await runQuery(db, query, [isAvailable, menuItemId]);
  return rows[0] || null;
}

async function listMenuCategories(restaurantId, db = pool) {
  const query = `
    SELECT
      mc.id,
      mc.restaurant_id,
      mc.name,
      mc.display_order,
      mc.is_active
    FROM menu_categories mc
    WHERE mc.restaurant_id = $1
    ORDER BY mc.display_order ASC NULLS LAST, mc.id ASC;
  `;
  const { rows } = await runQuery(db, query, [restaurantId]);
  return rows;
}

async function insertMenuCategory(restaurantId, fields, db = pool) {
  const allowed = ['name', 'display_order', 'is_active'];
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
    INSERT INTO menu_categories (${columns.join(', ')})
    VALUES (${placeholders.join(', ')})
    RETURNING *;
  `;
  const { rows } = await runQuery(db, query, values);
  return rows[0] || null;
}

async function updateMenuCategory(categoryId, restaurantId, fields, db = pool) {
  const allowed = ['name', 'display_order', 'is_active'];
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
  values.push(categoryId);
  values.push(restaurantId);
  const query = `
    UPDATE menu_categories
    SET ${updates.join(', ')}
    WHERE id = $${values.length - 1} AND restaurant_id = $${values.length}
    RETURNING *;
  `;
  const { rows } = await runQuery(db, query, values);
  return rows[0] || null;
}

async function getMenuCategoryById(categoryId, restaurantId, db = pool) {
  const query = `
    SELECT
      mc.id,
      mc.restaurant_id,
      mc.name,
      mc.display_order,
      mc.is_active
    FROM menu_categories mc
    WHERE mc.id = $1 AND mc.restaurant_id = $2
    LIMIT 1;
  `;
  const { rows } = await runQuery(db, query, [categoryId, restaurantId]);
  return rows[0] || null;
}

async function setMenuItemAvailability(menuItemId, isAvailable, db = pool) {
  const query = `
    UPDATE menu_items
    SET is_available = $1
    WHERE id = $2
    RETURNING *;
  `;
  const { rows } = await runQuery(db, query, [isAvailable, menuItemId]);
  return rows[0] || null;
}

module.exports = {
  listMenuItems,
  insertMenuItem,
  updateMenuItem,
  getMenuItemById,
  setMenuItemAvailability,
  listMenuCategories,
  insertMenuCategory,
  updateMenuCategory,
  getMenuCategoryById,
};
