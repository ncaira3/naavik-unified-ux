/**
 * Test Routes - For development and testing real data integration
 */
import express, { Request, Response } from 'express';
import { siteIdMapper } from '../services/site-id-mapper.service.js';
import { NaavikDBConnector } from '../services/naavik-db-connector.service.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

/**
 * Test endpoint: Get all sites with real data availability
 * GET /api/test/sites-with-data?kpi=DATA_ACC_RATE&limit=20
 */
router.get('/sites-with-data', async (req: Request, res: Response) => {
  try {
    const kpiName = (req.query.kpi as string) || 'DATA_ACC_RATE';
    const limit = parseInt(req.query.limit as string) || 20;
    
    logger.info(`🧪 Testing ${limit} sites for ${kpiName} data availability...`);
    
    const dbConnector = new NaavikDBConnector();
    const allDummySites = siteIdMapper.getAllDummySiteIds();
    
    // Calculate date range (last 7 days)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 7);
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];
    
    const sitesWithData: Array<{
      dummyId: string;
      realUSID: string;
      dataPoints: number;
      dateRange?: string;
    }> = [];
    
    // Test first N sites
    const sitesToTest = allDummySites.slice(0, limit);
    
    for (const dummyId of sitesToTest) {
      const realUSID = siteIdMapper.getRealUSID(dummyId);
      if (!realUSID) continue;
      
      try {
        const data = await dbConnector.fetchDailyKPIs(
          realUSID,
          startDateStr,
          endDateStr,
          [kpiName]
        );
        
        if (data && data.length > 0) {
          sitesWithData.push({
            dummyId,
            realUSID: realUSID.substring(0, 20) + '...',
            dataPoints: data.length,
            dateRange: `${startDateStr} to ${endDateStr}`,
          });
          
          logger.info(`  ✅ ${dummyId}: ${data.length} data points`);
        }
      } catch (error) {
        logger.debug(`  ⏭️ ${dummyId}: No data or error`);
      }
    }
    
    logger.info(`🎯 Found ${sitesWithData.length} sites with data out of ${sitesToTest.length} tested`);
    
    res.json({
      success: true,
      data: {
        sitesWithData,
        summary: {
          tested: sitesToTest.length,
          withData: sitesWithData.length,
          kpiName,
          dateRange: `${startDateStr} to ${endDateStr}`,
        },
      },
    });
  } catch (error: any) {
    logger.error('Test endpoint error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Test endpoint: Get site mapper statistics
 * GET /api/test/mapper-stats
 */
router.get('/mapper-stats', async (req: Request, res: Response) => {
  try {
    const stats = siteIdMapper.getStats();
    const allSites = siteIdMapper.getAllDummySiteIds();
    
    res.json({
      success: true,
      data: {
        ...stats,
        sampleMappings: allSites.slice(0, 10).map(dummyId => ({
          dummyId,
          realUSID: siteIdMapper.getRealUSID(dummyId),
        })),
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Test endpoint: Check specific site data
 * GET /api/test/site/:siteId/check?kpi=DATA_ACC_RATE
 */
router.get('/site/:siteId/check', async (req: Request, res: Response) => {
  try {
    const { siteId } = req.params;
    const kpiName = (req.query.kpi as string) || 'DATA_ACC_RATE';
    
    const realUSID = siteIdMapper.getRealUSID(siteId);
    if (!realUSID) {
      return res.status(404).json({
        success: false,
        error: `Site ${siteId} not found in mapping`,
      });
    }
    
    const dbConnector = new NaavikDBConnector();
    
    // Check last 7 days
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 7);
    
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];
    
    logger.info(`🔍 Checking ${siteId} (${realUSID.substring(0, 20)}...) for ${kpiName}`);
    
    const data = await dbConnector.fetchDailyKPIs(
      realUSID,
      startDateStr,
      endDateStr,
      [kpiName]
    );
    
    res.json({
      success: true,
      data: {
        siteId,
        realUSID,
        kpiName,
        dateRange: `${startDateStr} to ${endDateStr}`,
        hasData: data && data.length > 0,
        dataPoints: data ? data.length : 0,
        sample: data && data.length > 0 ? data.slice(0, 3) : null,
      },
    });
  } catch (error: any) {
    logger.error('Site check error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
