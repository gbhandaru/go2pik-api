const pool = require('../config/db');
const ApiError = require('../utils/errors');
const {
  listMenuItems,
  insertMenuItem,
  updateMenuItem,
  getMenuItemById,
  setMenuItemAvailability,
  deleteMenuItem,
  listMenuCategories,
  insertMenuCategory,
  updateMenuCategory,
  getMenuCategoryById,
} = require('../repositories/menuRepository');
const { getRestaurantById } = require('./restaurantService');

function splitCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const nextChar = line[i + 1];
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }
    current += char;
  }

  values.push(current);
  return values.map((value) => value.trim());
}

function parseCsvText(csvText) {
  const text = String(csvText || '').replace(/^\uFEFF/, '').trim();
  if (!text) {
    return [];
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return [];
  }

  const headers = splitCsvLine(lines[0]).map((header) => header.toLowerCase());
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    return headers.reduce((acc, header, index) => {
      acc[header] = cells[index] !== undefined ? cells[index] : '';
      return acc;
    }, {});
  });
}

function parseBoolean(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'n'].includes(normalized)) {
    return false;
  }
  return undefined;
}

function parseNumber(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function parseMenuImportCsv(csvText) {
  const rows = parseCsvText(csvText);
  if (rows.length === 0) {
    throw ApiError.badRequest('CSV must contain a header row and at least one data row');
  }

  const categoriesByKey = new Map();
  const categories = [];
  const items = [];
  const uncategorized_items = [];

  rows.forEach((row) => {
    const categoryId = parseNumber(row.category_id);
    const categoryName = row.category_name || '';
    const categoryDisplayOrder = parseNumber(row.category_display_order);
    const categoryIsActive = parseBoolean(row.category_is_active);

    const itemId = parseNumber(row.item_id);
    const itemName = row.item_name || row.name || '';
    const itemDescription = row.item_description || row.description || undefined;
    const itemPrice = parseNumber(row.item_price || row.price);
    const itemIsAvailable = parseBoolean(row.item_is_available || row.is_available);
    const itemIsVegetarian = parseBoolean(row.item_is_vegetarian || row.is_vegetarian);
    const itemIsVegan = parseBoolean(row.item_is_vegan || row.is_vegan);
    const itemDisplayOrder = parseNumber(row.item_display_order || row.display_order);

    const hasCategoryFields =
      categoryName !== '' ||
      categoryDisplayOrder !== undefined ||
      categoryIsActive !== undefined;
    const hasItemFields =
      itemName !== '' ||
      itemDescription !== undefined ||
      itemPrice !== undefined ||
      itemIsAvailable !== undefined ||
      itemIsVegetarian !== undefined ||
      itemIsVegan !== undefined ||
      itemDisplayOrder !== undefined ||
      itemId !== undefined;

    let category = null;
    if (hasCategoryFields) {
      const categoryKey = categoryId !== undefined ? `id:${categoryId}` : `name:${categoryName.toLowerCase()}`;
      category = categoriesByKey.get(categoryKey);
      if (!category) {
        category = {};
        if (categoryId !== undefined) {
          category.id = categoryId;
        }
        if (categoryName !== '') {
          category.name = categoryName;
        }
        if (categoryDisplayOrder !== undefined) {
          category.display_order = categoryDisplayOrder;
        }
        if (categoryIsActive !== undefined) {
          category.is_active = categoryIsActive;
        }
        category.items = [];
        categoriesByKey.set(categoryKey, category);
        categories.push(category);
      } else {
        if (categoryId !== undefined && category.id === undefined) {
          category.id = categoryId;
        }
        if (categoryName !== '') {
          category.name = categoryName;
        }
        if (categoryDisplayOrder !== undefined) {
          category.display_order = categoryDisplayOrder;
        }
        if (categoryIsActive !== undefined) {
          category.is_active = categoryIsActive;
        }
      }
    }

    if (hasItemFields) {
      const item = {};
      if (itemId !== undefined) {
        item.id = itemId;
      }
      if (itemName !== '') {
        item.name = itemName;
      }
      if (itemDescription !== undefined) {
        item.description = itemDescription;
      }
      if (itemPrice !== undefined) {
        item.price = itemPrice;
      }
      if (itemIsAvailable !== undefined) {
        item.is_available = itemIsAvailable;
      }
      if (itemIsVegetarian !== undefined) {
        item.is_vegetarian = itemIsVegetarian;
      }
      if (itemIsVegan !== undefined) {
        item.is_vegan = itemIsVegan;
      }
      if (itemDisplayOrder !== undefined) {
        item.display_order = itemDisplayOrder;
      }
      if (categoryId !== undefined) {
        item.category_id = categoryId;
      }

      if (category) {
        category.items.push(item);
      } else if (categoryId !== undefined) {
        items.push(item);
      } else {
        uncategorized_items.push(item);
      }
    }
  });

  const categoryRows = categories.map((category) => {
    const row = { ...category };
    delete row.items;
    return row;
  });

  return {
    categories: categoryRows,
    items,
    uncategorized_items,
    categoriesWithItems: categories,
  };
}

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

function mapMenuCategory(row) {
  if (!row) return null;
  return {
    id: row.id,
    restaurant_id: row.restaurant_id,
    name: row.name,
    display_order: row.display_order,
    is_active: row.is_active,
  };
}

function splitMenuItemPayload(payload = {}) {
  return {
    ...(payload.category_id !== undefined ? { category_id: payload.category_id } : {}),
    ...(payload.categoryId !== undefined ? { category_id: payload.categoryId } : {}),
    ...(payload.name !== undefined ? { name: payload.name } : {}),
    ...(payload.description !== undefined ? { description: payload.description } : {}),
    ...(payload.price !== undefined ? { price: payload.price } : {}),
    ...(payload.is_vegetarian !== undefined ? { is_vegetarian: payload.is_vegetarian } : {}),
    ...(payload.isVegetarian !== undefined ? { is_vegetarian: payload.isVegetarian } : {}),
    ...(payload.is_vegan !== undefined ? { is_vegan: payload.is_vegan } : {}),
    ...(payload.isVegan !== undefined ? { is_vegan: payload.isVegan } : {}),
    ...(payload.is_available !== undefined ? { is_available: payload.is_available } : {}),
    ...(payload.isAvailable !== undefined ? { is_available: payload.isAvailable } : {}),
  };
}

function splitMenuCategoryPayload(payload = {}) {
  return {
    ...(payload.name !== undefined ? { name: payload.name } : {}),
    ...(payload.display_order !== undefined ? { display_order: payload.display_order } : {}),
    ...(payload.displayOrder !== undefined ? { display_order: payload.displayOrder } : {}),
    ...(payload.is_active !== undefined ? { is_active: payload.is_active } : {}),
    ...(payload.isActive !== undefined ? { is_active: payload.isActive } : {}),
  };
}

async function getMenuItems(restaurantId) {
  const rows = await listMenuItems(restaurantId);
  return rows.map(mapMenu);
}

async function getMenuCategories(restaurantId) {
  const rows = await listMenuCategories(restaurantId);
  return rows.map(mapMenuCategory);
}

async function addMenuItem(restaurantId, payload = {}) {
  if (!payload.name || payload.price === undefined) {
    throw ApiError.badRequest('name and price are required');
  }
  const row = await insertMenuItem(restaurantId, splitMenuItemPayload(payload));
  return mapMenu(row);
}

async function editMenuItem(menuItemId, payload = {}) {
  const updates = splitMenuItemPayload(payload);
  const hasUpdates = Object.keys(updates).length > 0;
  if (!hasUpdates) {
    throw ApiError.badRequest('No fields to update');
  }
  const row = await updateMenuItem(menuItemId, updates);
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

async function removeMenuItem(menuItemId) {
  const row = await deleteMenuItem(menuItemId);
  if (!row) {
    throw ApiError.notFound('Menu item not found');
  }
  return mapMenu(row);
}

async function addMenuCategory(restaurantId, payload = {}) {
  if (!payload.name || !String(payload.name).trim()) {
    throw ApiError.badRequest('name is required');
  }
  const row = await insertMenuCategory(restaurantId, splitMenuCategoryPayload(payload));
  return mapMenuCategory(row);
}

async function editMenuCategory(restaurantId, categoryId, payload = {}) {
  const updates = splitMenuCategoryPayload(payload);
  if (Object.keys(updates).length === 0) {
    throw ApiError.badRequest('No fields to update');
  }
  const row = await updateMenuCategory(categoryId, restaurantId, updates);
  if (!row) {
    throw ApiError.notFound('Menu category not found');
  }
  return mapMenuCategory(row);
}

function buildMenuExportPayload(restaurantId, restaurant, categories, items) {
  const categoryMap = new Map();
  const exportedCategories = categories.map((category) => {
    const mapped = {
      ...mapMenuCategory(category),
      items: [],
    };
    categoryMap.set(mapped.id, mapped);
    return mapped;
  });

  const uncategorizedItems = [];
  items.map(mapMenu).forEach((item) => {
    if (item.category_id === null || item.category_id === undefined) {
      uncategorizedItems.push(item);
      return;
    }
    const category = categoryMap.get(item.category_id);
    if (category) {
      category.items.push(item);
      return;
    }
    uncategorizedItems.push(item);
  });

  return {
    restaurant: restaurant
      ? {
          id: restaurant.id,
          name: restaurant.name,
          cuisine: restaurant.cuisine,
          location: restaurant.location,
        }
      : { id: restaurantId },
    categories: exportedCategories,
    uncategorized_items: uncategorizedItems,
  };
}

async function getMenuExport(restaurantId) {
  const [restaurant, categories, items] = await Promise.all([
    getRestaurantById(restaurantId).catch(() => null),
    listMenuCategories(restaurantId),
    listMenuItems(restaurantId),
  ]);
  return buildMenuExportPayload(restaurantId, restaurant, categories, items);
}

async function upsertMenuCategoryRecord(restaurantId, payload, db = pool) {
  const categoryFields = splitMenuCategoryPayload(payload);
  const hasExplicitId = payload.id !== undefined && payload.id !== null && payload.id !== '';
  if (hasExplicitId) {
    const row = await updateMenuCategory(payload.id, restaurantId, categoryFields, db);
    if (row) {
      return { row, action: 'updated' };
    }
  }
  if (!categoryFields.name || !String(categoryFields.name).trim()) {
    throw ApiError.badRequest('name is required');
  }
  return { row: await insertMenuCategory(restaurantId, categoryFields, db), action: 'created' };
}

async function upsertMenuItemRecord(restaurantId, payload, db = pool, categoryIdOverride = undefined) {
  const itemFields = splitMenuItemPayload(payload);
  if (categoryIdOverride !== undefined) {
    itemFields.category_id = categoryIdOverride;
  }
  const hasExplicitId = payload.id !== undefined && payload.id !== null && payload.id !== '';
  if (hasExplicitId) {
    const row = await updateMenuItem(payload.id, itemFields, db);
    if (row) {
      return { row, action: 'updated' };
    }
  }
  if (!itemFields.name || itemFields.price === undefined) {
    const existingItem = hasExplicitId ? await getMenuItemById(payload.id, restaurantId, db) : null;
    if (existingItem) {
      return { row: existingItem, action: 'unchanged' };
    }
    throw ApiError.badRequest('name and price are required');
  }
  return { row: await insertMenuItem(restaurantId, itemFields, db), action: 'created' };
}

async function importMenuBulk(restaurantId, payload = {}) {
  const normalizedPayload =
    typeof payload === 'string'
      ? parseMenuImportCsv(payload)
      : payload || {};
  const categoriesInput = Array.isArray(normalizedPayload.categoriesWithItems)
    ? normalizedPayload.categoriesWithItems
    : Array.isArray(normalizedPayload.categories)
      ? normalizedPayload.categories
      : [];
  const uncategorizedItemsInput = Array.isArray(normalizedPayload.uncategorized_items)
    ? normalizedPayload.uncategorized_items
    : [];
  const itemsInput = Array.isArray(normalizedPayload.items) ? normalizedPayload.items : [];

  if (categoriesInput.length === 0 && uncategorizedItemsInput.length === 0 && itemsInput.length === 0) {
    throw ApiError.badRequest('categories, items, or uncategorized_items is required');
  }

  const client = await pool.connect();
  const summary = {
    categoriesCreated: 0,
    categoriesUpdated: 0,
    itemsCreated: 0,
    itemsUpdated: 0,
  };

  try {
    await client.query('BEGIN');

    for (const categoryInput of categoriesInput) {
      const existingCategoryId = categoryInput?.id;
      const categoryFields = splitMenuCategoryPayload(categoryInput);
      let categoryRow = null;
      if (existingCategoryId !== undefined && existingCategoryId !== null && existingCategoryId !== '') {
        const currentCategory = await getMenuCategoryById(existingCategoryId, restaurantId, client);
        if (currentCategory) {
          if (Object.keys(categoryFields).length > 0) {
            categoryRow = await updateMenuCategory(existingCategoryId, restaurantId, categoryFields, client);
            summary.categoriesUpdated += 1;
          } else {
            categoryRow = currentCategory;
          }
        }
      }

      if (!categoryRow) {
        const categoryResult = await upsertMenuCategoryRecord(restaurantId, categoryInput, client);
        categoryRow = categoryResult.row;
        if (categoryResult.action === 'created') {
          summary.categoriesCreated += 1;
        } else if (categoryResult.action === 'updated') {
          summary.categoriesUpdated += 1;
        }
      }

      const nestedItems = Array.isArray(categoryInput.items) ? categoryInput.items : [];
      for (const itemInput of nestedItems) {
        const itemResult = await upsertMenuItemRecord(restaurantId, itemInput, client, categoryRow.id);
        if (itemResult.action === 'created') {
          summary.itemsCreated += 1;
        } else if (itemResult.action === 'updated') {
          summary.itemsUpdated += 1;
        }
      }
    }

    for (const itemInput of [...uncategorizedItemsInput, ...itemsInput]) {
      const itemResult = await upsertMenuItemRecord(restaurantId, itemInput, client);
      if (itemResult.action === 'created') {
        summary.itemsCreated += 1;
      } else if (itemResult.action === 'updated') {
        summary.itemsUpdated += 1;
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return {
    summary,
    export: await getMenuExport(restaurantId),
  };
}

module.exports = {
  getMenuItems,
  getMenuCategories,
  addMenuItem,
  editMenuItem,
  toggleMenuItemAvailability,
  removeMenuItem,
  addMenuCategory,
  editMenuCategory,
  getMenuExport,
  importMenuBulk,
};
