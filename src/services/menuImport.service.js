const crypto = require('crypto');
const ApiError = require('../utils/errors');
const { createMenuImport, updateMenuImport } = require('../repositories/menuImport.repository');
const {
  documentTextDetection,
  sanitizeErrorMessage,
  getAccessToken,
} = require('./googleVision.service');

const ALLOWED_FILE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'application/pdf']);

function getFileExtension(fileName = '') {
  const normalized = String(fileName).toLowerCase();
  const match = normalized.match(/\.([a-z0-9]+)$/);
  return match ? match[1] : '';
}

function normalizeFileType(file) {
  const mimeType = String(file?.mimetype || '').toLowerCase();
  const extension = getFileExtension(file?.originalname || '');

  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg' || extension === 'jpg' || extension === 'jpeg') {
    return 'image/jpeg';
  }
  if (mimeType === 'image/png' || extension === 'png') {
    return 'image/png';
  }
  if (mimeType === 'application/pdf' || extension === 'pdf') {
    return 'application/pdf';
  }
  return null;
}

function assertValidMenuImportRequest({ file, restaurantId }) {
  if (!restaurantId || String(restaurantId).trim() === '') {
    throw ApiError.badRequest('restaurantId is required');
  }
  if (!file) {
    throw ApiError.badRequest('file is required');
  }

  const normalizedType = normalizeFileType(file);
  if (!normalizedType || !ALLOWED_FILE_TYPES.has(normalizedType)) {
    throw ApiError.badRequest('Unsupported file type. Allowed types: jpg, jpeg, png, pdf');
  }

  if (!file.buffer || !Buffer.isBuffer(file.buffer)) {
    throw ApiError.badRequest('Uploaded file payload is invalid');
  }

  return normalizedType;
}

function buildObjectName({ restaurantId, file, fileType }) {
  const originalBaseName = String(file.originalname || 'menu-import')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const baseName = originalBaseName.replace(/\.[a-z0-9]+$/, '');
  const extension =
    fileType === 'application/pdf'
      ? 'pdf'
      : getFileExtension(file.originalname) || (fileType === 'image/png' ? 'png' : 'jpg');
  return `menu-imports/${restaurantId}/${Date.now()}-${crypto.randomUUID()}-${baseName || 'menu-import'}.${extension}`;
}

function buildGcsUri(bucket, objectName) {
  return `gs://${bucket}/${objectName}`;
}

async function getGoogleAccessToken() {
  return getAccessToken();
}

async function uploadFileToGcs(file, restaurantId, fileType) {
  const bucket = process.env.GCS_MENU_IMPORT_BUCKET;
  if (!bucket) {
    throw new Error('GCS_MENU_IMPORT_BUCKET is required');
  }

  const accessToken = await getGoogleAccessToken();
  const objectName = buildObjectName({ restaurantId, file, fileType });
  const uploadUrl = new URL(`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o`);
  uploadUrl.searchParams.set('uploadType', 'media');
  uploadUrl.searchParams.set('name', objectName);

  const response = await fetch(uploadUrl.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': fileType,
    },
    body: file.buffer,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`GCS upload failed (${response.status} ${response.statusText}): ${body}`);
  }

  return {
    bucket,
    objectName,
    fileUrl: buildGcsUri(bucket, objectName),
  };
}

async function uploadAndOcrMenuImport({ file, restaurantId }) {
  const normalizedRestaurantId = String(restaurantId).trim();
  const fileType = assertValidMenuImportRequest({ file, restaurantId: normalizedRestaurantId });

  const uploadedFile = await uploadFileToGcs(file, normalizedRestaurantId, fileType);

  const createdImport = await createMenuImport({
    restaurantId: normalizedRestaurantId,
    fileUrl: uploadedFile.fileUrl,
    fileType,
    status: 'UPLOADED',
    rawOcrText: null,
    parsedJson: null,
    errorMessage: null,
  });

  if (!createdImport?.id) {
    throw new Error('Failed to create menu import record');
  }

  await updateMenuImport(createdImport.id, {
    status: 'OCR_PROCESSING',
  });

  try {
    const ocrResult = await documentTextDetection({
      gcsUri: uploadedFile.fileUrl,
      mimeType: fileType,
      fileName: file.originalname,
    });

    const updatedImport = await updateMenuImport(createdImport.id, {
      raw_ocr_text: ocrResult.rawText || '',
      parsed_json: null,
      error_message: null,
      status: 'OCR_COMPLETED',
    });

    return updatedImport;
  } catch (error) {
    try {
      await updateMenuImport(createdImport.id, {
        status: 'FAILED',
        error_message: sanitizeErrorMessage(error),
      });
    } catch (updateError) {
      console.error('[menuImport.service] failed to mark import as FAILED', {
        importId: createdImport.id,
        error: updateError,
      });
    }
    const wrappedError = new Error(sanitizeErrorMessage(error));
    wrappedError.status = 500;
    wrappedError.details = error?.details;
    throw wrappedError;
  }
}

module.exports = {
  uploadAndOcrMenuImport,
  assertValidMenuImportRequest,
  normalizeFileType,
};
