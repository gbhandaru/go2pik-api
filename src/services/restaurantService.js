const ApiError = require('../utils/errors');
const config = require('../config/env');
const { buildPickupAvailability, normalizePickupHours } = require('../utils/pickupHours');
const {
  fetchRestaurantsFromDb,
  getFallbackRestaurants,
  getFallbackRestaurantById,
} = require('../repositories/restaurantRepository');

function decorateMenuItem(item) {
  const numericPrice = Number(item.price);
  return {
    ...item,
    price: Number.isFinite(numericPrice) ? numericPrice : 0,
  };
}

function decorateRestaurant(restaurant) {
  const fallbackRestaurant = getFallbackRestaurantById(restaurant.id);
  const pickupHoursSource =
    restaurant.pickupHours ||
    restaurant.openHours ||
    restaurant.hours ||
    fallbackRestaurant?.pickupHours ||
    fallbackRestaurant?.openHours ||
    fallbackRestaurant?.hours ||
    {};
  const pickupHours = normalizePickupHours(pickupHoursSource);
  const pickupAvailability = buildPickupAvailability(pickupHours);
  const categories = (restaurant.categories || []).map((category) => ({
    ...category,
    items: (category.items || []).map(decorateMenuItem),
  }));
  return {
    ...restaurant,
    openHours: pickupHours,
    pickupHours,
    pickupAvailability,
    isOpenNow: pickupAvailability.isOpenNow,
    asapAllowed: pickupAvailability.asapAllowed,
    categories,
    menu: (restaurant.menu || []).map(decorateMenuItem),
  };
}

async function getAllRestaurants(filter = {}) {
  try {
    const restaurants = await fetchRestaurantsFromDb(filter);
    if (restaurants.length === 0) {
    if(config.deploymentStage === 'production') {
    return [];
    }
      return getFallbackRestaurants();
    }
    return restaurants;
  } catch (error) {
    console.warn('[restaurantService] falling back to static data', error.message);
        if(config.deploymentStage === 'production') {
        throw error;
        }
    return getFallbackRestaurants();
  }
}

async function fetchRestaurantById(restaurantId) {
  try {
    const [restaurant] = await fetchRestaurantsFromDb({ restaurantId });
    if (restaurant) {
      return restaurant;
    }
    const fallback = getFallbackRestaurantById(restaurantId);
    if (!fallback) {
      throw ApiError.notFound('Restaurant not found');
    }
    return fallback;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    console.warn('[restaurantService] fallback for id', restaurantId, error.message);
    const fallback = getFallbackRestaurantById(restaurantId);
    if (!fallback) {
      throw ApiError.notFound('Restaurant not found');
    }
    return fallback;
  }
}

module.exports = {
  getAllRestaurants,
  getRestaurantById: async (id) => decorateRestaurant(await fetchRestaurantById(id)),
  decorateRestaurant,
};
