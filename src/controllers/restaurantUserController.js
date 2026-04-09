const asyncHandler = require('../utils/asyncHandler');
const { createUser, listUsers, updateUser, deactivate } = require('../services/restaurantUserService');

const createUserForRestaurant = asyncHandler(async (req, res) => {
  const user = await createUser(req.params.restaurantId, req.body || {});
  res.status(201).json({ user });
});

const listUsersForRestaurant = asyncHandler(async (req, res) => {
  const users = await listUsers(req.params.restaurantId);
  res.json({ users });
});

const editRestaurantUser = asyncHandler(async (req, res) => {
  const user = await updateUser(req.params.id, req.body || {});
  res.json({ user });
});

const deactivateRestaurantUser = asyncHandler(async (req, res) => {
  const user = await deactivate(req.params.id);
  res.json({ user });
});

module.exports = {
  createUserForRestaurant,
  listUsersForRestaurant,
  editRestaurantUser,
  deactivateRestaurantUser,
};
