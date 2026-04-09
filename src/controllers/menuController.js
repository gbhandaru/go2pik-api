const asyncHandler = require('../utils/asyncHandler');
const {
  getMenuItems,
  addMenuItem,
  editMenuItem,
  toggleMenuItemAvailability,
} = require('../services/menuService');

const listMenu = asyncHandler(async (req, res) => {
  const items = await getMenuItems(req.params.restaurantId);
  res.json({ success: true, items });
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

module.exports = {
  listMenu,
  createMenuItem,
  updateMenuItem: updateMenuItemRecord,
  toggleMenuAvailability,
};
