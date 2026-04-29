const asyncHandler = require('../utils/asyncHandler');
const { parseMenuImportById } = require('../services/menuImportParse.service');

const parseMenuImportController = asyncHandler(async (req, res) => {
  const result = await parseMenuImportById(req.params.id);
  res.json(result.parsedJson);
});

module.exports = {
  parseMenuImport: parseMenuImportController,
};
