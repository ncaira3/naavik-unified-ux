/**
 * Authentication Middleware
 * JWT token validation for protected routes
 */
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { User } from '../types/index.js';
import { logger } from '../utils/logger.js';

const JWT_SECRET = process.env.JWT_SECRET || 'default-secret-change-me';

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export interface JWTPayload {
  userId: string;
  username: string;
  role: string;
}

/**
 * Verify JWT token and attach user to request
 */
export const authenticateToken = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    res.status(401).json({
      success: false,
      error: {
        code: 'NO_TOKEN',
        message: 'Access token is required',
      },
    });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;
    
    req.user = {
      id: decoded.userId,
      username: decoded.username,
      role: decoded.role as 'admin' | 'user',
    };
    
    next();
  } catch (error) {
    logger.warn(`Invalid token attempt: ${error}`);
    
    res.status(403).json({
      success: false,
      error: {
        code: 'INVALID_TOKEN',
        message: 'Invalid or expired token',
      },
    });
  }
};

/**
 * Generate JWT token
 */
export const generateToken = (user: User): string => {
  const payload: JWTPayload = {
    userId: user.id,
    username: user.username,
    role: user.role,
  };

  const expiresIn = process.env.JWT_EXPIRES_IN || '24h';
  const options: jwt.SignOptions = {
    expiresIn: expiresIn as jwt.SignOptions['expiresIn'],
  };
  return jwt.sign(payload, JWT_SECRET as jwt.Secret, options);
};

/**
 * Optional auth - doesn't fail if no token, just attaches user if present
 */
export const optionalAuth = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    next();
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;
    req.user = {
      id: decoded.userId,
      username: decoded.username,
      role: decoded.role as 'admin' | 'user',
    };
  } catch (error) {
    // Token invalid but continue anyway
    logger.debug('Invalid token in optional auth, continuing without user');
  }

  next();
};
