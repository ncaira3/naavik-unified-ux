import { Router, Request, Response } from 'express';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import {
  OSSAdapterSimulatorService,
  StartOssParameterChangeInput,
} from '../services/oss-adapter-simulator.service.js';

const router = Router();

router.post(
  '/parameter-change',
  asyncHandler(async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as StartOssParameterChangeInput;

    try {
      const simulation = OSSAdapterSimulatorService.startParameterChange(body);
      res.json({
        success: true,
        data: simulation,
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      throw new AppError(
        400,
        'INVALID_PARAMETER_CHANGE_REQUEST',
        error?.message || 'Missing required siteId/parameter/value for parameter change simulation.'
      );
    }
  })
);

router.get(
  '/parameter-change/:requestId',
  asyncHandler(async (req: Request, res: Response) => {
    const { requestId } = req.params;
    const simulation = OSSAdapterSimulatorService.getRequest(requestId);

    if (!simulation) {
      throw new AppError(404, 'REQUEST_NOT_FOUND', 'OSS parameter change request not found.');
    }

    res.json({
      success: true,
      data: simulation,
      timestamp: new Date().toISOString(),
    });
  })
);

router.post(
  '/parameter-change/:requestId/retry',
  asyncHandler(async (req: Request, res: Response) => {
    const { requestId } = req.params;
    const simulation = OSSAdapterSimulatorService.retryRequest(requestId);

    if (!simulation) {
      throw new AppError(404, 'REQUEST_NOT_FOUND', 'OSS parameter change request not found.');
    }

    res.json({
      success: true,
      data: simulation,
      timestamp: new Date().toISOString(),
    });
  })
);

export default router;
