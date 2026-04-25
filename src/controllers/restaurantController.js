const asyncHandler = require('../utils/asyncHandler');
const {
  createRestaurant,
  getAllRestaurants,
  getRestaurantById,
  decorateRestaurant,
} = require('../services/restaurantService');

const createRestaurantRecord = asyncHandler(async (req, res) => {
  const restaurant = await createRestaurant(req.body || {});
  res.status(201).json({ restaurant });
});

const listRestaurants = asyncHandler(async (req, res) => {
  const { city } = req.query;
  const restaurants = await getAllRestaurants(city ? { city } : {});
  res.json(restaurants.map(decorateRestaurant));
});

const getRestaurantMenu = asyncHandler(async (req, res) => {
  const restaurant = await getRestaurantById(req.params.id);
  res.json({
    restaurant: {
      id: restaurant.id,
      name: restaurant.name,
      cuisine: restaurant.cuisine,
      location: restaurant.location,
      address: restaurant.address,
      openHours: restaurant.openHours,
      pickupAvailability: restaurant.pickupAvailability,
      isOpenNow: restaurant.isOpenNow,
      asapAllowed: restaurant.asapAllowed,
    },
    pickupAvailability: restaurant.pickupAvailability,
    categories: restaurant.categories,
    menu: restaurant.menu,
  });
});

module.exports = {
  createRestaurant: createRestaurantRecord,
  listRestaurants,
  getRestaurantMenu,
};
