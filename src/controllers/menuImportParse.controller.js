const asyncHandler = require('../utils/asyncHandler');
const { parseMenuImportById } = require('../services/menuImportParse.service');

const parseMenuImportController = asyncHandler(async (req, res) => {
  const result = await parseMenuImportById(req.params.id);
  res.json({
    importId: result.menuImport?.id,
    status: result.status,
    isMenu: result.isMenu,
    parsedJson: result.parsedJson,
    detection: result.detection,
  });
});

module.exports = {
  parseMenuImport: parseMenuImportController,
};
