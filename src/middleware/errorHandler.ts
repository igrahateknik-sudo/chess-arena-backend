import { Request, Response, NextFunction } from 'express';
import logger from '../lib/logger';

export const errorHandler = (err: any, req: Request, res: Response, _next: NextFunction) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  // Log error using Winston
  logger.error(
    `${statusCode} - ${message} - ${req.method} ${req.originalUrl} - ${req.ip} - ${err.stack}`,
  );

  res.status(statusCode).json({
    status: 'error',
    statusCode,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

export default errorHandler;
