const ApiError = require('../utils/errors');
const {
  getMenuImportById,
  updateMenuImport,
} = require('../repositories/menuImport.repository');

async function approveMenuImportById(id) {
  if (id === undefined || id === null || String(id).trim() === '') {
    throw ApiError.badRequest('id is required');
  }

  const menuImport = await getMenuImportById(id);
  if (!menuImport) {
    throw ApiError.notFound('Menu import not found');
  }

  const status = String(menuImport.status || '').toUpperCase();
  if (status !== 'READY_FOR_REVIEW') {
    throw ApiError.badRequest('Menu import must be READY_FOR_REVIEW before approval');
  }

  const updatedMenuImport = await updateMenuImport(id, {
    status: 'APPROVED',
  });

  return {
    menuImport: updatedMenuImport,
    status: updatedMenuImport?.status || 'APPROVED',
  };
}

module.exports = {
  approveMenuImportById,
};
