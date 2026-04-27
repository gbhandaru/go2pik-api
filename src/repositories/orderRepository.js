const pool = require('../config/db');
const ApiError = require('../utils/errors');
const { normalizePhoneNumber } = require('../utils/phone');
const {
  findPromotionById,
  getPromotionUsageCounts,
  insertPromotionUsage,
} = require('./promotions.repository');

function normalizeIdList(values = []) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => {
          if (value === null || value === undefined || value === '') {
            return null;
          }
          const id = Number(value);
          return Number.isFinite(id) ? id : null;
        })
        .filter((value) => value !== null)
    )
  );
}

function assertInsertArity(context, targetColumns, valueExpressions) {
  if (targetColumns.length !== valueExpressions.length) {
    throw ApiError.badRequest(
      `${context} insert configuration is invalid: expected ${targetColumns.length} values, received ${valueExpressions.length}`
    );
  }
}

async function createOrderRecord({ restaurantId, customer, items, totals, promotion = null }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const normalizedCustomerPhone = normalizePhoneNumber(customer.phone || '');
    const appliedFinalAmount = promotion?.finalAmount !== undefined && promotion?.finalAmount !== null
      ? Number(promotion.finalAmount)
      : totals.total;
    const appliedDiscountAmount = promotion?.discountAmount !== undefined && promotion?.discountAmount !== null
      ? Number(promotion.discountAmount)
      : 0;
    const params = [
      Number(restaurantId),
      customer.name || 'Guest',
      customer.phone || '',
      customer.email || null,
      customer.pickupTime ? new Date(customer.pickupTime) : null,
      customer.notes || null,
      totals.subtotal,
      totals.tax,
      appliedFinalAmount,
      promotion?.promotionId || null,
      promotion?.promotionCode || null,
      appliedDiscountAmount,
      appliedFinalAmount,
      customer.paymentMode || 'pay_at_restaurant',
      'unpaid',
      'new',
    ];
    const orderColumns = [
      'restaurant_id',
      'order_number',
      'customer_name',
      'customer_phone',
      'customer_email',
      'pickup_time',
      'notes',
      'subtotal',
      'tax_amount',
      'total_amount',
      'promotion_id',
      'promo_code',
      'discount_amount',
      'final_amount',
      'payment_mode',
      'payment_status',
      'status',
    ];
    const orderSelectExpressions = [
      '$1',
      "'R' || $1::text || '-' || LPAD(next_sequence.last_order_sequence::text, 5, '0')",
      '$2',
      '$3',
      '$4',
      '$5',
      '$6',
      '$7',
      '$8',
      '$9',
      '$10',
      '$11',
      '$12',
      '$13',
      '$14',
      '$15',
      '$16',
    ];
    assertInsertArity('Order', orderColumns, orderSelectExpressions);
    const query = `
      WITH next_sequence AS (
        INSERT INTO restaurant_order_counters (restaurant_id, last_order_sequence)
        VALUES ($1, 1)
        ON CONFLICT (restaurant_id)
        DO UPDATE SET
          last_order_sequence = restaurant_order_counters.last_order_sequence + 1,
          updated_at = now()
        RETURNING last_order_sequence
      )
      INSERT INTO orders (
        ${orderColumns.join(', ')}
      )
      SELECT
        ${orderSelectExpressions.join(',\n        ')}
      FROM next_sequence
      RETURNING id, order_number;
    `;
    const { rows } = await client.query(query, params);
    const orderId = rows[0].id;
    if (promotion?.promotionId) {
      const lockedPromotion = await findPromotionById(promotion.promotionId, client, { forUpdate: true });
      if (!lockedPromotion) {
        throw ApiError.badRequest('Promo code is invalid or already used');
      }
      if (!lockedPromotion.isActive) {
        throw ApiError.badRequest('Promo code is invalid or already used');
      }
      const usageCounts = await getPromotionUsageCounts(lockedPromotion.id, normalizedCustomerPhone, client);
      if (usageCounts.phoneUsage > 0) {
        throw ApiError.conflict('Promo code already used for this phone number');
      }
      if (usageCounts.totalUsage >= lockedPromotion.usageLimitTotal) {
        throw ApiError.conflict('Promo code usage limit has been reached');
      }
      await insertPromotionUsage(client, {
        promotionId: lockedPromotion.id,
        customerPhone: normalizedCustomerPhone,
        orderId,
      });
      console.log('[orderRepository] promotion applied during order creation', {
        orderId,
        promotionId: lockedPromotion.id,
        promotionCode: lockedPromotion.promoCode,
        customerPhone: normalizedCustomerPhone,
        discountAmount: appliedDiscountAmount,
        finalAmount: appliedFinalAmount,
      });
    }
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
    if (
      error?.code === '42601' &&
      typeof error?.message === 'string' &&
      error.message.toLowerCase().includes('insert has more expressions than target columns')
    ) {
      throw ApiError.badRequest('Order insert configuration is invalid. Please contact support.');
    }
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
      o.promotion_id,
      o.promo_code,
      o.discount_amount,
      o.final_amount,
      o.status,
      o.payment_mode,
      o.payment_status,
      o.accepted_at,
      o.acceptance_mode,
      o.kitchen_note,
      o.customer_action,
      o.customer_action_at,
      o.customer_action_note,
      r.id AS restaurant_id,
      r.name AS restaurant_name,
      r.cuisine_type,
      r.city,
      r.state,
      COALESCE(
        json_agg(
          json_build_object(
            'id', oi.id,
            'menuItemId', oi.menu_item_id,
            'name', oi.item_name,
            'quantity', oi.quantity,
            'price', oi.unit_price,
            'lineTotal', oi.line_total,
            'specialInstructions', oi.special_instructions,
            'isAvailable', COALESCE(oi.is_available, true),
            'availabilityNote', oi.availability_note,
            'markedUnavailableAt', oi.marked_unavailable_at
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

async function getOrderByOrderNumber(orderNumber) {
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
      o.promotion_id,
      o.promo_code,
      o.discount_amount,
      o.final_amount,
      o.status,
      o.payment_mode,
      o.payment_status,
      o.accepted_at,
      o.acceptance_mode,
      o.kitchen_note,
      o.customer_action,
      o.customer_action_at,
      o.customer_action_note,
      r.id AS restaurant_id,
      r.name AS restaurant_name,
      r.cuisine_type,
      r.city,
      r.state,
      COALESCE(
        json_agg(
          json_build_object(
            'id', oi.id,
            'menuItemId', oi.menu_item_id,
            'name', oi.item_name,
            'quantity', oi.quantity,
            'price', oi.unit_price,
            'lineTotal', oi.line_total,
            'specialInstructions', oi.special_instructions,
            'isAvailable', COALESCE(oi.is_available, true),
            'availabilityNote', oi.availability_note,
            'markedUnavailableAt', oi.marked_unavailable_at
          )
          ORDER BY oi.id ASC
        ) FILTER (WHERE oi.id IS NOT NULL),
        '[]'
      ) AS items
    FROM orders o
    JOIN restaurants r ON r.id = o.restaurant_id
    LEFT JOIN order_items oi ON oi.order_id = o.id
    WHERE o.order_number = $1
    GROUP BY o.id, r.id;
  `;
  const { rows } = await pool.query(query, [orderNumber]);
  if (rows.length === 0) {
    return null;
  }
  return rows[0];
}

async function listOrders({
  restaurantId = null,
  customerEmail = null,
  customerPhone = null,
  status = null,
  completedDate = null,
  createdFrom = null,
  createdTo = null,
  timezone = 'America/Los_Angeles',
  limit = 200,
} = {}) {
  const whereClauses = [];
  const params = [];

  if (restaurantId !== null && restaurantId !== undefined && restaurantId !== '') {
    params.push(Number(restaurantId));
    whereClauses.push(`o.restaurant_id = $${params.length}`);
  }

  if (status) {
    params.push(status);
    whereClauses.push(`LOWER(o.status) = LOWER($${params.length})`);
  }

  if (customerEmail) {
    params.push(customerEmail);
    whereClauses.push(`LOWER(o.customer_email) = LOWER($${params.length})`);
  } else if (customerPhone) {
    params.push(customerPhone);
    whereClauses.push(`o.customer_phone = $${params.length}`);
  }

  if (completedDate) {
    params.push(timezone);
    params.push(completedDate);
    whereClauses.push(`DATE(o.completed_at AT TIME ZONE $${params.length - 1}) = $${params.length}::date`);
  }

  if (createdFrom) {
    params.push(timezone);
    params.push(createdFrom);
    whereClauses.push(`DATE(o.created_at AT TIME ZONE $${params.length - 1}) >= $${params.length}::date`);
  }

  if (createdTo) {
    params.push(timezone);
    params.push(createdTo);
    whereClauses.push(`DATE(o.created_at AT TIME ZONE $${params.length - 1}) <= $${params.length}::date`);
  }

  if (limit !== null && limit !== undefined) {
    params.push(limit);
  }

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
      o.promotion_id,
      o.promo_code,
      o.discount_amount,
      o.final_amount,
      o.status,
      o.payment_mode,
      o.payment_status,
      o.accepted_at,
      o.acceptance_mode,
      o.kitchen_note,
      o.customer_action,
      o.customer_action_at,
      o.customer_action_note,
      o.created_at,
      o.completed_at,
      r.id AS restaurant_id,
      r.name AS restaurant_name,
      r.cuisine_type,
      r.city,
      r.state,
      COALESCE(
        json_agg(
          json_build_object(
            'id', oi.id,
            'menuItemId', oi.menu_item_id,
            'name', oi.item_name,
            'quantity', oi.quantity,
            'price', oi.unit_price,
            'lineTotal', oi.line_total,
            'specialInstructions', oi.special_instructions,
            'isAvailable', COALESCE(oi.is_available, true),
            'availabilityNote', oi.availability_note,
            'markedUnavailableAt', oi.marked_unavailable_at
          )
          ORDER BY oi.id ASC
        ) FILTER (WHERE oi.id IS NOT NULL),
        '[]'
      ) AS items
    FROM orders o
    JOIN restaurants r ON r.id = o.restaurant_id
    LEFT JOIN order_items oi ON oi.order_id = o.id
    ${whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''}
    GROUP BY o.id, r.id
    ORDER BY o.created_at DESC
    ${limit !== null && limit !== undefined ? `LIMIT $${params.length};` : ';'}
  `;
  const { rows } = await pool.query(query, params);
  return rows;
}

async function listOrdersForRestaurant(restaurantId, { status = null, completedDate = null, timezone = 'America/Los_Angeles' } = {}) {
  return listOrders({ restaurantId, status, completedDate, timezone });
}

async function listOrdersForRestaurantReport(
  restaurantId,
  { createdFrom = null, createdTo = null, timezone = 'America/Los_Angeles' } = {}
) {
  return listOrders({ restaurantId, createdFrom, createdTo, timezone, limit: null });
}

async function listOrdersForCustomer({ customerEmail = null, customerPhone = null, status = null, completedDate = null, timezone = 'America/Los_Angeles' } = {}) {
  return listOrders({ customerEmail, customerPhone, status, completedDate, timezone });
}

function normalizeCustomerEmail(email) {
  return typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null;
}

function normalizeCustomerPhone(phone) {
  const normalized = normalizePhoneNumber(phone);
  return normalized || null;
}

function orderMatchesCustomer(order, customer = {}) {
  const orderEmail = normalizeCustomerEmail(order.customer_email);
  const customerEmail = normalizeCustomerEmail(customer.email);
  if (orderEmail && customerEmail && orderEmail === customerEmail) {
    return true;
  }
  const orderPhone = normalizeCustomerPhone(order.customer_phone);
  const customerPhone = normalizeCustomerPhone(customer.phone);
  if (orderPhone && customerPhone && orderPhone === customerPhone) {
    return true;
  }
  return false;
}

async function updateCustomerOrderAction(orderId, { customer, action, note = null } = {}) {
  const normalizedAction = String(action || '').trim().toLowerCase();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const orderResult = await client.query(
      `
      SELECT
        id,
        customer_email,
        customer_phone,
        acceptance_mode,
        customer_action,
        status
      FROM orders
      WHERE id = $1
      FOR UPDATE;
      `,
      [orderId]
    );
    if (orderResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    const order = orderResult.rows[0];
    if (!orderMatchesCustomer(order, customer)) {
      throw ApiError.forbidden('You are not authorized to access this order');
    }
    if (String(order.acceptance_mode || '').toLowerCase() !== 'partial') {
      throw ApiError.conflict('Customer action is only available for partially accepted orders');
    }
    if (String(order.status || '').toLowerCase() === 'cancelled' && normalizedAction !== 'cancelled') {
      throw ApiError.conflict('This order has already been cancelled');
    }
    if (normalizedAction === 'accepted') {
      if (String(order.customer_action || '').toLowerCase() === 'accepted') {
        await client.query('COMMIT');
        return getOrderById(orderId);
      }
      if (String(order.customer_action || '').toLowerCase() === 'cancelled') {
        throw ApiError.conflict('This order has already been cancelled');
      }
      await client.query(
        `
        UPDATE orders
        SET customer_action = 'accepted',
            customer_action_at = COALESCE(customer_action_at, now()),
            customer_action_note = NULL,
            updated_at = now()
        WHERE id = $1;
        `,
        [orderId]
      );
    } else if (normalizedAction === 'cancelled') {
      if (String(order.customer_action || '').toLowerCase() === 'cancelled') {
        await client.query('COMMIT');
        return getOrderById(orderId);
      }
      if (String(order.customer_action || '').toLowerCase() === 'accepted') {
        throw ApiError.conflict('This order has already been accepted by the customer');
      }
      await client.query(
        `
        UPDATE orders
        SET status = 'cancelled',
            customer_action = 'cancelled',
            customer_action_at = now(),
            customer_action_note = $2,
            updated_at = now()
        WHERE id = $1;
        `,
        [orderId, note || null]
      );
    } else {
      throw ApiError.badRequest('Unsupported customer action');
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return getOrderById(orderId);
}

async function partiallyAcceptOrder(orderId, {
  acceptedItemIds = [],
  unavailableItemIds = [],
  note = null,
  taxRate = 0.08,
} = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const orderResult = await client.query(
      `
      SELECT id, restaurant_id, status, acceptance_mode
      FROM orders
      WHERE id = $1
      FOR UPDATE;
      `,
      [orderId]
    );
    if (orderResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    const order = orderResult.rows[0];
    if (String(order.status || '').toLowerCase() !== 'new') {
      throw ApiError.conflict('Only new orders can be partially accepted');
    }

    const itemsResult = await client.query(
      `
      SELECT
        id,
        menu_item_id,
        item_name,
        unit_price,
        quantity,
        line_total,
        special_instructions,
        COALESCE(is_available, true) AS is_available,
        availability_note,
        marked_unavailable_at
      FROM order_items
      WHERE order_id = $1
      ORDER BY id ASC
      FOR UPDATE;
      `,
      [orderId]
    );

    const items = itemsResult.rows;
    if (items.length === 0) {
      throw ApiError.badRequest('Order has no items');
    }

    const acceptedIds = normalizeIdList(acceptedItemIds);
    const unavailableIds = normalizeIdList(unavailableItemIds);
    if (acceptedIds.length === 0) {
      throw ApiError.validation('partial_accept_requires_at_least_one_item', 'At least one item must be accepted');
    }

    const overlap = acceptedIds.filter((id) => unavailableIds.includes(id));
    if (overlap.length > 0) {
      throw ApiError.validation('partial_accept_duplicate_item_ids', 'Item ids cannot appear in both accepted and unavailable lists');
    }

    const orderItemIds = items.map((item) => Number(item.id));
    const unknownIds = [...acceptedIds, ...unavailableIds].filter((id) => !orderItemIds.includes(id));
    if (unknownIds.length > 0) {
      throw ApiError.validation('partial_accept_unknown_item_ids', 'One or more item ids do not belong to this order');
    }

    const classifiedIds = new Set([...acceptedIds, ...unavailableIds]);
    if (classifiedIds.size !== orderItemIds.length) {
      throw ApiError.validation(
        'partial_accept_requires_all_items_to_be_classified',
        'All order items must be marked as accepted or unavailable'
      );
    }

    const acceptedRows = items.filter((item) => acceptedIds.includes(Number(item.id)));
    const unavailableRows = items.filter((item) => unavailableIds.includes(Number(item.id)));

    for (const item of acceptedRows) {
      await client.query(
        `
        UPDATE order_items
        SET is_available = true,
            availability_note = NULL,
            marked_unavailable_at = NULL
        WHERE id = $1;
        `,
        [item.id]
      );
    }

    for (const item of unavailableRows) {
      await client.query(
        `
        UPDATE order_items
        SET is_available = false,
            availability_note = $2,
            marked_unavailable_at = now()
        WHERE id = $1;
        `,
        [item.id, note || null]
      );
    }

    const subtotal = acceptedRows.reduce((sum, item) => sum + Number(item.line_total || 0), 0);
    const taxAmount = Number((subtotal * Number(taxRate || 0)).toFixed(2));
    const totalAmount = Number((subtotal + taxAmount).toFixed(2));

    await client.query(
      `
      UPDATE orders
      SET subtotal = $2,
          tax_amount = $3,
          total_amount = $4,
          final_amount = $4,
          status = 'accepted',
          accepted_at = COALESCE(accepted_at, now()),
          acceptance_mode = 'partial',
          customer_action = 'pending',
          customer_action_at = NULL,
          customer_action_note = NULL,
          kitchen_note = $5,
          updated_at = now()
      WHERE id = $1;
      `,
      [orderId, subtotal, taxAmount, totalAmount, note || null]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return getOrderById(orderId);
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
  getOrderByOrderNumber,
  listOrders,
  listOrdersForRestaurant,
  listOrdersForRestaurantReport,
  listOrdersForCustomer,
  partiallyAcceptOrder,
  updateCustomerOrderAction,
  updateOrderStatus,
};
