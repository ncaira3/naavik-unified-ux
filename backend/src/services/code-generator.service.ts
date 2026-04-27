/**
 * Code Generator Service
 * Generates Python/JavaScript monitoring scripts using OpenAI
 */
import { openai, SYSTEM_PROMPTS } from '../config/openai.js';
import { logger } from '../utils/logger.js';
import { AppRequirements, GeneratedCode } from '../types/index.js';

export class CodeGeneratorService {
  /**
   * Generate monitoring script from requirements
   */
  static async generateMonitoringScript(requirements: AppRequirements): Promise<GeneratedCode> {
    try {
      if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'dummy-key') {
        return this.generateFallbackScript(requirements);
      }

      const prompt = this.buildPrompt(requirements);
      
      const response = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: SYSTEM_PROMPTS.APP_GENERATOR },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 2000,
      });

      let code = response.choices[0].message.content || '';
      
      // Clean up code blocks
      code = code.replace(/```python\n?/g, '').replace(/```\n?/g, '').trim();
      
      return {
        code,
        language: 'python',
        filename: this.generateFilename(requirements),
        description: requirements.description,
        dependencies: this.extractDependencies(code)
      };
    } catch (error) {
      logger.error('Code generation failed', error);
      return this.generateFallbackScript(requirements);
    }
  }

  /**
   * Build prompt for code generation
   */
  private static buildPrompt(requirements: AppRequirements): string {
    const parts = [
      `Generate a Python monitoring script for: ${requirements.description}`,
      '',
      `KPIs to monitor: ${requirements.kpis.join(', ')}`,
    ];

    if (requirements.alertThresholds && Object.keys(requirements.alertThresholds).length > 0) {
      parts.push('');
      parts.push('Alert Thresholds:');
      Object.entries(requirements.alertThresholds).forEach(([kpi, threshold]) => {
        parts.push(`- ${kpi}: ${threshold}`);
      });
    }

    if (requirements.features && requirements.features.length > 0) {
      parts.push('');
      parts.push('Features to include:');
      requirements.features.forEach(feature => {
        parts.push(`- ${feature}`);
      });
    }

    parts.push('');
    parts.push('Requirements:');
    parts.push('- Use PostgreSQL for data queries');
    parts.push('- Include proper error handling and logging');
    parts.push('- Add docstrings and type hints');
    parts.push('- Follow PEP 8 style guidelines');
    parts.push('- Include example usage');

    return parts.join('\n');
  }

  /**
   * Generate filename from requirements
   */
  private static generateFilename(requirements: AppRequirements): string {
    const name = requirements.description
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    
    return `${name}_monitor.py`;
  }

  /**
   * Extract dependencies from generated code
   */
  private static extractDependencies(code: string): string[] {
    const dependencies: Set<string> = new Set();
    
    // Match import statements
    const importRegex = /import\s+([\w.]+)|from\s+([\w.]+)\s+import/g;
    let match;
    
    while ((match = importRegex.exec(code)) !== null) {
      const module = match[1] || match[2];
      const baseModule = module.split('.')[0];
      
      // Filter standard library modules
      const stdLib = ['os', 'sys', 'json', 'time', 'datetime', 'logging', 'argparse', 're', 'collections'];
      if (!stdLib.includes(baseModule)) {
        dependencies.add(baseModule);
      }
    }
    
    return Array.from(dependencies);
  }

  /**
   * Fallback script generation (template-based)
   */
  private static generateFallbackScript(requirements: AppRequirements): GeneratedCode {
    const kpis = requirements.kpis.join('", "');
    const thresholds = requirements.alertThresholds || {};
    
    const code = `#!/usr/bin/env python3
"""
${requirements.description}
Auto-generated network monitoring script
"""

import psycopg2
import logging
from datetime import datetime
from typing import Dict, List, Tuple

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Database configuration
DB_CONFIG = {
    'host': 'localhost',
    'port': 5433,
    'database': 'naavik_demo',
    'user': 'naavik_user',
    'password': 'naavik_pass_2026'
}

# KPIs to monitor
MONITORED_KPIS = ["${kpis}"]

# Alert thresholds
THRESHOLDS = ${JSON.stringify(thresholds, null, 4)}


class NetworkMonitor:
    """Network monitoring class for ${requirements.description}"""
    
    def __init__(self):
        self.conn = None
        
    def connect(self) -> bool:
        """Connect to database"""
        try:
            self.conn = psycopg2.connect(**DB_CONFIG)
            logger.info("Connected to database")
            return True
        except Exception as e:
            logger.error(f"Database connection failed: {e}")
            return False
    
    def get_kpi_data(self, site_id: str = None) -> List[Dict]:
        """
        Query KPI data from database
        
        Args:
            site_id: Optional site ID to filter by
            
        Returns:
            List of KPI records
        """
        try:
            cursor = self.conn.cursor()
            
            query = """
                SELECT 
                    "SiteID",
                    "CellName",
                    "KPIName",
                    "KPIValue",
                    "DateID"
                FROM kpi_metrics
                WHERE "KPIName" IN %s
            """
            
            params = [tuple(MONITORED_KPIS)]
            
            if site_id:
                query += ' AND "SiteID" = %s'
                params.append(site_id)
            
            query += ' ORDER BY "DateID" DESC LIMIT 100'
            
            cursor.execute(query, params)
            
            columns = [desc[0] for desc in cursor.description]
            results = [dict(zip(columns, row)) for row in cursor.fetchall()]
            
            cursor.close()
            logger.info(f"Retrieved {len(results)} KPI records")
            
            return results
            
        except Exception as e:
            logger.error(f"Failed to query KPI data: {e}")
            return []
    
    def check_thresholds(self, kpi_data: List[Dict]) -> List[Dict]:
        """
        Check KPI values against thresholds
        
        Args:
            kpi_data: List of KPI records
            
        Returns:
            List of violations
        """
        violations = []
        
        for record in kpi_data:
            kpi_name = record['KPIName']
            kpi_value = float(record['KPIValue'])
            
            if kpi_name in THRESHOLDS:
                threshold = THRESHOLDS[kpi_name]
                
                if kpi_value > threshold:
                    violations.append({
                        'site_id': record['SiteID'],
                        'cell': record['CellName'],
                        'kpi': kpi_name,
                        'value': kpi_value,
                        'threshold': threshold,
                        'severity': 'CRITICAL' if kpi_value > threshold * 1.5 else 'WARNING'
                    })
        
        return violations
    
    def generate_report(self, violations: List[Dict]) -> str:
        """Generate monitoring report"""
        if not violations:
            return "✓ All KPIs within normal range"
        
        report = [f"\\n⚠️  Found {len(violations)} threshold violations:\\n"]
        
        for v in violations:
            report.append(
                f"  [{v['severity']}] Site {v['site_id']} - {v['kpi']}: "
                f"{v['value']:.2f} (threshold: {v['threshold']:.2f})"
            )
        
        return "\\n".join(report)
    
    def run(self):
        """Main monitoring loop"""
        logger.info("Starting network monitor...")
        
        if not self.connect():
            return
        
        try:
            # Get KPI data
            kpi_data = self.get_kpi_data()
            
            # Check thresholds
            violations = self.check_thresholds(kpi_data)
            
            # Generate report
            report = self.generate_report(violations)
            print(report)
            
        except Exception as e:
            logger.error(f"Monitoring failed: {e}")
        finally:
            if self.conn:
                self.conn.close()
                logger.info("Database connection closed")


if __name__ == '__main__':
    monitor = NetworkMonitor()
    monitor.run()
`;

    return {
      code,
      language: 'python',
      filename: this.generateFilename(requirements),
      description: requirements.description,
      dependencies: ['psycopg2']
    };
  }

  /**
   * Generate JavaScript/TypeScript code
   */
  static async generateJavaScriptCode(requirements: AppRequirements): Promise<GeneratedCode> {
    // Similar to Python but for JavaScript
    const code = `// ${requirements.description}
// Auto-generated monitoring script

const { Client } = require('pg');

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5433,
  database: process.env.DB_NAME || 'naavik_demo',
  user: process.env.DB_USER || 'naavik_user',
  password: process.env.DB_PASSWORD
};

const MONITORED_KPIS = ${JSON.stringify(requirements.kpis, null, 2)};
const THRESHOLDS = ${JSON.stringify(requirements.alertThresholds || {}, null, 2)};

class NetworkMonitor {
  async connect() {
    this.client = new Client(DB_CONFIG);
    await this.client.connect();
    console.log('Connected to database');
  }
  
  async getKPIData(siteId = null) {
    const query = \`
      SELECT "SiteID", "CellName", "KPIName", "KPIValue", "DateID"
      FROM kpi_metrics
      WHERE "KPIName" = ANY($1)
      \${siteId ? 'AND "SiteID" = $2' : ''}
      ORDER BY "DateID" DESC
      LIMIT 100
    \`;
    
    const params = siteId ? [MONITORED_KPIS, siteId] : [MONITORED_KPIS];
    const result = await this.client.query(query, params);
    return result.rows;
  }
  
  checkThresholds(kpiData) {
    return kpiData.filter(record => {
      const threshold = THRESHOLDS[record.KPIName];
      return threshold && parseFloat(record.KPIValue) > threshold;
    });
  }
  
  async run() {
    await this.connect();
    const kpiData = await this.getKPIData();
    const violations = this.checkThresholds(kpiData);
    
    if (violations.length === 0) {
      console.log('✓ All KPIs within normal range');
    } else {
      console.log(\`⚠️  Found \${violations.length} threshold violations\`);
      violations.forEach(v => {
        console.log(\`  Site \${v.SiteID} - \${v.KPIName}: \${v.KPIValue}\`);
      });
    }
    
    await this.client.end();
  }
}

const monitor = new NetworkMonitor();
monitor.run().catch(console.error);
`;

    return {
      code,
      language: 'javascript',
      filename: this.generateFilename(requirements).replace('.py', '.js'),
      description: requirements.description,
      dependencies: ['pg']
    };
  }
}
