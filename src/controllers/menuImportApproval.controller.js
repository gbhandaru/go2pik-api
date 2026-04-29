const asyncHandler = require('../utils/asyncHandler');
const { approveMenuImportById } = require('../services/menuImportApproval.service');

const approveMenuImportController = asyncHandler(async (req, res) => {
  const result = await approveMenuImportById(req.params.id, req.body?.parsedJson);
  res.json({
    importId: result.menuImport?.id,
    status: result.status,
    categoriesInserted: result.categoriesInserted,
    categoriesReused: result.categoriesReused,
    itemsInserted: result.itemsInserted,
    skippedItems: result.skippedItems,
    message: result.message,
  });
});

module.exports = {
  approveMenuImport: approveMenuImportController,
};
