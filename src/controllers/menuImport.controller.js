const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/errors');
const {
  uploadAndOcrMenuImport,
  getMenuImportById: getMenuImportByIdService,
} = require('../services/menuImport.service');

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

const getMenuImportByIdController = asyncHandler(async (req, res) => {
  console.log('[menuImport.controller] get request', {
    importId: req.params.id,
  });

  const menuImport = await getMenuImportByIdService(req.params.id);

  res.json({
    importId: menuImport.id,
    restaurantId: menuImport.restaurantId,
    fileUrl: menuImport.fileUrl,
    fileType: menuImport.fileType,
    status: menuImport.status,
    rawOcrText: menuImport.rawOcrText,
    correctedOcrText: menuImport.correctedOcrText,
    correctionNotes: menuImport.correctionNotes,
    parsedJson: menuImport.parsedJson,
    errorMessage: menuImport.errorMessage,
    createdAt: menuImport.createdAt,
  });
});

module.exports = {
  uploadAndOcrMenuImport: uploadAndOcrMenuImportController,
  getMenuImportById: getMenuImportByIdController,
};
