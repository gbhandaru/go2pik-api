const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/errors');
const { validatePromotion } = require('../services/promotions.service');

const validate = asyncHandler(async (req, res) => {
  const { promoCode, customerPhone, orderAmount, restaurantId } = req.body || {};

  if (promoCode === undefined || customerPhone === undefined || orderAmount === undefined || restaurantId === undefined) {
    throw ApiError.badRequest('promoCode, customerPhone, orderAmount, and restaurantId are required');
  }

  const result = await validatePromotion({
    promoCode,
    customerPhone,
    orderAmount,
    restaurantId,
  });

  if (!result.valid) {
    res.json({
      valid: false,
      discountAmount: 0,
      finalAmount: Number(Number(orderAmount || 0).toFixed(2)),
      message: result.message,
    });
    return;
  }

  res.json({
    valid: true,
    promotionId: result.promotionId,
    promoCode: result.promoCode,
    discountAmount: result.discountAmount,
    finalAmount: result.finalAmount,
    message: result.message,
  });
});

module.exports = {
  validate,
};
