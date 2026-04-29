const ApiError = require('../utils/errors');

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
  if (status >= 500) {
    console.error('[error]', err);
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
