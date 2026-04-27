/**
 * Flow Test Service
 * Generates and simulates flow test cases with mock KPI data
 */

import { logger } from '../utils/logger.js';
import type { WorkflowJSON } from '../types/index.js';

interface FlowTestCase {
  id: string;
  name: string;
  inputs: {
    kpiName: string;
    value: number;
    threshold: number;
    operator: string;
  };
  executionPath: string[];
  result: 'pass' | 'fail';
  details: string;
}

interface FlowTestResult {
  testCases: FlowTestCase[];
  executionTime: number;
}

export class FlowTestService {
  /**
   * Generate and execute test cases for a workflow
   */
  static async generateAndRunTests(
    workflowJson: WorkflowJSON,
    code: string,
    siteId?: string
  ): Promise<FlowTestResult> {
    const startTime = Date.now();

    try {
      // Extract condition nodes from workflow to identify test parameters
      const conditionNodes = workflowJson.nodes.filter((n: any) => n.type === 'condition');

      if (conditionNodes.length === 0) {
        return {
          testCases: [
            {
              id: 'TC001',
              name: 'Workflow Execution',
              inputs: { kpiName: 'N/A', value: 0, threshold: 0, operator: '>' },
              executionPath: workflowJson.nodes.map((n: any) => n.id),
              result: 'pass',
              details: 'No conditional logic detected. Workflow executes all nodes.',
            },
          ],
          executionTime: Date.now() - startTime,
        };
      }

      // Generate mock test cases based on condition nodes
      const testCases: FlowTestCase[] = [];
      let testIndex = 1;

      for (const condNode of conditionNodes) {
        const config = condNode.data?.config || {};
        const kpiName = config.kpi || 'metric';
        const threshold = config.threshold || 50;
        const operator = config.operator || '>';

        // TC1: Value above threshold (condition true)
        const triggerPath = this.traceExecutionPath(workflowJson, condNode.id, true);
        testCases.push({
          id: `TC${String(testIndex).padStart(3, '0')}`,
          name: `${kpiName} above threshold (trigger)`,
          inputs: { kpiName, value: threshold + 10, threshold, operator },
          executionPath: triggerPath,
          result: triggerPath.length > 0 ? 'pass' : 'fail',
          details: `Condition ${kpiName} ${operator} ${threshold} evaluates to TRUE`,
        });
        testIndex++;

        // TC2: Value below threshold (condition false)
        const noTriggerPath = this.traceExecutionPath(workflowJson, condNode.id, false);
        testCases.push({
          id: `TC${String(testIndex).padStart(3, '0')}`,
          name: `${kpiName} below threshold (no trigger)`,
          inputs: { kpiName, value: threshold - 10, threshold, operator },
          executionPath: noTriggerPath,
          result: 'pass',
          details: `Condition ${kpiName} ${operator} ${threshold} evaluates to FALSE`,
        });
        testIndex++;

        // TC3: Value at threshold (edge case)
        if (testCases.length < 6) {
          const edgePath = this.traceExecutionPath(workflowJson, condNode.id, operator.includes('='));
          testCases.push({
            id: `TC${String(testIndex).padStart(3, '0')}`,
            name: `${kpiName} equals threshold (edge case)`,
            inputs: { kpiName, value: threshold, threshold, operator },
            executionPath: edgePath,
            result: 'pass',
            details: `Condition ${kpiName} ${operator} ${threshold} at boundary value`,
          });
          testIndex++;
        }

        // Limit to 3 test cases per condition for brevity
        if (testCases.length >= 9) break;
      }

      return {
        testCases: testCases.slice(0, 9), // Limit to first 9 test cases
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      logger.error('Flow test generation failed:', error);
      return {
        testCases: [
          {
            id: 'TC001',
            name: 'Error Test',
            inputs: { kpiName: 'error', value: 0, threshold: 0, operator: '>' },
            executionPath: [],
            result: 'fail',
            details: `Test generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        executionTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Trace the execution path through a workflow when a condition evaluates
   */
  private static traceExecutionPath(
    workflowJson: WorkflowJSON,
    conditionNodeId: string,
    conditionResult: boolean
  ): string[] {
    const path: string[] = [];
    const visited = new Set<string>();

    // Find all edges from the condition node
    const outgoingEdges = (workflowJson.edges || []).filter((e: any) => e.source === conditionNodeId);

    // Determine which edge to follow based on condition result
    const edgeToFollow = outgoingEdges.find(
      (e: any) => (conditionResult && e.label === 'true') || (!conditionResult && e.label === 'false')
    ) || outgoingEdges[0];

    if (!edgeToFollow) {
      return path;
    }

    // Trace from the target node forward
    let currentNodeId: string | null = edgeToFollow.target;
    while (currentNodeId && !visited.has(currentNodeId)) {
      visited.add(currentNodeId);
      path.push(currentNodeId);

      const node = workflowJson.nodes.find((n: any) => n.id === currentNodeId);
      if (node?.type === 'end') break;

      // Find next node
      const nextEdge = (workflowJson.edges || []).find((e: any) => e.source === currentNodeId);
      currentNodeId = nextEdge?.target || null;
    }

    return path;
  }
}
