const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/errors');
const {
  getMenuItems,
  getMenuCategories,
  addMenuItem,
  editMenuItem,
  toggleMenuItemAvailability,
  addMenuCategory,
  editMenuCategory,
  getMenuExport,
  importMenuBulk,
} = require('../services/menuService');

const listMenu = asyncHandler(async (req, res) => {
  const items = await getMenuItems(req.params.restaurantId);
  res.json({ success: true, items });
});

const listMenuCategoriesRecord = asyncHandler(async (req, res) => {
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

const createMenuCategory = asyncHandler(async (req, res) => {
  const category = await addMenuCategory(req.params.restaurantId, req.body || {});
  res.status(201).json({ success: true, category });
});

const updateMenuCategoryRecord = asyncHandler(async (req, res) => {
  const category = await editMenuCategory(req.params.restaurantId, req.params.categoryId, req.body || {});
  res.json({ success: true, category });
});

const exportMenu = asyncHandler(async (req, res) => {
  const payload = await getMenuExport(req.params.restaurantId);
  res.json({ success: true, ...payload });
});

const importMenu = asyncHandler(async (req, res) => {
  const payload = req.body || {};
  const hasData =
    Array.isArray(payload.categories) ||
    Array.isArray(payload.items) ||
    Array.isArray(payload.uncategorized_items);
  if (!hasData) {
    throw ApiError.badRequest('categories, items, or uncategorized_items is required');
  }
  const result = await importMenuBulk(req.params.restaurantId, payload);
  res.status(201).json({ success: true, ...result });
});

module.exports = {
  listMenu,
  listMenuCategories: listMenuCategoriesRecord,
  createMenuItem,
  updateMenuItem: updateMenuItemRecord,
  toggleMenuAvailability,
  createMenuCategory,
  updateMenuCategory: updateMenuCategoryRecord,
  exportMenu,
  importMenu,
};
