/**
 * App Generation Service (GenAI AppGen)
 * Conversational interface for building telecom applications
 */
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../config/database.js';
import { openai, SYSTEM_PROMPTS } from '../config/openai.js';
import { 
  AppSpec, 
  AppPackage, 
  AppGenerationRequest, 
  AppGenerationResponse,
  AppStatus,
  DeploymentTarget,
  ResourceType 
} from '../types/index.js';
import { logger } from '../utils/logger.js';

interface Conversation {
  id: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  stage: 'CLARIFYING' | 'GENERATING' | 'COMPLETE';
  appSpec?: AppSpec;
  createdAt: Date;
}

// In-memory conversation storage (would be Redis in production)
const conversations = new Map<string, Conversation>();

const APP_CHAT_SYSTEM_PROMPT = `You are Aira (Naavik), an agentic telecom network automation assistant. You engage in real, dynamic conversation—never repeat the same answer twice.

CRITICAL RULES:
1. **Always acknowledge what the user just said** – Reference their exact words. If they said "iterate over 4G cells, when PRB > 80 increase qRxLevMin", echo back that logic and confirm it.
2. **Never give the same response twice** – If you already asked them to describe logic, and they did, DO NOT ask again. Instead: "Got it! You want to iterate over 4G cells and increase qRxLevMin when PRB exceeds 80%. Click **Build the app** when you're ready."
3. **Be conversational** – Ask follow-ups, offer refinements (e.g. "Want to add a threshold for drop rate too?"), suggest alternatives.
4. **Respond to context** – If they asked about parameters, answer. If they described automation logic, acknowledge and guide next step.

Capabilities:
- Parameter/KPI questions: qRxLevMin, DATA_DROP_RATE, PDCP_MB, avg_dl_prb_util, etc.
- Automation logic: iterate, conditions, actions, EUtranCell, NRCell
- When done: they click **Build the app** to get flowchart + code

Keep responses 2–4 sentences. Use **bold** for emphasis. Be helpful and varied.`;

const APPGEN_LLM_MODEL = process.env.OPENAI_AGENT_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini';

export class AppService {
  private static parseJsonObjectFromText(content: string): Record<string, any> {
    const text = String(content || '').trim();
    if (!text) {
      throw new Error('Empty model response');
    }
    try {
      return JSON.parse(text);
    } catch {
      const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      if (fenced?.[1]) {
        return JSON.parse(fenced[1]);
      }
      const object = text.match(/\{[\s\S]*\}/);
      if (object?.[0]) {
        return JSON.parse(object[0]);
      }
      throw new Error('Could not parse JSON object from model response');
    }
  }

  /**
   * LLM-driven conversational app builder chat (OpenAI)
   */
  static async appChat(messages: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<{ response: string }> {
    const hasOpenAI = process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'dummy-key';
    if (!hasOpenAI) {
      return this.appChatFallback(messages);
    }
    try {
      const completion = await openai.chat.completions.create({
        model: APPGEN_LLM_MODEL,
        messages: [
          { role: 'system', content: APP_CHAT_SYSTEM_PROMPT },
          ...messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        ],
        temperature: 0.8,
        max_tokens: 800,
      });
      const content = completion.choices[0]?.message?.content?.trim();
      return { response: content || "I'm here to help. What would you like to build?" };
    } catch (error) {
      logger.error('App chat OpenAI failed', error);
      return this.appChatFallback(messages);
    }
  }

  private static appChatFallback(messages: Array<{ role: 'user' | 'assistant'; content: string }>): { response: string } {
    const lastUser = messages.filter((m) => m.role === 'user').pop()?.content?.trim() || '';
    const lower = lastUser.toLowerCase();

    // Parameter/KPI questions
    if (lower.includes('what is') || lower.includes('explain') || lower.includes('parameter') || lower.includes('kpi') || lower.endsWith('?')) {
      return { response: "I can help with parameter and KPI questions. Try asking about qRxLevMin, DATA_DROP_RATE, or PRB utilization. For detailed definitions, use the main chat's Knowledge mode." };
    }

    // User provided specific automation logic (iterate, when, prb, qrxlevmin, 4g, 5g, cells)
    const hasSpecificLogic =
      (lower.includes('iterate') && (lower.includes('when') || lower.includes('prb') || lower.includes('qrxlevmin'))) ||
      (lower.includes('when') && (lower.includes('prb') || lower.includes('qrxlevmin') || lower.includes('>'))) ||
      (lower.includes('4g') || lower.includes('5g') || lower.includes('eutran') || lower.includes('nrcell'));

    if (hasSpecificLogic) {
      // They already described logic – acknowledge it, don't ask again
      const summary = lastUser.length > 80 ? lastUser.slice(0, 77) + '...' : lastUser;
      return {
        response: `Got it! You want: **${summary}** — I'll use that when you click **Build the app**. Want to refine anything (e.g. different threshold, another condition) or ready to build?`,
      };
    }

    // Initial "build an app" or vague request – ask for specifics
    if (lower.includes('build') || lower.includes('automate') || lower.includes('create app')) {
      return {
        response: "I'd love to help build your automation. Describe the logic—e.g. **Iterate over 4G cells, when PRB > 80 increase qRxLevMin**. What do you want the app to do?",
      };
    }

    return {
      response: "I can help with:\n\n1. **Parameter/KPI questions** – Ask about qRxLevMin, drop rate, etc.\n2. **Automation** – Describe logic (e.g. iterate over 4G cells, when PRB > 80 increase qRxLevMin)\n3. **Build** – Click **Build the app** when ready.\n\nWhat would you like to do?",
    };
  }

  /**
   * Start or continue app generation conversation
   */
  static async generateApp(request: AppGenerationRequest): Promise<AppGenerationResponse> {
    let conversation: Conversation;
    
    // Get or create conversation
    if (request.conversationId && conversations.has(request.conversationId)) {
      conversation = conversations.get(request.conversationId)!;
    } else {
      conversation = {
        id: uuidv4(),
        messages: [],
        stage: 'CLARIFYING',
        createdAt: new Date(),
      };
      conversations.set(conversation.id, conversation);
    }
    
    // Add user message
    conversation.messages.push({
      role: 'user',
      content: request.userIntent,
    });
    
    // If no OpenAI key, use fallback
    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'dummy-key') {
      return this.fallbackGeneration(conversation, request);
    }
    
    // Call OpenAI to generate or clarify
    try {
      const response = await this.callOpenAI(conversation, request);
      
      conversation.messages.push({
        role: 'assistant',
        content: JSON.stringify(response),
      });
      
      conversations.set(conversation.id, conversation);
      
      return response;
      
    } catch (error) {
      logger.error('App generation failed', error);
      return this.fallbackGeneration(conversation, request);
    }
  }

  /**
   * Call OpenAI for app generation
   */
  private static async callOpenAI(
    conversation: Conversation,
    request: AppGenerationRequest
  ): Promise<AppGenerationResponse> {
    const systemPrompt = `You are an expert 5G/4G RAN engineer building carrier-grade telecom applications.

Your task: Help users build network monitoring and automation apps by:
1. Asking clarifying questions if requirements are unclear
2. Generating production-ready Python code for telecom use cases
3. Following 3GPP standards and O-RAN specifications

Available deployment targets:
- AIRA_NATIVE: Naavik's internal platform
- NAAVIK_STORE: Public app marketplace
- ERICSSON_EIAP: Ericsson Element Manager
- NOKIA_EDEN: Nokia network management
- FUTURE_USE: Reserved for future platforms

Common telecom KPIs: DATA_DROP_RATE, DATA_ACC_RATE, NS_ESO_AVAIL, PDCP_MB, DL_DRB_TPUT, ERAB_DROP, RRC_SETUP_SR, VOLTE_RAN_ACC

Respond with JSON ONLY:
- If clarification needed: {"stage":"CLARIFYING","clarifications":[...]}
- If generating: {"stage":"GENERATING","progress":50}
- If complete: {"stage":"COMPLETE","appSpec":{...}}`;
    
    const messages = [
      { role: 'system' as const, content: systemPrompt },
      ...conversation.messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    ];
    
    const completion = await openai.chat.completions.create({
      model: APPGEN_LLM_MODEL,
      messages,
      temperature: 0.7,
      max_tokens: 3000,
    });
    
    const content = completion.choices[0].message.content;
    if (!content) {
      throw new Error('No response from OpenAI');
    }
    
    const parsed = this.parseJsonObjectFromText(content);
    
    // Update conversation stage
    conversation.stage = parsed.stage || 'CLARIFYING';
    
    if (parsed.stage === 'COMPLETE' && parsed.appSpec) {
      const generatedSpec: AppSpec = {
        id: uuidv4(),
        ...parsed.appSpec,
        generatedAt: new Date().toISOString(),
      };
      conversation.appSpec = generatedSpec;
      
      // Save app to database
      await this.saveApp(generatedSpec);
    }
    
    return {
      conversationId: conversation.id,
      stage: conversation.stage,
      clarifications: parsed.clarifications,
      appSpec: conversation.appSpec,
      progress: parsed.progress,
    };
  }

  /**
   * Fallback app generation (when OpenAI not available)
   */
  private static fallbackGeneration(
    conversation: Conversation,
    request: AppGenerationRequest
  ): AppGenerationResponse {
    const intent = request.userIntent.toLowerCase();
    
    // Simple pattern matching for common requests
    if (conversation.messages.length === 1) {
      // First message - ask clarifications
      return {
        conversationId: conversation.id,
        stage: 'CLARIFYING',
        clarifications: [
          {
            question: 'Which KPI would you like to monitor?',
            options: ['DATA_DROP_RATE', 'DATA_ACC_RATE', 'NS_ESO_AVAIL', 'DL_DRB_TPUT'],
            type: 'single',
          },
          {
            question: 'What threshold should trigger an alert?',
            type: 'text',
          },
          {
            question: 'Where should this app be deployed?',
            options: ['AIRA_NATIVE', 'NAAVIK_STORE', 'ERICSSON_EIAP'],
            type: 'single',
          },
        ],
      };
    }
    
    // Second message - generate app
    const appSpec: AppSpec = {
      id: uuidv4(),
      name: 'Network Monitor App',
      type: ResourceType.APP,
      description: 'Monitor network KPIs and trigger alerts based on thresholds',
      version: '1.0.0',
      dataModel: [
        { name: 'site_id', type: 'string' },
        { name: 'kpi_value', type: 'float' },
        { name: 'threshold', type: 'float' },
        { name: 'timestamp', type: 'datetime' },
      ],
      pages: [
        { title: 'Dashboard', route: '/' },
        { title: 'Alerts', route: '/alerts' },
      ],
      pythonCode: this.generateSampleCode(intent),
      generatedAt: new Date().toISOString(),
      target: DeploymentTarget.AIRA_NATIVE,
    };
    
    conversation.appSpec = appSpec;
    conversation.stage = 'COMPLETE';
    
    // Save app
    this.saveApp(appSpec).catch(err => logger.error('Failed to save app', err));
    
    return {
      conversationId: conversation.id,
      stage: 'COMPLETE',
      appSpec,
      progress: 100,
    };
  }

  /**
   * Generate sample Python code
   */
  private static generateSampleCode(intent: string): string {
    const kpiMatch = intent.match(/drop rate|data drop/i);
    const kpiName = kpiMatch ? 'DATA_DROP_RATE' : 'DATA_ACC_RATE';
    const threshold = kpiMatch ? 5.0 : 95.0;
    
    return `"""
Carrier-Grade Network Monitoring Application
Generated by Naavik AppGen
3GPP Compliant | O-RAN Compatible
"""

import asyncio
from datetime import datetime
from typing import Dict, List
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class NetworkMonitor:
    """
    Monitor ${kpiName} across network sites
    Trigger alerts when threshold is breached
    """
    
    def __init__(self, threshold: float = ${threshold}):
        self.threshold = threshold
        self.alerts: List[Dict] = []
        logger.info(f"NetworkMonitor initialized with threshold: {threshold}")
    
    async def check_kpi(self, site_id: str, kpi_value: float) -> bool:
        """
        Check if KPI value exceeds threshold
        
        Args:
            site_id: Network site identifier
            kpi_value: Current ${kpiName} value
            
        Returns:
            True if alert triggered, False otherwise
        """
        ${kpiMatch ? 'if kpi_value > self.threshold:' : 'if kpi_value < self.threshold:'}
            alert = {
                'site_id': site_id,
                'kpi_name': '${kpiName}',
                'value': kpi_value,
                'threshold': self.threshold,
                'timestamp': datetime.utcnow().isoformat(),
                'severity': self._calculate_severity(kpi_value)
            }
            
            self.alerts.append(alert)
            logger.warning(f"Alert triggered for {site_id}: {kpi_value}")
            
            # Send notification (integrate with SMO/EIAP)
            await self._send_alert(alert)
            
            return True
        
        return False
    
    def _calculate_severity(self, value: float) -> str:
        """Calculate alert severity based on threshold breach"""
        deviation = abs(value - self.threshold) / self.threshold
        
        if deviation > 0.3:
            return 'CRITICAL'
        elif deviation > 0.15:
            return 'WARNING'
        else:
            return 'INFO'
    
    async def _send_alert(self, alert: Dict):
        """Send alert to monitoring system"""
        # Integration point for SMO, ENM, or notification service
        logger.info(f"Alert sent: {alert}")
    
    async def monitor_loop(self, sites: List[str], interval: int = 60):
        """
        Main monitoring loop
        
        Args:
            sites: List of site IDs to monitor
            interval: Check interval in seconds
        """
        logger.info(f"Starting monitoring for {len(sites)} sites")
        
        while True:
            for site_id in sites:
                # Fetch KPI from data source
                kpi_value = await self._fetch_kpi(site_id)
                
                # Check threshold
                await self.check_kpi(site_id, kpi_value)
            
            await asyncio.sleep(interval)
    
    async def _fetch_kpi(self, site_id: str) -> float:
        """Fetch KPI from network data source"""
        # Integration point for Compass API or database
        # Placeholder: return simulated value
        import random
        return random.uniform(${threshold - 2}, ${threshold + 2})

# Entry point
if __name__ == "__main__":
    monitor = NetworkMonitor(threshold=${threshold})
    sites = ["UST12345", "UST12346", "UST12347"]
    
    asyncio.run(monitor.monitor_loop(sites, interval=60))
`;
  }

  /**
   * Save generated app to database
   */
  private static async saveApp(appSpec: AppSpec): Promise<void> {
    const client = await pool.connect();
    
    try {
      const query = `
        INSERT INTO deployed_applications (
          app_id, app_name, app_description, deployment_location,
          app_logic, deployment_status, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (app_id) DO UPDATE SET
          app_name = EXCLUDED.app_name,
          app_description = EXCLUDED.app_description,
          deployment_status = EXCLUDED.deployment_status
      `;
      
      await client.query(query, [
        appSpec.id,
        appSpec.name,
        appSpec.description,
        appSpec.target || DeploymentTarget.AIRA_NATIVE,
        appSpec.pythonCode,
        AppStatus.SYNTHESIZING,
        new Date(),
      ]);
      
      logger.info(`App saved: ${appSpec.name} (${appSpec.id})`);
      
    } finally {
      client.release();
    }
  }

  /**
   * Get all deployed apps
   */
  static async getAllApps(): Promise<AppPackage[]> {
    const client = await pool.connect();
    
    try {
      const query = `
        SELECT 
          app_id, app_name, app_description, deployment_location,
          app_logic, deployment_status, created_at
        FROM deployed_applications
        ORDER BY created_at DESC
      `;
      
      const result = await client.query(query);
      
      return result.rows.map(row => ({
        spec: {
          id: row.app_id,
          name: row.app_name,
          type: ResourceType.APP,
          description: row.app_description,
          version: '1.0.0',
          dataModel: [],
          pythonCode: row.app_logic,
          generatedAt: row.created_at.toISOString(),
          target: row.deployment_location as DeploymentTarget,
        },
        status: row.deployment_status as AppStatus,
      }));
      
    } finally {
      client.release();
    }
  }

  /**
   * Get app by ID
   */
  static async getAppById(appId: string): Promise<AppPackage | null> {
    const client = await pool.connect();
    
    try {
      const query = `
        SELECT 
          app_id, app_name, app_description, deployment_location,
          app_logic, deployment_status, created_at
        FROM deployed_applications
        WHERE app_id = $1
      `;
      
      const result = await client.query(query, [appId]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      const row = result.rows[0];
      
      return {
        spec: {
          id: row.app_id,
          name: row.app_name,
          type: ResourceType.APP,
          description: row.app_description,
          version: '1.0.0',
          dataModel: [],
          pythonCode: row.app_logic,
          generatedAt: row.created_at.toISOString(),
          target: row.deployment_location as DeploymentTarget,
        },
        status: row.deployment_status as AppStatus,
      };
      
    } finally {
      client.release();
    }
  }

  /**
   * Deploy app (simulate deployment)
   */
  static async deployApp(appId: string, target: DeploymentTarget): Promise<void> {
    const client = await pool.connect();
    
    try {
      // Update status to ACTIVE
      const query = `
        UPDATE deployed_applications
        SET deployment_status = $1, deployment_location = $2, deployed_at = $3
        WHERE app_id = $4
      `;
      
      await client.query(query, [AppStatus.ACTIVE, target, new Date(), appId]);
      
      logger.info(`App deployed: ${appId} to ${target}`);
      
    } finally {
      client.release();
    }
  }

  /**
   * Delete app
   */
  static async deleteApp(appId: string): Promise<void> {
    const client = await pool.connect();
    
    try {
      const query = 'DELETE FROM deployed_applications WHERE app_id = $1';
      await client.query(query, [appId]);
      
      logger.info(`App deleted: ${appId}`);
      
    } finally {
      client.release();
    }
  }

  /**
   * Generate EIAP-compliant Python code from natural language
   * This follows the Ericsson EIAP pattern with proper structure
   */
  static async generateEIAPCode(
    naturalLanguageInput: string,
    createdBy?: string
  ): Promise<{
    code: string;
    appId: string;
    appName: string;
    entities: string[];
    conditions: any[];
    actions: any[];
  }> {
    logger.info('Generating EIAP code from natural language');
    
    try {
      // If OpenAI available, use it for generation
      if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'dummy-key') {
        return await this.generateEIAPWithOpenAI(naturalLanguageInput, createdBy);
      } else {
        return this.generateEIAPFallback(naturalLanguageInput, createdBy);
      }
    } catch (error) {
      logger.error('EIAP generation failed, using fallback', error);
      return this.generateEIAPFallback(naturalLanguageInput, createdBy);
    }
  }

  /**
   * Generate EIAP code using OpenAI GPT-4
   */
  private static async generateEIAPWithOpenAI(
    naturalLanguageInput: string,
    createdBy?: string
  ): Promise<any> {
    const systemPrompt = `You are an expert in generating Ericsson EIAP-compatible Python code for telecom network automation.

CRITICAL: The code MUST follow this EXACT pattern:

1. **Imports**: Always include these exact imports:
   from adaptors.eiap.eiap_adaptor import EIAPAdaptor as DataAdapter
   import json
   import pandas as pd
   import os
   from datetime import datetime, timedelta, timezone
   from collections import defaultdict
   from static.tunable_params import *

2. **Report Functions**: Include CSV report functions exactly as shown:
   - write_csv_headers(csv_path, na_rep)
   - log_report_row(report, cmhandle_id, csv_path, na_rep)

3. **Manager Class Pattern**:
   - Class name: [Entity]Manager (e.g., EutranCellManager)
   - State variables: self.all_cmhandle_ids, self.curr_id, self.data_adapter, self.report, self.app_name
   - Start method: def start(self) that calls first loop method
   
4. **Loop Pattern**: 
   def loop_[entity_plural](self):
       if self.all_cmhandle_ids is None:
           # Initialize: get IDs, create report
           write_csv_headers()
           self.all_cmhandle_ids = self.data_adapter.get_cm_handle_ids("/domains/RAN/entity-types/[EntityType]/entities?targetFilter=/sourceIds;/attributes")
           self.curr_id = 0
           self.report[self.all_cmhandle_ids[self.curr_id]]["app_name"] = self.app_name
           self.report[self.all_cmhandle_ids[self.curr_id]]["timestamp"] = datetime.now(timezone.utc).isoformat()
           self.[first_condition_method]()
       elif self.curr_id < len(self.all_cmhandle_ids) - 1:
           # Continue loop
           log_report_row(report=self.report, cmhandle_id=self.all_cmhandle_ids[self.curr_id])
           self.curr_id += 1
           self.report[self.all_cmhandle_ids[self.curr_id]]["app_name"] = self.app_name
           self.report[self.all_cmhandle_ids[self.curr_id]]["timestamp"] = datetime.now(timezone.utc).isoformat()
           self.[first_condition_method]()
       else:
           # End loop
           log_report_row(report=self.report, cmhandle_id=self.all_cmhandle_ids[self.curr_id])
           print("done")

5. **Condition Checking Pattern**:
   def check_[condition_name](self):
       cmhandle_id = self.all_cmhandle_ids[self.curr_id]
       [kpi_name] = self.data_adapter.get(cmhandle_id, "kpi", "[kpi_field_name]")
       condition_met = [kpi_name] [operator] [threshold]
       self.report[cmhandle_id]['check_[condition_name]'] = str(condition_met)
       if condition_met:
           self.[action_method]()
       else:
           self.loop_[entity_plural]()

6. **Action Pattern**:
   def [action_name](self):
       cmhandle_id = self.all_cmhandle_ids[self.curr_id]
       mo_class = "[MOClass]"
       parameter = "[parameterName]"
       value = [value]
       self.data_adapter.update(cmhandle_id, mo_class, parameter, value)
       self.report[cmhandle_id]['[action_name]'] = f"{parameter}->{value}"
       self.loop_[entity_plural]()

7. **Main Function**:
   def main():
       [entity]_manager = [Entity]Manager()
       [entity]_manager.start()
   
   if __name__ == "__main__":
       main()

RESPOND WITH JSON ONLY:
{
  "appName": "descriptive_app_name",
  "description": "what the app does",
  "entities": ["EUtranCell"],
  "conditions": [{"kpi": "kpi_name", "operator": ">", "threshold": 80}],
  "actions": [{"moClass": "EUtranCellFDD", "parameter": "qRxLevMin", "value": -115}],
  "code": "the complete Python code following the EXACT pattern above"
}`;

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: `Generate EIAP code for: ${naturalLanguageInput}` },
    ];

    const completion = await openai.chat.completions.create({
      model: APPGEN_LLM_MODEL,
      messages,
      temperature: 0.3,
      max_tokens: 4000,
    });

    const content = completion.choices[0].message.content;
    if (!content) {
      throw new Error('No response from OpenAI');
    }

    const parsed = this.parseJsonObjectFromText(content);
    
    // Generate UUID for the app
    const appId = uuidv4();
    
    // Save to generated_app_table
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO generated_app_table (
          app_id, app_name, description, natural_language_input, generated_code,
          mo_classes, kpis_used, status, deployment_target, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          appId,
          parsed.appName,
          parsed.description,
          naturalLanguageInput,
          parsed.code,
          parsed.actions?.map((a: any) => a.moClass) || [],
          parsed.conditions?.map((c: any) => c.kpi) || [],
          'draft',
          'ERICSSON_EIAP',
          createdBy || null
        ]
      );
      
      logger.info(`EIAP app created: ${parsed.appName} (${appId})`);
    } finally {
      client.release();
    }

    return {
      code: parsed.code,
      appId,
      appName: parsed.appName,
      entities: parsed.entities || [],
      conditions: parsed.conditions || [],
      actions: parsed.actions || []
    };
  }

  /**
   * Fallback EIAP code generation (pattern-based)
   */
  private static generateEIAPFallback(
    naturalLanguageInput: string,
    createdBy?: string
  ): any {
    // Parse intent from natural language
    const intent = naturalLanguageInput.toLowerCase();
    
    // Extract entity type
    let entityType = 'EUtranCell';
    let entityClass = 'EUtranCellFDD';
    if (intent.includes('4g') || intent.includes('lte') || intent.includes('eutran')) {
      entityType = 'EUtranCell';
      entityClass = 'EUtranCellFDD';
    }
    
    // Extract KPI and threshold
    let kpiName = 'dl_prb_utilization';
    let kpiField = 'avg_dl_prb_util';
    let operator = '>';
    let threshold = 80;
    
    if (intent.includes('prb') || intent.includes('util') || intent.includes('utilization')) {
      kpiName = 'dl_prb_utilization';
      kpiField = 'avg_dl_prb_util';
      operator = '>';
      const prbMatch = intent.match(/([<>]=?)\s*(\d+)/) || intent.match(/(\d+)\s*%?/);
      if (prbMatch) {
        if (prbMatch[1] && ['<', '<=', '>', '>='].includes(prbMatch[1])) operator = prbMatch[1];
        threshold = parseInt(prbMatch[2] || prbMatch[1], 10) || 80;
      }
    } else if (intent.includes('drop')) {
      kpiName = 'drop_rate';
      kpiField = 'drop_rate';
      operator = '>';
      const dropMatch = intent.match(/([<>]=?)\s*(\d+)/) || intent.match(/(\d+)/);
      if (dropMatch) threshold = parseInt(dropMatch[2] || dropMatch[1], 10) || 5;
    }
    
    // Extract parameter and value from natural language
    let parameterName = 'qRxLevMin';
    let parameterValue = -115;
    let useIncrement = true; // increase/decrease by step vs set to value
    let moClass = 'EUtranFreqRelation'; // qRxLevMin lives here per 3GPP

    if (intent.includes('qrxlevmin') || intent.includes('qrxlev')) {
      parameterName = 'qRxLevMin';
      moClass = 'EUtranFreqRelation';
      const match = intent.match(/-?\d+/);
      parameterValue = match ? parseInt(match[0]) : -115;
      useIncrement = intent.includes('increase') || intent.includes('decrease') || intent.includes('adjust');
    } else if (intent.includes('crsgain') || intent.includes('cr gain')) {
      parameterName = 'crsGain';
      moClass = 'EUtranCellFDD';
      const match = intent.match(/-?\d+/);
      parameterValue = match ? parseInt(match[0]) : 0;
      useIncrement = false;
    } else if (intent.includes('downtilt') || intent.includes('down tilt') || intent.includes('antenna tilt') || intent.includes('tilt')) {
      parameterName = 'antennaDowntilt';
      moClass = 'EUtranCellFDD';
      const match = intent.match(/\d+/);
      parameterValue = match ? parseInt(match[0]) : 5;
      useIncrement = false;
    } else if (intent.includes('power') || intent.includes('transmit power')) {
      parameterName = 'transmitPower';
      moClass = 'EUtranCellFDD';
      const match = intent.match(/\d+/);
      parameterValue = match ? parseInt(match[0]) : 43;
      useIncrement = false;
    }
    
    // Generate code - use user's sample structure (CellFlowManager, loop_over_cells, increase_qrxlevmin)
    const appId = uuidv4();
    const appName = (kpiName + '_' + parameterName.toLowerCase() + '_optimizer').replace(/_+/g, '_');
    const actionMethod = useIncrement ? (parameterName === 'qRxLevMin' ? 'increase_qrxlevmin' : `adjust_${parameterName.toLowerCase()}`) : `set_${parameterName.toLowerCase()}`;
    
    const code = `from adaptors.eiap.eiap_adaptor import EIAPAdaptor as DataAdapter
import json
import pandas as pd
import os
from datetime import datetime, timedelta, timezone      
from collections import defaultdict
from static.tunable_params import *

BASE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
REPORT_PATH = os.path.join(BASE_DIR, "report.csv")

def write_csv_headers(csv_path: str = REPORT_PATH, na_rep: str = ""):
    """ Opens a csv file and sets the headers"""
    if not os.path.exists(csv_path) or os.path.getsize(csv_path) == 0:
        headers = ["app_name", "timestamp", "cmhandle_id"]
        headers.extend(['start_flow', 'loop_over_cells', 'check_${kpiName}', '${actionMethod}'])
        df = pd.DataFrame(columns=headers)
        df.to_csv(csv_path, index=False, na_rep=na_rep)
    

def log_report_row(report: dict, cmhandle_id: str, csv_path: str = REPORT_PATH, na_rep: str = ""):
    """
    Logs a single cmhandle_id row from the report dict to a CSV using a constant header list.
    """
    headers = ["app_name", "timestamp", "cmhandle_id"]
    headers.extend(['start_flow', 'loop_over_cells', 'check_${kpiName}', '${actionMethod}'])
    if cmhandle_id not in report:
        print(f"[WARN] cmhandle_id '{cmhandle_id}' not found in report.")
        return

    sub_dict = report[cmhandle_id]

    # Start with default row structure
    row = {col: "" for col in headers}
    row["cmhandle_id"] = cmhandle_id

    # Fill in values if available
    for k, v in sub_dict.items():
        if k in headers:
            row[k] = v

    df = pd.DataFrame([row], columns=headers)
    df.to_csv(csv_path, mode='a', header=False, index=False, na_rep=na_rep)


class CellFlowManager:
    def __init__(self):
        self.all_cmhandle_ids = None
        self.curr_id = None
        self.data_adapter = DataAdapter()
        self.report = defaultdict(lambda: {} )
        self.app_name = '${appId}'

    def start(self):
        self.loop_over_cells()

    def loop_over_cells(self):
        print(f"Executing: loop_over_cells")
    
        if self.all_cmhandle_ids is None:
            write_csv_headers()
        
            ids_eutran = self.data_adapter.get_cm_handle_ids("/domains/RAN/entity-types/EUtranCell/entities?targetFilter=/sourceIds;/attributes")
            ids_nrcellcu = self.data_adapter.get_cm_handle_ids("/domains/RAN/entity-types/NRCellCU/entities?targetFilter=/sourceIds;/attributes")
            ids_nrcelldu = self.data_adapter.get_cm_handle_ids("/domains/RAN/entity-types/NRCellDU/entities?targetFilter=/sourceIds;/attributes")
        
            self.all_cmhandle_ids = list(set(ids_eutran) & set(ids_nrcellcu) & set(ids_nrcelldu))
            self.curr_id = 0
        
            self.report[self.all_cmhandle_ids[self.curr_id]]["app_name"] = self.app_name
            self.report[self.all_cmhandle_ids[self.curr_id]]["timestamp"] = datetime.now(timezone.utc).isoformat()
        
            self.check_${kpiName}()
        
        elif self.curr_id < len(self.all_cmhandle_ids) - 1:
            log_report_row(report=self.report, cmhandle_id=self.all_cmhandle_ids[self.curr_id])
        
            self.curr_id += 1
            self.report[self.all_cmhandle_ids[self.curr_id]]["app_name"] = self.app_name
            self.report[self.all_cmhandle_ids[self.curr_id]]["timestamp"] = datetime.now(timezone.utc).isoformat()
        
            self.check_${kpiName}()
        
        else:
            log_report_row(report=self.report, cmhandle_id=self.all_cmhandle_ids[self.curr_id])
            print("done")

    def check_${kpiName}(self):
        function_name = "check_${kpiName}"
        print(f"Executing: {function_name}")
    
        cmhandle_id = self.all_cmhandle_ids[self.curr_id]
        ${kpiField} = self.data_adapter.get(cmhandle_id, "kpi", "${kpiField}")
    
        if ${kpiField} ${operator} ${threshold}:
            self.report[cmhandle_id][function_name] = "Yes"
            self.${actionMethod}()
        else:
            self.report[cmhandle_id][function_name] = "No"
            self.loop_over_cells()

    def ${actionMethod}(self):
        print("Executing: ${actionMethod}")
        cmhandle_id = self.all_cmhandle_ids[self.curr_id]
        mo_class = "${moClass}"
        parameter = "${parameterName}"
        current_value = self.data_adapter.get(cmhandle_id, mo_class, parameter)
        step = 1  # Predefined step to increase ${parameterName}
        new_value = (current_value + step) if ${useIncrement ? 'True' : 'False'} else ${parameterValue}
        self.data_adapter.update(cmhandle_id, mo_class, parameter, new_value)
        self.report[cmhandle_id]['${actionMethod}'] = f"{parameter}->{new_value}"
        self.loop_over_cells()


def main():
    cell_flow_manager = CellFlowManager()
    cell_flow_manager.start()

if __name__ == "__main__":
    main()
`;
    
    // Save to database (async, don't wait)
    const client = pool.connect();
    client.then(async (conn) => {
      try {
        await conn.query(
          `INSERT INTO generated_app_table (
            app_id, app_name, description, natural_language_input, generated_code,
            mo_classes, kpis_used, status, deployment_target, created_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            appId,
            appName,
            `Automatically optimize ${kpiName} by adjusting ${parameterName}`,
            naturalLanguageInput,
            code,
            [moClass],
            [kpiName],
            'draft',
            'ERICSSON_EIAP',
            createdBy || null
          ]
        );
        logger.info(`EIAP app created (fallback): ${appName} (${appId})`);
      } finally {
        conn.release();
      }
    }).catch(err => logger.error('Failed to save EIAP app', err));
    
    return {
      code,
      appId,
      appName,
      entities: [entityType],
      conditions: [{ kpi: kpiName, operator, threshold }],
      actions: [{ moClass: entityClass, parameter: parameterName, value: parameterValue }]
    };
  }
}
