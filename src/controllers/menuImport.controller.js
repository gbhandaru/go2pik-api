const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/errors');
const { uploadAndOcrMenuImport } = require('../services/menuImport.service');

const uploadAndOcrMenuImportController = asyncHandler(async (req, res) => {
  const { restaurantId } = req.body || {};
  const file = req.file || null;

  if (!restaurantId || String(restaurantId).trim() === '') {
    throw ApiError.badRequest('restaurantId is required');
  }

  if (!file) {
    throw ApiError.badRequest('file is required');
  }

  const result = await uploadAndOcrMenuImport({
    file,
    restaurantId,
  });

  res.status(201).json({
    importId: result.id,
    status: result.status,
    rawOcrText: result.rawOcrText || '',
    fileUrl: result.fileUrl,
  });
});

module.exports = {
  uploadAndOcrMenuImport: uploadAndOcrMenuImportController,
};
