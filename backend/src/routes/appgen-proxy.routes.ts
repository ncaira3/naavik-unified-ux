/**
 * AppGen Proxy Routes
 * Handles token exchange and API proxying for AppGen services
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { createProxyMiddleware, type Filter } from 'http-proxy-middleware';
import axios from 'axios';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

// Configuration from environment or defaults
const APPGEN_API_URL = process.env.APPGEN_API_URL || 'http://localhost:8000';
const APPGEN_ADMIN_USER = process.env.APPGEN_ADMIN_USER || 'admin';
const APPGEN_ADMIN_PASSWORD = process.env.APPGEN_ADMIN_PASSWORD || 'admin';


/**
 * Token Exchange Endpoint
 * Exchanges a Naavik-authenticated user for an AppGen JWT
 *
 * POST /api/appgen/session-token
 * Returns: { token: string }
 */
router.get('/appgen/session-token', authenticateToken, async (req: Request, res: Response, next: NextFunction) => {
  try {

    // Call AppGen's login API with preconfigured credentials
    const loginResponse = await axios.post(
      `${APPGEN_API_URL}/api/auth/login`,
      {
        username: APPGEN_ADMIN_USER,
        password: APPGEN_ADMIN_PASSWORD,
      },
      { timeout: 5000 }
    );

    if (!loginResponse.data?.token) {
      throw new Error('No token received from AppGen login API');
    }

    res.json({ token: loginResponse.data.token });
  } catch (err: any) {
    console.error('[AppGen Token Exchange] Error:', err.message);
    const statusCode = err.response?.status || 503;
    const errorMessage = err.message || 'AppGen services unavailable';
    res.status(statusCode).json({
      error: 'Failed to obtain AppGen session token',
      details: errorMessage,
    });
  }
});

export { router as appgenTokenRouter };

/**
 * Proxy Middleware Factory
 * Creates an Express middleware that proxies /appgen-api/* requests to AppGen API
 *
 * Usage in server.ts:
 *   app.use('/appgen-api', appgenProxy);
 */
export const appgenProxy = createProxyMiddleware({
  target: APPGEN_API_URL,
  changeOrigin: true,

  // Rewrite /appgen-api/* → /api/*
  pathRewrite: {
    '^/appgen-api': '/api',
  },

  // Enable WebSocket proxying
  ws: true,

  // Error handling and event logging
  on: {
    error: (err: Error, req: any, res: any) => {
      console.error('[AppGen Proxy] Error:', err.message);
      if (typeof res.status === 'function') {
        res.status(503).json({
          error: 'AppGen proxy error',
          message: err.message,
        });
      }
    },
    proxyReq: (proxyReq: any, req: any, res: any) => {
      // Preserve CORS headers from request
      if (req.headers.origin) {
        res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }
    },
    proxyRes: (proxyRes: any, req: any, res: any) => {
      // Ensure CORS headers are set on response
      if (req.headers.origin) {
        proxyRes.headers['access-control-allow-origin'] = req.headers.origin;
        proxyRes.headers['access-control-allow-credentials'] = 'true';
      }
    },
  },
});
