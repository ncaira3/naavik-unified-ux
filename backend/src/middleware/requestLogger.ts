/**
 * Request Logger Middleware
 * Logs incoming API requests with key params, then response status + duration.
 */
import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';

// Routes that are noisy and add no value to monitor
const SKIP_PATHS = new Set(['/health', '/favicon.ico']);

// Build a concise context string from query params and body keys
function requestContext(req: Request): string {
  const parts: string[] = [];

  // Include non-trivial query params
  const q = req.query as Record<string, string>;
  const qParts = Object.entries(q)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${String(v).slice(0, 40)}`);
  if (qParts.length) parts.push(qParts.join('  '));

  // Include top-level body keys for POST/PUT (no values — just structure)
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    const bodyKeys = Object.keys(req.body).slice(0, 5);
    if (bodyKeys.length) parts.push(`body:{${bodyKeys.join(',')}}`);
  }

  return parts.length ? `  ${parts.join('  ')}` : '';
}

export const requestLogger = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (SKIP_PATHS.has(req.path)) return next();

  const start = Date.now();
  const ctx = requestContext(req);

  logger.info(`→ ${req.method.padEnd(6)} ${req.path}${ctx}`);

  res.on('finish', () => {
    const ms = Date.now() - start;
    const code = res.statusCode;
    const msg = `  ↳ ${code}  ${ms}ms`;

    if (code >= 500) logger.error(msg);
    else if (code >= 400) logger.warn(msg);
    // Skip logging 200s on finish — the SQL log already shows what was fetched
  });

  next();
};
