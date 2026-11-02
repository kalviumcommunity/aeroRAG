import logger from '../utils/logger.js';

export const errorHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);
  const validationError = err.name === 'ValidationError' || err.name === 'CastError';
  const databaseUnavailable = err.name === 'MongoServerSelectionError'
    || err.name === 'MongooseServerSelectionError';
  const statusCode = err.statusCode || err.status
    || (databaseUnavailable ? 503 : err.code === 'LIMIT_FILE_SIZE' ? 413 : err.code === 11000 ? 409 : validationError ? 400 : 500);
  if (statusCode >= 500) logger.error(`${req.method} ${req.path}: ${err.message}`);
  const message = databaseUnavailable
    ? 'Database unavailable. Start MongoDB and try again.'
    : statusCode >= 500 && process.env.NODE_ENV === 'production'
    ? 'Internal Server Error'
    : err.message || 'Internal Server Error';
  res.status(statusCode).json({
    error: message,
    code: statusCode,
  });
};
