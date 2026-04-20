class ApiError extends Error {
  constructor(status, message, details, code) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    if (details !== undefined) {
      this.details = details;
    }
    if (code !== undefined) {
      this.code = code;
    }
  }

  static badRequest(message = 'Bad request') {
    return new ApiError(400, message);
  }

  static validation(code, message, details) {
    return new ApiError(400, message, details, code);
  }

  static unauthorized(message = 'Unauthorized') {
    return new ApiError(401, message);
  }

  static forbidden(message = 'Forbidden') {
    return new ApiError(403, message);
  }

  static notFound(message = 'Not found') {
    return new ApiError(404, message);
  }

  static conflict(message = 'Conflict') {
    return new ApiError(409, message);
  }
}

module.exports = ApiError;
