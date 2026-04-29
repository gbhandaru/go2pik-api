const ApiError = require('../utils/errors');
const {
  getMenuImportById,
  updateMenuImport,
} = require('../repositories/menuImport.repository');
const { detectMenuContent } = require('./menuDetection.service');
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

  const detection = detectMenuContent(rawOcrText);
  console.log('[menuImportParse] detection result', {
    importId: id,
    detection,
  });

  if (!detection.isMenu) {
    const warningMessage = 'Uploaded file does not appear to be a restaurant menu.';
    console.log('[menuImportParse] rejected non-menu OCR', {
      importId: id,
      reasons: detection.reasons,
    });

    const parsedJson = {
      categories: [],
      warnings: [warningMessage],
      detection,
    };

    const updatedImport = await updateMenuImport(id, {
      parsed_json: parsedJson,
      status: 'FAILED',
      error_message: warningMessage,
    });

    return {
      menuImport: updatedImport,
      parsedJson,
      detection,
      isMenu: false,
      status: updatedImport?.status || 'FAILED',
    };
  }

  console.log('[menuImportParse] accepted menu OCR', {
    importId: id,
    reasons: detection.reasons,
    priceCount: detection.priceCount,
    likelyMenuItemLines: detection.likelyMenuItemLines.length,
  });

  await updateMenuImport(id, {
    status: 'AI_PROCESSING',
  });

  try {
    const parsedJson = await parseMenuFromOcr(rawOcrText);

    const updatedWithParsedJson = await updateMenuImport(id, {
      parsed_json: parsedJson,
      status: 'READY_FOR_REVIEW',
      error_message: null,
    });

    return {
      menuImport: updatedWithParsedJson,
      parsedJson,
      detection,
      isMenu: true,
      status: updatedWithParsedJson?.status || 'READY_FOR_REVIEW',
    };
  } catch (error) {
    try {
      await updateMenuImport(id, {
        status: 'FAILED',
        error_message: error?.message || 'Failed to parse menu OCR text',
      });
    } catch (updateError) {
      console.error('[menuImportParse] failed to mark import as FAILED', {
        importId: id,
        error: updateError,
      });
    }
    throw error;
  }
}

module.exports = {
  parseMenuImportById,
};
