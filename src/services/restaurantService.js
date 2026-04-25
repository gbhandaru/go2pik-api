const ApiError = require('../utils/errors');
const config = require('../config/env');
const { buildPickupAvailability, normalizePickupHours } = require('../utils/pickupHours');
const {
  createRestaurantRecord,
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

function normalizeSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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

async function createRestaurant(payload = {}) {
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  if (!name) {
    throw ApiError.badRequest('name is required');
  }
  const cuisineType = typeof payload.cuisine_type === 'string'
    ? payload.cuisine_type.trim()
    : typeof payload.cuisine === 'string'
      ? payload.cuisine.trim()
      : '';
  if (!cuisineType) {
    throw ApiError.badRequest('cuisine_type is required');
  }
  const slug = normalizeSlug(payload.slug || name);
  if (!slug) {
    throw ApiError.badRequest('slug could not be derived from name');
  }
  try {
    const row = await createRestaurantRecord({
      slug,
      name,
      cuisineType,
      city: payload.city || null,
      state: payload.state || null,
      addressLine1: payload.address_line1 || payload.addressLine1 || null,
    });
    if (!row) {
      throw new Error('Failed to create restaurant');
    }
    const restaurant = await fetchRestaurantById(row.id);
    return decorateRestaurant(restaurant);
  } catch (error) {
    if (error.code === '23505') {
      throw ApiError.conflict('Restaurant with this slug already exists');
    }
    throw error;
  }
}

module.exports = {
  createRestaurant,
  getAllRestaurants,
  getRestaurantById: async (id) => decorateRestaurant(await fetchRestaurantById(id)),
  decorateRestaurant,
};
