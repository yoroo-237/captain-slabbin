import { fail } from '../utils/response.js';

export function errorHandler(err, req, res, _next) {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);

  // Prisma errors
  if (err.code === 'P2025') return res.status(404).json(fail('Resource not found'));
  if (err.code === 'P2002') return res.status(409).json(fail('Value already exists'));
  if (err.code === 'P2003') return res.status(400).json(fail('Invalid reference'));

  // Application errors (appError — intentional, always expose the message)
  if (err.status) {
    return res.status(err.status).json(fail(err.message));
  }

  // Unexpected crash — hide details in production
  const message = process.env.NODE_ENV === 'development' ? err.message : 'Internal server error';
  res.status(500).json(fail(message));
}
