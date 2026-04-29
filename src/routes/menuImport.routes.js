const express = require('express');
const multer = require('multer');
const ApiError = require('../utils/errors');
const { uploadAndOcrMenuImport } = require('../controllers/menuImport.controller');

const router = express.Router();

const allowedMimeTypes = new Set(['image/jpeg', 'image/jpg', 'image/png', 'application/pdf']);
const allowedExtensions = new Set(['jpg', 'jpeg', 'png', 'pdf']);

function getFileExtension(fileName = '') {
  const normalized = String(fileName).toLowerCase();
  const match = normalized.match(/\.([a-z0-9]+)$/);
  return match ? match[1] : '';
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const mimeType = String(file.mimetype || '').toLowerCase();
    const extension = getFileExtension(file.originalname || '');
    if (!allowedMimeTypes.has(mimeType) && !allowedExtensions.has(extension)) {
      cb(ApiError.badRequest('Unsupported file type. Allowed types: jpg, jpeg, png, pdf'));
      return;
    }
    cb(null, true);
  },
});

router.post('/upload-and-ocr', upload.single('file'), uploadAndOcrMenuImport);

module.exports = router;
