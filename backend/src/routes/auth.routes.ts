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

// Lazy-initialized so that dotenv.config() in server.ts runs first (ESM imports
// are hoisted before any module body executes, so module-level env reads fire
// before dotenv has a chance to populate process.env).
let _adminUser: { id: string; username: string; passwordHash: string; role: 'admin' } | null = null;

function getAdminUser() {
  if (!_adminUser) {
    if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
      throw new Error(
        'ADMIN_USERNAME and ADMIN_PASSWORD must be set in the environment. ' +
        'See backend/.env.example.'
      );
    }
    _adminUser = {
      id: 'admin-001',
      username: process.env.ADMIN_USERNAME,
      passwordHash: bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10),
      role: 'admin' as const,
    };
  }
  return _adminUser;
}

/**
 * POST /api/auth/login
 * Authenticate user and return JWT token
 */
router.post('/login', asyncHandler(async (req: Request, res: Response) => {
  const { username, password }: AuthRequest = req.body;

  if (!username || !password) {
    throw new AppError(400, 'MISSING_CREDENTIALS', 'Username and password are required');
  }

  const adminUser = getAdminUser();

  // Verify credentials
  if (username !== adminUser.username) {
    logger.warn(`Failed login attempt for username: ${username}`);
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid username or password');
  }

  const passwordValid = await bcrypt.compare(password, adminUser.passwordHash);
  
  if (!passwordValid) {
    logger.warn(`Failed login attempt - invalid password for: ${username}`);
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid username or password');
  }

  // Generate token
  const user: User = {
    id: adminUser.id,
    username: adminUser.username,
    role: adminUser.role,
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
