/**
 * Authentication Routes
 * Login and token management
 */
import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { generateToken } from '../middleware/auth.js';
import { AuthRequest, AuthResponse, User } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';

const router = Router();

// Admin credentials are pulled from env vars only.
// The server refuses to start without them — never fall back to a hardcoded
// password, which would otherwise end up in the source bundle / git history.
if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
  // Fail fast with a clear message so misconfiguration is obvious in dev.
  throw new Error(
    'ADMIN_USERNAME and ADMIN_PASSWORD must be set in the environment. ' +
    'See backend/.env.example.'
  );
}

const ADMIN_USER = {
  id: 'admin-001',
  username: process.env.ADMIN_USERNAME,
  passwordHash: bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10),
  role: 'admin' as const,
};

/**
 * POST /api/auth/login
 * Authenticate user and return JWT token
 */
router.post('/login', asyncHandler(async (req: Request, res: Response) => {
  const { username, password }: AuthRequest = req.body;

  if (!username || !password) {
    throw new AppError(400, 'MISSING_CREDENTIALS', 'Username and password are required');
  }

  // Verify credentials
  if (username !== ADMIN_USER.username) {
    logger.warn(`Failed login attempt for username: ${username}`);
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid username or password');
  }

  const passwordValid = await bcrypt.compare(password, ADMIN_USER.passwordHash);
  
  if (!passwordValid) {
    logger.warn(`Failed login attempt - invalid password for: ${username}`);
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid username or password');
  }

  // Generate token
  const user: User = {
    id: ADMIN_USER.id,
    username: ADMIN_USER.username,
    role: ADMIN_USER.role,
  };

  const token = generateToken(user);

  logger.info(`Successful login: ${username}`);

  const response: AuthResponse = {
    token,
    user,
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  };

  res.json({
    success: true,
    data: response,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * GET /api/auth/verify
 * Verify current token is valid
 */
router.get('/verify', asyncHandler(async (req: Request, res: Response) => {
  // authenticateToken middleware will be applied in server.ts
  // If we reach here, token is valid
  
  res.json({
    success: true,
    data: {
      valid: true,
      user: req.user,
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * POST /api/auth/logout
 * Logout (client-side token removal, server just logs)
 */
router.post('/logout', asyncHandler(async (req: Request, res: Response) => {
  logger.info(`User logged out: ${req.user?.username || 'unknown'}`);
  
  res.json({
    success: true,
    data: { message: 'Logged out successfully' },
    timestamp: new Date().toISOString(),
  });
}));

export default router;
