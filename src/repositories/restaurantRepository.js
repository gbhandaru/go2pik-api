const pool = require('../config/db');
const fallbackData = require('../../data/restaurants.json');

const FALLBACK_RESTAURANTS = fallbackData.restaurants || [];

function formatLocation(row) {
  if (row.city || row.state) {
    return [row.city, row.state].filter(Boolean).join(', ');
  }
  return row.address_line1 || '';
}

function formatAddress(row) {
  const formatted = formatLocation(row);
  return {
    line1: row.address_line1 || '',
    city: row.city || '',
    state: row.state || '',
    formatted,
  };
}

function formatMenuItemFromRow(row) {
  return {
    id: row.menu_item_id,
    sku: row.menu_item_id,
    name: row.menu_item_name,
    description: row.menu_item_description,
    price: row.menu_item_price ? Number(row.menu_item_price) : null,
    isVegetarian: row.is_vegetarian,
    isVegan: row.is_vegan,
    imageUrl: row.image_url,
  };
}

function groupRestaurants(rows) {
  const map = new Map();
  rows.forEach((row) => {
    if (!map.has(row.restaurant_id)) {
      map.set(row.restaurant_id, {
        id: row.restaurant_id,
        slug: row.slug,
        name: row.restaurant_name,
        cuisine: row.cuisine_type,
        location: formatLocation(row),
        address: formatAddress(row),
        categories: [],
        uncategorized: [],
      });
    }
    const restaurant = map.get(row.restaurant_id);
    if (!row.menu_item_id) {
      return;
    }
    const item = formatMenuItemFromRow(row);
    if (row.category_id) {
      let category = restaurant.categories.find((cat) => cat.id === row.category_id);
      if (!category) {
        category = {
          id: row.category_id,
          name: row.category_name,
          displayOrder: row.category_display_order,
          items: [],
        };
        restaurant.categories.push(category);
      }
      category.items.push(item);
    } else {
      restaurant.uncategorized.push(item);
    }
  });

  return Array.from(map.values()).map((restaurant) => {
    restaurant.categories.sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
    if (restaurant.uncategorized.length > 0) {
      restaurant.categories.push({
        id: 'uncategorized',
        name: 'Menu',
        displayOrder: Number.MAX_SAFE_INTEGER,
        items: restaurant.uncategorized,
      });
    }
    restaurant.menu = restaurant.categories.flatMap((category) => category.items);
    delete restaurant.uncategorized;
    return restaurant;
  });
}

async function fetchRestaurantsFromDb({ restaurantId, city } = {}) {
  const params = [];
  const conditions = [];
  const dbNameResult = await pool.query('select current_database() as db, current_user as usr');
  console.log('[db-check]', dbNameResult.rows[0]);
  if (restaurantId) {
    params.push(restaurantId);
    conditions.push(`r.id = $${params.length}`);
  }
  if (city) {
    params.push(city.toLowerCase());
    conditions.push(`LOWER(r.city) = $${params.length}`);
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const query = `
    SELECT
      r.id as restaurant_id,
      r.slug,
      r.name AS restaurant_name,
      r.cuisine_type,
      r.city,
      r.state,
      r.address_line1,
      mc.id AS category_id,
      mc.name AS category_name,
      mc.display_order AS category_display_order,
      mi.id AS menu_item_id,
      mi.name AS menu_item_name,
      mi.description AS menu_item_description,
      mi.price AS menu_item_price,
      mi.is_vegetarian,
      mi.is_vegan,
      mi.image_url
    FROM restaurants r
    LEFT JOIN menu_items mi ON mi.restaurant_id = r.id AND mi.is_available = true AND mi.deleted_at IS NULL
    LEFT JOIN menu_categories mc ON mc.id = mi.category_id AND mc.is_active = true
    ${whereClause}
    ORDER BY r.name ASC, mc.display_order ASC NULLS LAST, mi.display_order ASC NULLS LAST, mi.id ASC;
  `;
  const { rows } = await pool.query(query, params);
  return groupRestaurants(rows);
}

function convertFallbackRestaurant(rest) {
  const items = (rest.menu || []).map((item, idx) => ({
    id: item.id || item.sku || idx,
    sku: item.sku || item.id || idx,
    name: item.name,
    description: item.description,
    price: Number(item.price),
    isVegetarian: Boolean(item.isVegetarian || item.is_vegetarian),
    isVegan: Boolean(item.isVegan || item.is_vegan),
    imageUrl: item.imageUrl || item.image_url,
  }));
  return {
    id: rest.id,
    slug: rest.slug || rest.id,
    name: rest.name,
    cuisine: rest.cuisine_type || rest.cuisine,
    location: rest.location || rest.address?.formatted || '',
    address: rest.address || {
      line1: rest.location || '',
      city: '',
      state: '',
      formatted: rest.location || '',
    },
    categories: [
      {
        id: 'menu',
        name: 'Menu',
        displayOrder: 0,
        items,
      },
    ],
    menu: items,
    pickupHours: rest.pickupHours || rest.openHours || rest.hours || null,
  };
}

function getFallbackRestaurants() {
  return FALLBACK_RESTAURANTS.map(convertFallbackRestaurant);
}

function getFallbackRestaurantById(restaurantId) {
  const match = FALLBACK_RESTAURANTS.find((rest) => String(rest.id) === String(restaurantId));
  return match ? convertFallbackRestaurant(match) : null;
}

module.exports = {
  fetchRestaurantsFromDb,
  getFallbackRestaurants,
  getFallbackRestaurantById,
};
