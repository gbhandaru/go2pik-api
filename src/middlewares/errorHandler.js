const ApiError = require('../utils/errors');
const { resolveRequestId } = require('../utils/requestId');

function mapDbError(error) {
  if (!error || !error.code) {
    return null;
  }
  if (error.code === '23505') {
    return ApiError.conflict('Record already exists');
  }
  if (error.code === '22P02') {
    return ApiError.badRequest('Invalid input syntax');
  }
  return null;
}

function errorHandler(err, req, res, next) {
  if (!err) {
    next();
    return;
  }
  const mapped = mapDbError(err);
  const error = mapped || err;
  const status = error.status || (error?.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  const requestId = req?.id || resolveRequestId(req);
  if (status >= 500) {
    console.error('[error]', {
      requestId,
      method: req?.method || null,
      path: req?.originalUrl || null,
      status,
      code: error.code || null,
      name: error.name || null,
      message: error.message || 'Internal server error',
    });
  }
  if (status === 404) {
    res.status(status).json({
      message: error.message || 'Not found',
    });
    return;
  }
  const payload = {
    message: error.message || 'Internal server error',
  };
  if (error.code !== undefined) {
    payload.code = error.code;
  }
  if (error.details !== undefined) {
    payload.details = error.details;
  }
  res.status(status).json(payload);
}

module.exports = errorHandler;
