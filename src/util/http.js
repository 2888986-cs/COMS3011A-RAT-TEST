class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const httpError = (status, message) => new HttpError(status, message);
const badRequest = (message) => httpError(400, message);
const notFound = (message) => httpError(404, message);

/**
 * Wraps an async express handler so rejected promises reach the error middleware.
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = { HttpError, httpError, badRequest, notFound, asyncHandler };
