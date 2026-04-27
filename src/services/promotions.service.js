const ApiError = require('../utils/errors');
const { normalizePhoneNumber } = require('../utils/phone');
const {
  findPromotionByCode,
  findPromotionById,
  getPromotionUsageCounts,
} = require('../repositories/promotions.repository');

function normalizePromoCode(value) {
  return String(value || '').trim().toUpperCase();
}

function roundMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

function calculateDiscount(promotion, orderAmount) {
  const amount = roundMoney(orderAmount);
  if (!promotion || !Number.isFinite(amount)) {
    return 0;
  }
  const discountType = String(promotion.discountType || promotion.discount_type || '').trim().toUpperCase();
  const discountValue = Number(promotion.discountValue ?? promotion.discount_value ?? 0);
  let discount = 0;
  if (discountType === 'PERCENT') {
    discount = amount * (discountValue / 100);
  } else {
    discount = discountValue;
  }
  const maxDiscountAmount =
    promotion.maxDiscountAmount !== undefined && promotion.maxDiscountAmount !== null
      ? Number(promotion.maxDiscountAmount)
      : promotion.max_discount_amount !== undefined && promotion.max_discount_amount !== null
      ? Number(promotion.max_discount_amount)
      : null;
  if (Number.isFinite(maxDiscountAmount) && maxDiscountAmount >= 0) {
    discount = Math.min(discount, maxDiscountAmount);
  }
  discount = Math.min(discount, amount);
  return roundMoney(discount);
}

function formatDiscountMessage(discountAmount) {
  const rounded = roundMoney(discountAmount);
  return `$${rounded.toFixed(2)} discount applied`;
}

function buildInvalidResult(orderAmount, message = 'Promo code is invalid or already used') {
  const roundedOrderAmount = roundMoney(orderAmount);
  return {
    valid: false,
    promotionId: null,
    promoCode: null,
    discountAmount: 0,
    finalAmount: roundedOrderAmount,
    message,
  };
}

async function validatePromotion({
  promoCode,
  customerPhone,
  orderAmount,
  restaurantId,
  now = new Date(),
} = {}) {
  const normalizedPromoCode = normalizePromoCode(promoCode);
  const normalizedPhone = normalizePhoneNumber(customerPhone);
  const amount = Number(orderAmount);
  const restaurantIdNumber = restaurantId === null || restaurantId === undefined || restaurantId === ''
    ? null
    : Number(restaurantId);

  if (!normalizedPromoCode) {
    throw ApiError.badRequest('promoCode is required');
  }
  if (!normalizedPhone) {
    throw ApiError.badRequest('customerPhone is required');
  }
  if (!Number.isFinite(amount) || amount < 0) {
    throw ApiError.badRequest('orderAmount must be a valid number');
  }
  if (restaurantIdNumber === null || !Number.isFinite(restaurantIdNumber)) {
    throw ApiError.badRequest('restaurantId must be a valid number');
  }

  const promotion = await findPromotionByCode(normalizedPromoCode);
  if (!promotion) {
    console.warn('[promotions.service] validation failed: promotion not found', {
      promoCode: normalizedPromoCode,
      restaurantId: restaurantIdNumber,
    });
    return buildInvalidResult(amount);
  }

  if (!promotion.isActive) {
    console.warn('[promotions.service] validation failed: inactive promotion', {
      promotionId: promotion.id,
      promoCode: promotion.promoCode,
    });
    return buildInvalidResult(amount);
  }

  if (
    promotion.restaurantId !== null &&
    promotion.restaurantId !== undefined &&
    Number(promotion.restaurantId) !== restaurantIdNumber
  ) {
    console.warn('[promotions.service] validation failed: restaurant mismatch', {
      promotionId: promotion.id,
      promoCode: promotion.promoCode,
      restaurantId: restaurantIdNumber,
      promotionRestaurantId: promotion.restaurantId,
    });
    return buildInvalidResult(amount);
  }

  const currentTime = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(currentTime.getTime())) {
    throw ApiError.badRequest('now must be a valid date');
  }
  const startDate = promotion.startDate ? new Date(promotion.startDate) : null;
  const endDate = promotion.endDate ? new Date(promotion.endDate) : null;
  if (!startDate || !endDate || currentTime < startDate || currentTime > endDate) {
    console.warn('[promotions.service] validation failed: outside validity window', {
      promotionId: promotion.id,
      promoCode: promotion.promoCode,
      startDate: promotion.startDate,
      endDate: promotion.endDate,
      currentTime: currentTime.toISOString(),
    });
    return buildInvalidResult(amount);
  }

  if (amount < promotion.minOrderAmount) {
    console.warn('[promotions.service] validation failed: minimum order not met', {
      promotionId: promotion.id,
      promoCode: promotion.promoCode,
      orderAmount: amount,
      minOrderAmount: promotion.minOrderAmount,
    });
    return buildInvalidResult(amount);
  }

  const usageCounts = await getPromotionUsageCounts(promotion.id, normalizedPhone);
  if (usageCounts.phoneUsage > 0) {
    console.warn('[promotions.service] validation failed: promotion already used by phone', {
      promotionId: promotion.id,
      promoCode: promotion.promoCode,
      customerPhone: normalizedPhone,
    });
    return buildInvalidResult(amount);
  }
  if (usageCounts.totalUsage >= promotion.usageLimitTotal) {
    console.warn('[promotions.service] validation failed: promotion usage limit reached', {
      promotionId: promotion.id,
      promoCode: promotion.promoCode,
      usageCounts,
      usageLimitTotal: promotion.usageLimitTotal,
    });
    return buildInvalidResult(amount);
  }

  const discountAmount = calculateDiscount(promotion, amount);
  if (!Number.isFinite(discountAmount) || discountAmount <= 0) {
    console.warn('[promotions.service] validation failed: discount evaluated to zero', {
      promotionId: promotion.id,
      promoCode: promotion.promoCode,
      orderAmount: amount,
    });
    return buildInvalidResult(amount);
  }

  const finalAmount = roundMoney(Math.max(amount - discountAmount, 0));
  const result = {
    valid: true,
    promotionId: promotion.id,
    promoCode: promotion.promoCode,
    discountAmount,
    finalAmount,
    message: formatDiscountMessage(discountAmount),
    promotion,
    customerPhone: normalizedPhone,
    orderAmount: roundMoney(amount),
  };

  console.log('[promotions.service] validation success', {
    promotionId: promotion.id,
    promoCode: promotion.promoCode,
    customerPhone: normalizedPhone,
    orderAmount: result.orderAmount,
    discountAmount: result.discountAmount,
    finalAmount: result.finalAmount,
  });

  return result;
}

async function getPromotionById(promotionId) {
  return findPromotionById(promotionId);
}

module.exports = {
  normalizePromoCode,
  roundMoney,
  calculateDiscount,
  validatePromotion,
  getPromotionById,
};
