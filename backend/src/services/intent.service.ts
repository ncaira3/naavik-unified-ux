/**
 * Intent Parser Service
 * Uses OpenAI to parse natural language queries into structured intents
 */
import { openai, SYSTEM_PROMPTS } from '../config/openai.js';
import { ParsedIntent, IntentType } from '../types/index.js';
import { logger } from '../utils/logger.js';

export class IntentService {
  /**
   * Parse user's natural language query into structured intent
   */
  static async parseIntent(query: string): Promise<ParsedIntent> {
    const startTime = Date.now();
    
    try {
      // If no OpenAI key, use fallback logic
      if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'dummy-key') {
        return this.fallbackParse(query, startTime);
      }

      // Use OpenAI for intent parsing
      const response = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: SYSTEM_PROMPTS.INTENT_PARSER },
          { role: 'user', content: query },
        ],
        temperature: 0.3,
        max_tokens: 500,
      });

      const content = response.choices[0].message.content;
      if (!content) {
        throw new Error('No response from OpenAI');
      }

      // Parse JSON response
      const parsed = JSON.parse(content);
      
      const executionTime = Date.now() - startTime;
      
      const result: ParsedIntent = {
        intent: this.mapIntentType(parsed.intent_type),
        confidence: parsed.confidence || 0.8,
        chainOfThought: parsed.chain_of_thought || [
          'Analyzed user query',
          'Identified intent pattern',
          'Extracted relevant filters',
        ],
        filters: parsed.filters || {},
        actionParams: parsed.action_params || {},
        executionTime,
      };

      logger.info(`Intent parsed: ${result.intent} (${executionTime}ms)`);
      return result;

    } catch (error) {
      logger.error('Intent parsing failed, using fallback', error);
      return this.fallbackParse(query, startTime);
    }
  }

  /**
   * Fallback intent parsing (rule-based, when OpenAI is not available)
   */
  private static fallbackParse(query: string, startTime: number): ParsedIntent {
    const lowerQuery = query.toLowerCase();
    
    let intent: IntentType = 'UNKNOWN';
    let confidence = 0.6;
    const chainOfThought: string[] = [];
    const filters: any = {};
    const actionParams: any = {};

    chainOfThought.push('Using rule-based intent detection');

    // Detect QUERY_DB intent (highest priority for data queries)
    if (
      lowerQuery.includes('show me') ||
      lowerQuery.includes('list') ||
      lowerQuery.includes('get') ||
      lowerQuery.includes('find') ||
      lowerQuery.includes('display') ||
      lowerQuery.includes('all sites') ||
      lowerQuery.includes('all cells') ||
      (lowerQuery.includes('how many') && !lowerQuery.includes('why'))
    ) {
      intent = 'QUERY_DB';
      confidence = 0.85;
      chainOfThought.push('Detected database query keywords');
      actionParams.requiresTable = true;
    }

    // Detect ANALYZE_DATA intent
    else if (
      lowerQuery.includes('analyze') ||
      lowerQuery.includes('compare') ||
      lowerQuery.includes('trend') ||
      lowerQuery.includes('average') ||
      lowerQuery.includes('statistics') ||
      lowerQuery.includes('distribution')
    ) {
      intent = 'ANALYZE_DATA';
      confidence = 0.8;
      chainOfThought.push('Detected data analysis keywords');
      actionParams.requiresVisualization = true;
    }

    // Detect SHOW_MAP intent
    else if (
      lowerQuery.includes('map') ||
      lowerQuery.includes('plot') ||
      lowerQuery.includes('visualize') ||
      lowerQuery.includes('show on map')
    ) {
      intent = 'SHOW_MAP';
      confidence = 0.85;
      chainOfThought.push('Detected map visualization keywords');
    }

    // Detect CREATE_DASHBOARD intent
    else if (
      lowerQuery.includes('dashboard') ||
      lowerQuery.includes('create dashboard') ||
      lowerQuery.includes('build dashboard')
    ) {
      intent = 'CREATE_DASHBOARD';
      confidence = 0.9;
      chainOfThought.push('Detected dashboard creation keywords');
    }

    // Detect CREATE_WORKFLOW intent
    else if (
      lowerQuery.includes('workflow') ||
      lowerQuery.includes('automate') ||
      lowerQuery.includes('alert when') ||
      lowerQuery.includes('trigger')
    ) {
      intent = 'CREATE_WORKFLOW';
      confidence = 0.85;
      chainOfThought.push('Detected workflow creation keywords');
    }

    // Detect GENERATE_CODE intent
    else if (
      lowerQuery.includes('generate code') ||
      lowerQuery.includes('write script') ||
      lowerQuery.includes('create script')
    ) {
      intent = 'GENERATE_CODE';
      confidence = 0.85;
      chainOfThought.push('Detected code generation keywords');
    }

    // Detect OBSERVE intent
    else if (
      lowerQuery.includes('what') ||
      lowerQuery.includes('wrong') ||
      lowerQuery.includes('problem') ||
      lowerQuery.includes('issue') ||
      lowerQuery.includes('anomal') ||
      lowerQuery.includes('health')
    ) {
      intent = 'OBSERVE';
      confidence = 0.75;
      chainOfThought.push('Detected observation/monitoring keywords');
      
      // Extract severity
      if (lowerQuery.includes('critical') || lowerQuery.includes('urgent')) {
        filters.severity = 'critical';
        chainOfThought.push('Filtered for critical severity');
      } else if (lowerQuery.includes('warning') || lowerQuery.includes('warn')) {
        filters.severity = 'warning';
        chainOfThought.push('Filtered for warnings');
      }
      
      // Extract site ID
      const siteMatch = lowerQuery.match(/ust\d+/i);
      if (siteMatch) {
        filters.siteId = siteMatch[0].toUpperCase();
        chainOfThought.push(`Identified site: ${filters.siteId}`);
      }
      
      // Extract KPI type
      if (lowerQuery.includes('drop rate')) {
        filters.kpiType = 'DATA_DROP_RATE';
        chainOfThought.push('KPI type: Data Drop Rate');
      } else if (lowerQuery.includes('access')) {
        filters.kpiType = 'DATA_ACC_RATE';
        chainOfThought.push('KPI type: Data Access Rate');
      } else if (lowerQuery.includes('throughput') || lowerQuery.includes('tput')) {
        filters.kpiType = 'DL_DRB_TPUT';
        chainOfThought.push('KPI type: Throughput');
      }
    }

    // Detect BUILD_APP intent
    else if (
      lowerQuery.includes('build') ||
      lowerQuery.includes('create') ||
      lowerQuery.includes('app') ||
      lowerQuery.includes('application')
    ) {
      intent = 'BUILD_APP';
      confidence = 0.8;
      chainOfThought.push('Detected app building/creation keywords');
      
      // Extract monitoring parameters
      if (lowerQuery.includes('alert') || lowerQuery.includes('notify')) {
        actionParams.enableAlerts = true;
        chainOfThought.push('Alerting requested');
      }
      
      // Extract threshold values
      const thresholdMatch = lowerQuery.match(/(\d+\.?\d*)%/);
      if (thresholdMatch) {
        actionParams.threshold = parseFloat(thresholdMatch[1]);
        chainOfThought.push(`Threshold: ${actionParams.threshold}%`);
      }
    }

    // Detect PROVISION intent
    else if (
      lowerQuery.includes('provision') ||
      lowerQuery.includes('deploy') ||
      lowerQuery.includes('new site') ||
      lowerQuery.includes('base station') ||
      lowerQuery.includes('configure')
    ) {
      intent = 'PROVISION';
      confidence = 0.85;
      chainOfThought.push('Detected provisioning keywords');
      
      if (lowerQuery.includes('5g')) {
        actionParams.technology = '5G';
      } else if (lowerQuery.includes('4g') || lowerQuery.includes('lte')) {
        actionParams.technology = '4G';
      }
    }

    // Detect RCA intent
    else if (
      lowerQuery.includes('why') ||
      lowerQuery.includes('cause') ||
      lowerQuery.includes('reason') ||
      lowerQuery.includes('root cause')
    ) {
      intent = 'ANALYZE_RCA';
      confidence = 0.7;
      chainOfThought.push('Detected root cause analysis request');
    }

    chainOfThought.push(`Final intent: ${intent} (confidence: ${confidence})`);

    const executionTime = Date.now() - startTime;

    return {
      intent,
      confidence,
      chainOfThought,
      filters,
      actionParams,
      executionTime,
    };
  }

  /**
   * Map string intent to IntentType enum
   */
  private static mapIntentType(intentString: string): IntentType {
    const map: Record<string, IntentType> = {
      OBSERVE: 'OBSERVE',
      BUILD_APP: 'BUILD_APP',
      PROVISION: 'PROVISION',
      ANALYZE_RCA: 'ANALYZE_RCA',
    };
    
    return map[intentString] || 'UNKNOWN';
  }

  /**
   * Generate response based on parsed intent
   */
  static generateResponse(intent: ParsedIntent, data?: any): string {
    switch (intent.intent) {
      case 'OBSERVE':
        if (data?.anomalies?.length > 0) {
          return `I found ${data.anomalies.length} anomalies. ${data.anomalies.slice(0, 3).map((a: any) => 
            `${a.siteName} has ${a.severity} ${a.kpiName} issue (value: ${a.value.toFixed(2)})`
          ).join('. ')}.`;
        }
        return 'Network appears healthy. No significant anomalies detected.';
        
      case 'BUILD_APP':
        return 'I can help you build that application. Let me clarify a few requirements...';
        
      case 'PROVISION':
        return 'Initiating zero-touch provisioning workflow. Preparing configuration scripts...';
        
      case 'ANALYZE_RCA':
        if (data?.rca) {
          return `Root cause: ${data.rca.rootCause}. Recommendation: ${data.rca.recommendation}`;
        }
        return 'Analyzing network data to identify root cause...';
        
      default:
        return 'I understand you have a question. Could you rephrase it? Try asking about network status, building an app, or provisioning a site.';
    }
  }
}
