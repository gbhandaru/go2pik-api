const asyncHandler = require('../utils/asyncHandler');
const { approveMenuImportById } = require('../services/menuImportApproval.service');

const approveMenuImportController = asyncHandler(async (req, res) => {
  const result = await approveMenuImportById(req.params.id);
  res.json({
    importId: result.menuImport?.id,
    status: result.status,
  });
});

module.exports = {
  approveMenuImport: approveMenuImportController,
};
