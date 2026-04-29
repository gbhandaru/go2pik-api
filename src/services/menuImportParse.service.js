const ApiError = require('../utils/errors');
const {
  getMenuImportById,
  updateMenuImport,
} = require('../repositories/menuImport.repository');
const { parseMenuFromOcr } = require('./menuParserGemini.service');

async function parseMenuImportById(id) {
  if (id === undefined || id === null || String(id).trim() === '') {
    throw ApiError.badRequest('id is required');
  }

  const menuImport = await getMenuImportById(id);
  if (!menuImport) {
    throw ApiError.notFound('Menu import not found');
  }

  const rawOcrText = String(menuImport.rawOcrText || '').trim();
  if (!rawOcrText) {
    throw ApiError.badRequest('rawOcrText is missing for this menu import');
  }

  await updateMenuImport(id, {
    status: 'AI_PROCESSING',
  });

  const parsedJson = await parseMenuFromOcr(rawOcrText);

  const updatedWithParsedJson = await updateMenuImport(id, {
    parsed_json: parsedJson,
    status: 'READY_FOR_REVIEW',
    error_message: null,
  });

  return {
    menuImport: updatedWithParsedJson,
    parsedJson,
    status: updatedWithParsedJson?.status || 'READY_FOR_REVIEW',
  };
}

module.exports = {
  parseMenuImportById,
};
