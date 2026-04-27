/**
 * App Generation Agent Service (TypeScript port of appgen-experimental)
 * Multi-turn conversational agent for building telecom automation apps
 */
import { v4 as uuidv4 } from 'uuid';
import { openai } from '../config/openai.js';
import { logger } from '../utils/logger.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Agent action types
export type AgentAction = 'search' | 'create' | 'ask_user' | 'done';

// Agent state
export interface AgentState {
  threadId: string;
  messages: Array<{ role: 'user' | 'assistant' | 'tool'; content: string }>;
  workflow: WorkflowSpec | null;
  generatedCode: string | null;
  nextAction: AgentAction | null;
  pendingQuestion: string | null;
  searchResults: FunctionSearchResult[];
}

export interface WorkflowSpec {
  name: string;
  description: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface WorkflowNode {
  id: string;
  type: 'start' | 'condition' | 'action' | 'end';
  label: string;
  data?: Record<string, unknown>;
}

export interface WorkflowEdge {
  from: string;
  to: string;
  label?: string;
}

export interface TelecomFunction {
  name: string;
  qualified_name: string;
  signature: string;
  description: string;
  parameters: Array<{ name: string; type: string }>;
  returns: { type: string };
  library_requirements: { imports: string[] };
  embedding_text: string;
}

export interface FunctionSearchResult {
  function: TelecomFunction;
  score: number;
}

// In-memory state storage (would use Redis in production)
const agentStates = new Map<string, AgentState>();

// Function library cache
let functionLibrary: TelecomFunction[] | null = null;

export class AppGenAgentService {
  private static hasExplicitBuildPermission(text: string): boolean {
    return (
      text.includes('build now') ||
      text.includes('go ahead') ||
      text.includes('authorize build') ||
      text.includes('approved') ||
      text.includes('proceed to build') ||
      text.includes('generate now') ||
      text.includes('yes, build') ||
      text === 'yes'
    );
  }

  private static hasCompleteAutomationLogic(text: string): boolean {
    const lower = text.toLowerCase();
    const hasCondition = lower.includes('when') || lower.includes('if') || lower.includes('whenever');
    const hasThreshold =
      lower.includes('>') ||
      lower.includes('<') ||
      lower.includes('above') ||
      lower.includes('below') ||
      lower.includes('exceeds') ||
      lower.includes('greater than') ||
      lower.includes('less than') ||
      /\d+%/.test(lower);
    const hasAction =
      lower.includes('increase') ||
      lower.includes('decrease') ||
      lower.includes('set') ||
      lower.includes('change') ||
      lower.includes('adjust') ||
      lower.includes('modify');
    const hasTarget =
      lower.includes('4g') ||
      lower.includes('5g') ||
      lower.includes('cell') ||
      lower.includes('eutrancell') ||
      lower.includes('nrcelldu');
    return (hasCondition && hasThreshold && hasAction) || (hasAction && hasTarget && hasThreshold);
  }

  /**
   * Load function library from JSONL file
   */
  private static async loadFunctionLibrary(): Promise<TelecomFunction[]> {
    if (functionLibrary) return functionLibrary;

    try {
      const functionsPath = path.join(__dirname, '../data/functions.jsonl');
      const content = await fs.readFile(functionsPath, 'utf-8');
      const lines = content.trim().split('\n');
      functionLibrary = lines.map((line) => JSON.parse(line));
      logger.info(`Loaded ${functionLibrary.length} telecom functions`);
      return functionLibrary;
    } catch (error) {
      logger.error('Failed to load function library', error);
      return [];
    }
  }

  /**
   * Search function library (keyword-based for now, can upgrade to semantic later)
   */
  static async searchFunctions(query: string, limit = 5): Promise<FunctionSearchResult[]> {
    const functions = await this.loadFunctionLibrary();
    const queryLower = query.toLowerCase();

    const scored = functions.map((func) => {
      const text = `${func.name} ${func.description} ${func.embedding_text}`.toLowerCase();
      let score = 0;

      // Simple keyword matching
      const keywords = queryLower.split(/\s+/);
      for (const keyword of keywords) {
        if (text.includes(keyword)) {
          score += 1;
        }
        if (func.name.toLowerCase().includes(keyword)) {
          score += 2; // Name matches count more
        }
      }

      return { function: func, score };
    });

    return scored
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Create or get agent state
   */
  static getOrCreateState(threadId?: string): AgentState {
    if (!threadId) {
      threadId = `thread-${uuidv4()}`;
    }

    if (agentStates.has(threadId)) {
      return agentStates.get(threadId)!;
    }

    const state: AgentState = {
      threadId,
      messages: [],
      workflow: null,
      generatedCode: null,
      nextAction: null,
      pendingQuestion: null,
      searchResults: [],
    };

    agentStates.set(threadId, state);
    return state;
  }

  /**
   * Agent decision-making: determine next action based on conversation
   */
  static async makeDecision(state: AgentState): Promise<AgentAction> {
    const messages = state.messages;
    if (messages.length === 0) return 'ask_user';

    const lastUserMessage = messages.filter((m) => m.role === 'user').pop()?.content || '';
    const lower = lastUserMessage.toLowerCase();
    
    logger.info('Agent makeDecision', { 
      messageCount: messages.length, 
      lastUserMessage: lastUserMessage.slice(0, 100) 
    });

    // Only build when user explicitly grants permission.
    if (this.hasExplicitBuildPermission(lower)) {
      return 'create';
    }

    // If they have complete logic, ask for explicit permission instead of auto-building.
    if (this.hasCompleteAutomationLogic(lower)) {
      return 'ask_user';
    }

    // Check if they mentioned specific functions or parameters
    if (
      lower.includes('function') ||
      lower.includes('rsrp') ||
      lower.includes('sinr') ||
      lower.includes('throughput') ||
      lower.includes('handover')
    ) {
      return 'search';
    }

    // "build/create/generate" without details should not auto-build; ask clarifying questions.
    if (lower.includes('build') || lower.includes('create') || lower.includes('generate')) {
      return 'ask_user';
    }

    // Default: ask for clarification/contextual next question.
    return 'ask_user';
  }

  /**
   * Execute search action
   */
  static async executeSearch(state: AgentState): Promise<void> {
    const lastUserMsg = state.messages.filter((m) => m.role === 'user').pop()?.content || '';
    const results = await this.searchFunctions(lastUserMsg, 3);

    state.searchResults = results;

    const resultText =
      results.length > 0
        ? `Found ${results.length} relevant functions:\n${results
            .map((r, i) => `${i + 1}. **${r.function.name}**: ${r.function.description}`)
            .join('\n')}`
        : 'No matching functions found in library.';

    state.messages.push({
      role: 'tool',
      content: resultText,
    });

    state.nextAction = 'done';
  }

  /**
   * Create workflow and generate code
   */
  static async createWorkflow(state: AgentState): Promise<void> {
    // Extract user requirements from conversation
    const userMessages = state.messages.filter((m) => m.role === 'user').map((m) => m.content);
    const requirements = userMessages.join('\n');

    logger.info('createWorkflow: Starting workflow generation', { 
      requirementsLength: requirements.length,
      hasOpenAI: !!process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'dummy-key'
    });
    
    // Use OpenAI to generate workflow structure
    const prompt = `Based on this conversation about a telecom automation app:

${requirements}

Generate a workflow specification as JSON with:
1. name: App name
2. description: What the app does
3. nodes: Array of workflow steps (type: start|condition|action|end, label, id)
4. edges: Connections between nodes (from, to)

Example node types:
- start: Entry point
- condition: Decision point (e.g. "IF PRB > 80")
- action: Operation (e.g. "Increase qRxLevMin")
- end: Completion

Return ONLY valid JSON, no markdown.`;

    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 1500,
      });

      const content = completion.choices[0]?.message?.content?.trim() || '{}';
      // Remove markdown code fences if present
      const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const workflow = JSON.parse(jsonStr);

      state.workflow = workflow;

      // Generate Python code (simplified for now)
      const code = this.generateCodeFromWorkflow(workflow, state.searchResults);
      state.generatedCode = code;

      state.messages.push({
        role: 'assistant',
        content: `Created workflow: **${workflow.name}** with ${workflow.nodes?.length || 0} steps. Code generated!`,
      });

      state.nextAction = 'done';
    } catch (error: any) {
      logger.error('Workflow creation failed', error);
      state.messages.push({
        role: 'assistant',
        content: `I had trouble generating the workflow. Could you clarify your requirements?`,
      });
      state.nextAction = 'ask_user';
    }
  }

  /**
   * Generate Python code from workflow and function library
   */
  private static generateCodeFromWorkflow(workflow: WorkflowSpec, functions: FunctionSearchResult[]): string {
    const functionImports = functions
      .map((r) => `from ${r.function.qualified_name.split('.').slice(0, -1).join('.')} import ${r.function.name}`)
      .join('\n');

    return `"""
${workflow.description}
Auto-generated by Naavik AppGen Agent
"""

${functionImports || '# No specific function imports'}

from adaptors.eiap.eiap_adaptor import EIAPAdaptor as DataAdapter
import json
from datetime import datetime, timezone
from collections import defaultdict

class ${workflow.name.replace(/\s+/g, '')}:
    def __init__(self):
        self.data_adapter = DataAdapter()
        self.report = defaultdict(dict)
        
    def execute(self):
        """Main execution logic"""
        # Get CM Handle IDs
        ids = self.data_adapter.get_cm_handle_ids(
            "/domains/RAN/entity-types/EUtranCell/entities?targetFilter=/sourceIds;/attributes"
        )
        
        for cmhandle_id in ids:
            # TODO: Implement workflow logic based on:
${workflow.nodes
  ?.filter((n) => n.type !== 'start' && n.type !== 'end')
  .map((n) => `            # - ${n.label}`)
  .join('\n') || '            # - Your workflow steps'}
            
            pass
        
        return self.report

if __name__ == "__main__":
    app = ${workflow.name.replace(/\s+/g, '')}()
    result = app.execute()
    print(json.dumps(result, indent=2))
`;
  }

  /**
   * Ask user for clarification
   */
  static async askUser(state: AgentState): Promise<string> {
    const messages = state.messages;
    const lastUserMsg = messages.filter((m) => m.role === 'user').pop()?.content || '';
    const lower = lastUserMsg.toLowerCase();

    if (this.hasCompleteAutomationLogic(lower)) {
      return 'I have enough detail to build this app. Click **Authorize Build** and then **Build the app**, or reply "build now".';
    }

    // Check if OpenAI is available
    const hasOpenAI = process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'dummy-key';
    
    if (!hasOpenAI) {
      // Fallback questions
      if (messages.length <= 2) {
        return 'What automation should we build? Include KPI, threshold, parameter change, and scope (e.g., "When PRB > 90%, increase qRxLevMin by 1 for 4G cells").';
      }
      return 'Based on your last answer, what is the next missing detail: threshold, parameter value, technology scope, or target MO class?';
    }

    // Generate contextual question using OpenAI
    try {
      const recentConversation = messages.slice(-10).map((m) => `${m.role}: ${m.content}`).join('\n');
      const completion = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content:
              'You are building a telecom automation app with the user. Ask exactly one contextual follow-up question based on prior answers. Do not repeat previous questions. Keep it under 30 words.',
          },
          {
            role: 'user',
            content:
              `Conversation so far:\n${recentConversation}\n\n` +
              'Target info to eventually collect: KPI, threshold, parameter, action value, technology scope, MO class. ' +
              'Ask for the most relevant missing piece based on the conversation.',
          },
        ],
        temperature: 0.2,
        max_tokens: 80,
      });

      return completion.choices[0]?.message?.content?.trim() || 'What would you like the app to do?';
    } catch (error: any) {
      logger.error('askUser OpenAI failed', error);
      return 'Could you describe what you want the automation app to do?';
    }
  }

  /**
   * Process user message and advance agent state
   */
  static async processMessage(threadId: string | undefined, userMessage: string): Promise<AgentState> {
    logger.info('processMessage called', { threadId, messageLength: userMessage.length });
    
    const state = this.getOrCreateState(threadId);

    // Add user message
    state.messages.push({
      role: 'user',
      content: userMessage,
    });

    // Decision phase
    const action = await this.makeDecision(state);
    state.nextAction = action;

    logger.info(`Agent decision: ${action}`, { threadId: state.threadId });

    // Execute action
    switch (action) {
      case 'search':
        await this.executeSearch(state);
        break;

      case 'create':
        await this.createWorkflow(state);
        break;

      case 'ask_user':
        const question = await this.askUser(state);
        state.pendingQuestion = question;
        state.messages.push({
          role: 'assistant',
          content: question,
        });
        break;

      case 'done':
        // No further action
        break;
    }

    // Save state
    agentStates.set(state.threadId, state);

    return state;
  }

  /**
   * Get current state for a thread
   */
  static getState(threadId: string): AgentState | null {
    return agentStates.get(threadId) || null;
  }
}
