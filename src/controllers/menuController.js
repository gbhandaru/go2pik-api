const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/errors');
const {
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
} = require('../services/menuService');

function setNoStore(res) {
  res.set('Cache-Control', 'no-store');
}

function parseMaybeJson(value) {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      return value;
    }
  }
  return value;
}

function parseMultipartImportBody(req) {
  const file = req.file || (Array.isArray(req.files) ? req.files[0] : null);
  if (file && file.buffer) {
    const raw = file.buffer.toString('utf8');
    const mimeType = String(file.mimetype || '').toLowerCase();
    const fileName = String(file.originalname || '').toLowerCase();
    const looksLikeJson = mimeType.includes('json') || fileName.endsWith('.json');
    const looksLikeCsv =
      mimeType.includes('csv') ||
      fileName.endsWith('.csv') ||
      mimeType === 'text/plain' ||
      mimeType.startsWith('text/');

    if (looksLikeJson) {
      return JSON.parse(raw);
    }
    if (looksLikeCsv || raw.includes(',')) {
      return raw;
    }
    return raw;
  }

  const body = req.body || {};
  if (typeof body === 'string') {
    return body;
  }

  if (body.payload !== undefined) {
    return parseMaybeJson(body.payload);
  }

  const normalized = { ...body };
  ['categories', 'items', 'uncategorized_items'].forEach((key) => {
    if (typeof normalized[key] === 'string') {
      normalized[key] = parseMaybeJson(normalized[key]);
    }
  });

  return normalized;
}

const listMenu = asyncHandler(async (req, res) => {
  setNoStore(res);
  const items = await getMenuItems(req.params.restaurantId);
  res.json({ success: true, items });
});

const listMenuCategoriesRecord = asyncHandler(async (req, res) => {
  setNoStore(res);
  const categories = await getMenuCategories(req.params.restaurantId);
  res.json({ success: true, categories });
});

const createMenuItem = asyncHandler(async (req, res) => {
  const item = await addMenuItem(req.params.restaurantId, req.body || {});
  res.status(201).json({ success: true, item });
});

const updateMenuItemRecord = asyncHandler(async (req, res) => {
  const item = await editMenuItem(req.params.menuItemId, req.body || {});
  res.json({ success: true, item });
});

const toggleMenuAvailability = asyncHandler(async (req, res) => {
  const { is_available: isAvailable } = req.body || {};
  if (typeof isAvailable !== 'boolean') {
    return res.status(400).json({ success: false, message: 'is_available boolean is required' });
  }
  const item = await toggleMenuItemAvailability(req.params.menuItemId, isAvailable);
  res.json({ success: true, item });
});

const deleteMenuItemRecord = asyncHandler(async (req, res) => {
  const item = await removeMenuItem(req.params.menuItemId);
  res.json({ success: true, item });
});

const createMenuCategory = asyncHandler(async (req, res) => {
  const category = await addMenuCategory(req.params.restaurantId, req.body || {});
  res.status(201).json({ success: true, category });
});

const updateMenuCategoryRecord = asyncHandler(async (req, res) => {
  const category = await editMenuCategory(req.params.restaurantId, req.params.categoryId, req.body || {});
  res.json({ success: true, category });
});

const exportMenu = asyncHandler(async (req, res) => {
  setNoStore(res);
  const payload = await getMenuExport(req.params.restaurantId);
  res.json({ success: true, ...payload });
});

const importMenu = asyncHandler(async (req, res) => {
  const result = await importMenuBulk(req.params.restaurantId, parseMultipartImportBody(req));
  res.status(201).json({ success: true, ...result });
});

module.exports = {
  listMenu,
  listMenuCategories: listMenuCategoriesRecord,
  createMenuItem,
  updateMenuItem: updateMenuItemRecord,
  toggleMenuAvailability,
  deleteMenuItem: deleteMenuItemRecord,
  createMenuCategory,
  updateMenuCategory: updateMenuCategoryRecord,
  exportMenu,
  importMenu,
};
