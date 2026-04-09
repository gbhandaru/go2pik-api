const ApiError = require('../utils/errors');
const {
  listMenuItems,
  insertMenuItem,
  updateMenuItem,
  setMenuItemAvailability,
} = require('../repositories/menuRepository');

function mapMenu(row) {
  if (!row) return null;
  return {
    id: row.id,
    category_id: row.category_id,
    name: row.name,
    description: row.description,
    price: Number(row.price),
    is_vegetarian: row.is_vegetarian,
    is_vegan: row.is_vegan,
    is_available: row.is_available,
    display_order: row.display_order,
  };
}

async function getMenuItems(restaurantId) {
  const rows = await listMenuItems(restaurantId);
  return rows.map(mapMenu);
}

async function addMenuItem(restaurantId, payload = {}) {
  if (!payload.name || payload.price === undefined) {
    throw ApiError.badRequest('name and price are required');
  }
  const row = await insertMenuItem(restaurantId, payload);
  return mapMenu(row);
}

async function editMenuItem(menuItemId, payload = {}) {
  const allowed = ['category_id', 'name', 'description', 'price', 'is_vegetarian', 'is_vegan', 'is_available'];
  const hasUpdates = allowed.some((field) => payload[field] !== undefined);
  if (!hasUpdates) {
    throw ApiError.badRequest('No fields to update');
  }
  const row = await updateMenuItem(menuItemId, payload);
  if (!row) {
    throw ApiError.notFound('Menu item not found');
  }
  return mapMenu(row);
}

async function toggleMenuItemAvailability(menuItemId, isAvailable) {
  const row = await setMenuItemAvailability(menuItemId, isAvailable);
  if (!row) {
    throw ApiError.notFound('Menu item not found');
  }
  return mapMenu(row);
}

module.exports = {
  getMenuItems,
  addMenuItem,
  editMenuItem,
  toggleMenuItemAvailability,
};
