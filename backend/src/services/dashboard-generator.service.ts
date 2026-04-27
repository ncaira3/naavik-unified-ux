/**
 * Dashboard Generator Service
 * Creates custom dashboard configurations
 */
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';
import { DashboardConfig } from '../types/index.js';

export interface DashboardRequest {
  name: string;
  kpis: string[];
  layout?: 'grid' | 'masonry' | 'flex';
  theme?: 'light' | 'dark' | 'auto';
}

export class DashboardGeneratorService {
  /**
   * Generate a dashboard configuration
   */
  static async generateDashboard(request: DashboardRequest): Promise<DashboardConfig> {
    const dashboardId = uuidv4();
    
    logger.info(`Generating dashboard: ${request.name} with ${request.kpis.length} KPIs`);
    
    const widgets = this.createWidgets(request.kpis);
    const layout = this.calculateLayout(widgets.length, request.layout);
    
    return {
      id: dashboardId,
      name: request.name,
      widgets,
      layout
    };
  }

  /**
   * Create widgets based on KPIs
   */
  private static createWidgets(kpis: string[]) {
    const widgets = [];
    
    // Add a summary metric card for each KPI
    kpis.forEach(kpi => {
      widgets.push({
        type: 'metric' as const,
        title: this.formatKpiName(kpi),
        kpi,
        config: {
          size: 'small',
          showTrend: true,
          showSparkline: true
        }
      });
    });
    
    // Add trend charts for first 3 KPIs
    kpis.slice(0, 3).forEach(kpi => {
      widgets.push({
        type: 'chart' as const,
        title: `${this.formatKpiName(kpi)} Trend`,
        kpi,
        config: {
          chartType: 'line',
          period: '7d',
          showLegend: true
        }
      });
    });
    
    // Add a table widget if more than 3 KPIs
    if (kpis.length > 3) {
      widgets.push({
        type: 'table' as const,
        title: 'All Sites Overview',
        config: {
          columns: ['SiteName', ...kpis.slice(0, 5)],
          pageSize: 10,
          sortable: true,
          filterable: true
        }
      });
    }
    
    // Add a map widget
    widgets.push({
      type: 'map' as const,
      title: 'Site Locations',
      config: {
        colorBy: kpis[0],
        showClusters: true,
        interactive: true
      }
    });
    
    return widgets;
  }

  /**
   * Calculate optimal layout
   */
  private static calculateLayout(widgetCount: number, layout?: string) {
    if (layout === 'flex') {
      return {
        cols: 1,
        rows: widgetCount
      };
    }
    
    if (layout === 'masonry') {
      return {
        cols: 3,
        rows: Math.ceil(widgetCount / 3)
      };
    }
    
    // Default grid layout
    const cols = widgetCount <= 2 ? widgetCount : widgetCount <= 4 ? 2 : 3;
    const rows = Math.ceil(widgetCount / cols);
    
    return { cols, rows };
  }

  /**
   * Format KPI name for display
   */
  private static formatKpiName(kpi: string): string {
    return kpi
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  /**
   * Generate React component code for dashboard
   */
  static generateDashboardComponent(config: DashboardConfig): string {
    return `import React from 'react';
import { KpiMetric, TrendChart, DataTable, SiteMap } from '@/components';

export default function ${this.toPascalCase(config.name)}Dashboard() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">${config.name}</h1>
      
      <div className="grid grid-cols-${config.layout.cols} gap-6">
        ${config.widgets.map(widget => this.generateWidgetCode(widget)).join('\n        ')}
      </div>
    </div>
  );
}`;
  }

  /**
   * Generate widget component code
   */
  private static generateWidgetCode(widget: any): string {
    switch (widget.type) {
      case 'metric':
        return `<KpiMetric 
          title="${widget.title}"
          kpi="${widget.kpi}"
          showTrend={${widget.config.showTrend}}
          showSparkline={${widget.config.showSparkline}}
        />`;
      
      case 'chart':
        return `<TrendChart
          title="${widget.title}"
          kpi="${widget.kpi}"
          chartType="${widget.config.chartType}"
          period="${widget.config.period}"
        />`;
      
      case 'table':
        return `<DataTable
          title="${widget.title}"
          columns={${JSON.stringify(widget.config.columns)}}
          pageSize={${widget.config.pageSize}}
          sortable={${widget.config.sortable}}
        />`;
      
      case 'map':
        return `<SiteMap
          title="${widget.title}"
          colorBy="${widget.config.colorBy}"
          showClusters={${widget.config.showClusters}}
        />`;
      
      default:
        return `<div>Unknown widget type: ${widget.type}</div>`;
    }
  }

  /**
   * Convert string to PascalCase
   */
  private static toPascalCase(str: string): string {
    return str
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
  }

  /**
   * Save dashboard to database
   */
  static async saveDashboard(config: DashboardConfig, userId: string): Promise<string> {
    // TODO: Implement database save
    // For now, just return the ID
    logger.info(`Dashboard ${config.name} would be saved for user ${userId}`);
    return config.id;
  }
}
