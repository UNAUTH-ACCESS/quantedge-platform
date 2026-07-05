const logger = require("../lib/logger");

class AppError extends Error {
  constructor(message, statusCode = 500, code = "INTERNAL_ERROR") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
  }
}

function notFound(req, res, next) {
  next(new AppError(`Route not found: ${req.method} ${req.path}`, 404, "NOT_FOUND"));
}

function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  const code = err.code || "INTERNAL_ERROR";

  if (statusCode >= 500) {
    logger.error("Unhandled error", { code, message: err.message, stack: err.stack, path: req.path });
  }

  res.status(statusCode).json({
    success: false,
    error: { code, message: err.isOperational ? err.message : "An unexpected error occurred" },
  });
}

module.exports = { AppError, notFound, errorHandler };
