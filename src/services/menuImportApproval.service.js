const ApiError = require('../utils/errors');
const pool = require('../config/db');
const {
  getMenuImportById,
  updateMenuImport,
} = require('../repositories/menuImport.repository');
const {
  insertMenuCategory,
  insertMenuItem,
} = require('../repositories/menuRepository');

function parseMaybeJson(value) {
  if (value === undefined || value === null) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      throw ApiError.badRequest('parsedJson is invalid JSON');
    }
  }
  return value;
}

function normalizePrice(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const normalized = Number(trimmed.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(normalized) ? normalized : null;
  }
  return null;
}

function normalizeBoolean(value) {
  if (value === true || value === false) {
    return value;
  }
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'yes', 'y', '1'].includes(normalized)) {
      return true;
    }
    if (['false', 'no', 'n', '0'].includes(normalized)) {
      return false;
    }
  }
  return null;
}

function cleanName(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeReviewedParsedJson(parsedJson) {
  const payload = parseMaybeJson(parsedJson);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw ApiError.badRequest('parsedJson is missing or invalid');
  }

  const categories = Array.isArray(payload.categories) ? payload.categories : null;
  if (!categories) {
    throw ApiError.badRequest('parsedJson must include a categories array');
  }

  const normalizedCategories = [];

  categories.forEach((category) => {
    const categoryName = cleanName(category?.name);
    if (!categoryName) {
      return;
    }

    const items = Array.isArray(category?.items) ? category.items : [];
    const normalizedItems = [];

    items.forEach((item) => {
      const itemName = cleanName(item?.name);
      if (!itemName) {
        return;
      }

      const price = normalizePrice(item?.price);
      const isVegetarian = normalizeBoolean(item?.isVegetarian);
      const description =
        typeof item?.description === 'string' ? item.description.trim() : item?.description ?? null;

      if (item?.price !== null && item?.price !== undefined && price === null) {
        return;
      }

      normalizedItems.push({
        name: itemName,
        description: description === '' ? null : description,
        price,
        isVegetarian,
      });
    });

    if (normalizedItems.length === 0) {
      return;
    }

    normalizedCategories.push({
      name: categoryName,
      items: normalizedItems,
    });
  });

  return {
    categories: normalizedCategories,
  };
}

async function approveMenuImportById(id, reviewedParsedJsonInput) {
  if (id === undefined || id === null || String(id).trim() === '') {
    throw ApiError.badRequest('id is required');
  }

  const menuImport = await getMenuImportById(id);
  if (!menuImport) {
    throw ApiError.notFound('Menu import not found');
  }

  const status = String(menuImport.status || '').toUpperCase();
  if (status !== 'READY_FOR_REVIEW') {
    throw ApiError.badRequest('Menu import must be READY_FOR_REVIEW before approval');
  }

  console.log('[menuImportApproval] approval requested', {
    importId: id,
    restaurantId: menuImport.restaurantId,
  });

  const reviewedParsedJson = normalizeReviewedParsedJson(
    reviewedParsedJsonInput !== undefined && reviewedParsedJsonInput !== null
      ? reviewedParsedJsonInput
      : menuImport.parsedJson
  );

  const client = await pool.connect();
  const counts = {
    categoriesInserted: 0,
    itemsInserted: 0,
  };

  try {
    await client.query('BEGIN');

    const updatedMenuImport = await getMenuImportById(id, client);
    const freshStatus = String(updatedMenuImport?.status || '').toUpperCase();
    if (freshStatus !== 'READY_FOR_REVIEW') {
      throw ApiError.badRequest('Menu import must be READY_FOR_REVIEW before approval');
    }

    for (let categoryIndex = 0; categoryIndex < reviewedParsedJson.categories.length; categoryIndex += 1) {
      const category = reviewedParsedJson.categories[categoryIndex];
      const createdCategory = await insertMenuCategory(
        menuImport.restaurantId,
        {
          name: category.name,
          display_order: categoryIndex + 1,
          is_active: true,
        },
        client
      );

      counts.categoriesInserted += 1;

      const items = Array.isArray(category.items) ? category.items : [];
      for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
        const item = items[itemIndex];
        if (!item?.name) {
          continue;
        }

        await insertMenuItem(
          menuImport.restaurantId,
          {
            category_id: createdCategory.id,
            name: item.name,
            description: item.description ?? null,
            price: item.price,
            is_vegetarian: item.isVegetarian,
            is_available: true,
            display_order: itemIndex + 1,
          },
          client
        );
        counts.itemsInserted += 1;
      }
    }

    const finalMenuImport = await updateMenuImport(
      id,
      {
        parsed_json: reviewedParsedJson,
        status: 'APPROVED',
        error_message: null,
      },
      client
    );

    await client.query('COMMIT');

    console.log('[menuImportApproval] approval completed', {
      importId: id,
      categoriesInserted: counts.categoriesInserted,
      itemsInserted: counts.itemsInserted,
    });

    return {
      menuImport: finalMenuImport,
      ...counts,
      status: finalMenuImport?.status || 'APPROVED',
      message: 'Menu import approved and saved successfully',
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  approveMenuImportById,
};
