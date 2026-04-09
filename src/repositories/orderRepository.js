const pool = require('../config/db');

function generateOrderNumber() {
  return `FO-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

async function createOrderRecord({ restaurantId, customer, items, totals }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const query = `
      INSERT INTO orders (
        restaurant_id,
        order_number,
        customer_name,
        customer_phone,
        customer_email,
        pickup_time,
        notes,
        subtotal,
        tax_amount,
        total_amount,
        payment_mode,
        payment_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id;
    `;
    const params = [
      Number(restaurantId),
      generateOrderNumber(),
      customer.name || 'Guest',
      customer.phone || '',
      customer.email || null,
      customer.pickupTime ? new Date(customer.pickupTime) : null,
      customer.notes || null,
      totals.subtotal,
      totals.tax,
      totals.total,
      customer.paymentMode || 'pay_at_restaurant',
      'unpaid',
    ];
    const { rows } = await client.query(query, params);
    const orderId = rows[0].id;
    const insertItem = `
      INSERT INTO order_items (order_id, menu_item_id, item_name, unit_price, quantity, line_total, special_instructions)
      VALUES ($1, $2, $3, $4, $5, $6, $7);
    `;
    for (const item of items) {
      await client.query(insertItem, [
        orderId,
        item.id || null,
        item.name,
        item.price,
        item.quantity,
        item.lineTotal,
        item.notes || null,
      ]);
    }
    await client.query('COMMIT');
    return orderId;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getOrderById(orderId) {
  const query = `
    SELECT
      o.id,
      o.order_number,
      o.customer_name,
      o.customer_phone,
      o.customer_email,
      o.pickup_time,
      o.notes,
      o.subtotal,
      o.tax_amount,
      o.total_amount,
      o.status,
      o.payment_mode,
      o.payment_status,
      r.id AS restaurant_id,
      r.name AS restaurant_name,
      r.cuisine_type,
      r.city,
      r.state,
      COALESCE(
        json_agg(
          json_build_object(
            'menuItemId', oi.menu_item_id,
            'name', oi.item_name,
            'quantity', oi.quantity,
            'price', oi.unit_price,
            'lineTotal', oi.line_total,
            'specialInstructions', oi.special_instructions
          )
          ORDER BY oi.id ASC
        ) FILTER (WHERE oi.id IS NOT NULL),
        '[]'
      ) AS items
    FROM orders o
    JOIN restaurants r ON r.id = o.restaurant_id
    LEFT JOIN order_items oi ON oi.order_id = o.id
    WHERE o.id = $1
    GROUP BY o.id, r.id;
  `;
  const { rows } = await pool.query(query, [orderId]);
  if (rows.length === 0) {
    return null;
  }
  return rows[0];
}

async function listOrdersForRestaurant(restaurantId) {
  const query = `
    SELECT
      o.id,
      o.order_number,
      o.status,
      o.payment_status,
      o.customer_name,
      o.customer_phone,
      o.notes,
      o.subtotal,
      o.tax_amount,
      o.total_amount,
      o.created_at,
      o.pickup_time,
      o.completed_at,
      COALESCE(
        json_agg(
          json_build_object(
            'menuItemId', oi.menu_item_id,
            'name', oi.item_name,
            'quantity', oi.quantity,
            'price', oi.unit_price,
            'lineTotal', oi.line_total,
            'specialInstructions', oi.special_instructions
          )
          ORDER BY oi.id ASC
        ) FILTER (WHERE oi.id IS NOT NULL),
        '[]'::json
      ) AS items
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id = o.id
    WHERE o.restaurant_id = $1
    GROUP BY o.id
    ORDER BY o.created_at DESC
    LIMIT 200;
  `;
  const { rows } = await pool.query(query, [restaurantId]);
  return rows;
}

async function updateOrderStatus(orderId, updates) {
  const setStatements = [];
  const params = [];
  Object.entries(updates).forEach(([key, value]) => {
    if (value !== undefined) {
      params.push(value);
      setStatements.push(`${key} = $${params.length}`);
    }
  });
  if (setStatements.length === 0) {
    return null;
  }
  params.push(orderId);
  const query = `
    UPDATE orders
    SET ${setStatements.join(', ')}, updated_at = now()
    WHERE id = $${params.length}
    RETURNING *;
  `;
  const { rows } = await pool.query(query, params);
  return rows[0] || null;
}

module.exports = {
  createOrder: createOrderRecord,
  getOrderById,
  listOrdersForRestaurant,
  updateOrderStatus,
};
