const asyncHandler = require('../utils/asyncHandler');
const { parseMenuImportById } = require('../services/menuImportParse.service');

const parseMenuImportController = asyncHandler(async (req, res) => {
  const result = await parseMenuImportById(req.params.id);
  res.json({
    importId: result.menuImport?.id,
    status: result.status,
    parsedJson: result.parsedJson,
  });
});

module.exports = {
  parseMenuImport: parseMenuImportController,
};
