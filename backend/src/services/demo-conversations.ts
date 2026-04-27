/**
 * Demo Conversation Scenarios for AppGen
 * Pre-scripted realistic conversations that lead to app generation
 */

export interface DemoScenario {
  id: string;
  name: string;
  description: string;
  conversation: Array<{ role: 'user' | 'assistant'; content: string; delay?: number }>;
  finalWorkflow: any;
  icon?: string;
}

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: 'prb-optimization',
    name: 'PRB Utilization Optimizer',
    description: 'Optimize cell capacity by adjusting coverage when utilization is high',
    icon: '📊',
    conversation: [
      {
        role: 'user',
        content: 'I want to reduce congestion when cells get overloaded',
      },
      {
        role: 'assistant',
        content: "Got it! Let's build a congestion management app. What metric should we monitor to detect overload?",
        delay: 800,
      },
      {
        role: 'user',
        content: 'PRB utilization - when it goes above 90%',
      },
      {
        role: 'assistant',
        content: 'Perfect! **PRB utilization > 90%** will be our trigger. What action should the app take when this happens?',
        delay: 1000,
      },
      {
        role: 'user',
        content: 'Increase qRxLevMin to shrink cell coverage and push users to neighbor cells',
      },
      {
        role: 'assistant',
        content: 'Excellent strategy! **Increase qRxLevMin** to reduce serving area. Should this apply to 4G cells, 5G cells, or both?',
        delay: 900,
      },
      {
        role: 'user',
        content: '4G cells for now',
      },
      {
        role: 'assistant',
        content: 'Got it! **4G cells only** (EUtranCell). By how much should we increase qRxLevMin? Typical range is 1-4 dB.',
        delay: 800,
      },
      {
        role: 'user',
        content: 'Increase by 2 dB',
      },
      {
        role: 'assistant',
        content: "Perfect! I'll create an app that:\n\n1. **Iterates** over all 4G cells\n2. **Checks** if DL PRB utilization > 90%\n3. **Increases** qRxLevMin by 2 dB\n\nGenerating workflow and code...",
        delay: 1200,
      },
    ],
    finalWorkflow: {
      name: 'PRBUtilizationOptimizer',
      description: 'Reduces congestion by adjusting cell coverage when PRB utilization exceeds 90%',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'n1', type: 'action', label: 'Get all 4G cells', data: { action: 'get_cm_handle_ids', entityType: 'EUtranCell' } },
        { id: 'n2', type: 'action', label: 'For each cell...', data: { action: 'iterate', variable: 'cmhandle_id' } },
        { id: 'n3', type: 'action', label: 'Get PRB utilization', data: { action: 'get_kpi', kpi: 'AVG_DL_PRB_UTIL' } },
        { id: 'n4', type: 'condition', label: 'PRB > 90%?', data: { condition: 'avg_dl_prb_util > 90' } },
        { id: 'n5', type: 'action', label: 'Increase qRxLevMin by 2 dB', data: { action: 'update_parameter', parameter: 'qRxLevMin', change: '+2' } },
        { id: 'n6', type: 'action', label: 'Log result', data: { action: 'log_report' } },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { from: 'start', to: 'n1' },
        { from: 'n1', to: 'n2' },
        { from: 'n2', to: 'n3' },
        { from: 'n3', to: 'n4' },
        { from: 'n4', to: 'n5', label: 'yes' },
        { from: 'n4', to: 'n6', label: 'no' },
        { from: 'n5', to: 'n6' },
        { from: 'n6', to: 'end' },
      ],
    },
  },

  {
    id: 'handover-optimization',
    name: 'Handover Failure Reducer',
    description: 'Improve mobility by adjusting handover thresholds when failures are high',
    icon: '📶',
    conversation: [
      {
        role: 'user',
        content: 'Users are experiencing dropped calls during handovers',
      },
      {
        role: 'assistant',
        content: 'Handover failures can be frustrating! Let me help you build an app to address this. Which KPI are you monitoring for handover issues?',
        delay: 900,
      },
      {
        role: 'user',
        content: 'Handover failure rate - when it exceeds 5%',
      },
      {
        role: 'assistant',
        content: 'Good choice! **Handover failure rate > 5%** will be our condition. What parameter adjustment would help reduce failures?',
        delay: 1000,
      },
      {
        role: 'user',
        content: 'Decrease a3Offset to make handovers trigger earlier',
      },
      {
        role: 'assistant',
        content: 'Smart! **Lower a3Offset** means handovers start sooner, giving more time. By how much should we decrease it?',
        delay: 850,
      },
      {
        role: 'user',
        content: 'Reduce by 1 dB',
      },
      {
        role: 'assistant',
        content: "Perfect! Creating an app that:\n\n1. **Monitors** handover failure rate\n2. **Detects** when failures > 5%\n3. **Decreases** a3Offset by 1 dB\n\nGenerating workflow...",
        delay: 1100,
      },
    ],
    finalWorkflow: {
      name: 'HandoverFailureReducer',
      description: 'Reduces handover failures by adjusting a3Offset threshold when failure rate exceeds 5%',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'n1', type: 'action', label: 'Get all 4G cells', data: { action: 'get_cm_handle_ids', entityType: 'EUtranCell' } },
        { id: 'n2', type: 'action', label: 'For each cell...', data: { action: 'iterate', variable: 'cmhandle_id' } },
        { id: 'n3', type: 'action', label: 'Get handover failure rate', data: { action: 'get_kpi', kpi: 'HO_FAIL_RATE' } },
        { id: 'n4', type: 'condition', label: 'Failure rate > 5%?', data: { condition: 'ho_fail_rate > 5' } },
        { id: 'n5', type: 'action', label: 'Decrease a3Offset by 1 dB', data: { action: 'update_parameter', parameter: 'a3Offset', change: '-1' } },
        { id: 'n6', type: 'action', label: 'Log action', data: { action: 'log_report' } },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { from: 'start', to: 'n1' },
        { from: 'n1', to: 'n2' },
        { from: 'n2', to: 'n3' },
        { from: 'n3', to: 'n4' },
        { from: 'n4', to: 'n5', label: 'yes' },
        { from: 'n4', to: 'n6', label: 'no' },
        { from: 'n5', to: 'n6' },
        { from: 'n6', to: 'end' },
      ],
    },
  },

  {
    id: 'rrc-failure-fix',
    name: 'RRC Connection Success Improver',
    description: 'Fix connection establishment failures by adjusting access parameters',
    icon: '🔗',
    conversation: [
      {
        role: 'user',
        content: 'We have sites with high RRC connection failures',
      },
      {
        role: 'assistant',
        content: 'RRC failures prevent users from connecting! Let me help. What threshold indicates a problem for you?',
        delay: 850,
      },
      {
        role: 'user',
        content: 'When RRC failure rate goes above 3%',
      },
      {
        role: 'assistant',
        content: 'Clear target: **RRC failure rate > 3%**. What parameter should we adjust to improve connection success?',
        delay: 950,
      },
      {
        role: 'user',
        content: 'Increase maxHARQTx to allow more retransmissions',
      },
      {
        role: 'assistant',
        content: 'Good call! **More HARQ retries** gives connections more chances. Should this apply to both 4G and 5G, or just one technology?',
        delay: 900,
      },
      {
        role: 'user',
        content: 'Both 4G and 5G cells',
      },
      {
        role: 'assistant',
        content: "Got it! Creating an app for **both EUtranCell and NRCellDU** that:\n\n1. **Detects** RRC failure rate > 3%\n2. **Increases** maxHARQTx\n3. **Improves** connection success\n\nBuilding now...",
        delay: 1100,
      },
    ],
    finalWorkflow: {
      name: 'RRCConnectionImprover',
      description: 'Improves RRC connection success by increasing HARQ retries when failure rate exceeds 3%',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'n1', type: 'action', label: 'Get 4G + 5G cells', data: { action: 'get_cm_handle_ids', entityTypes: ['EUtranCell', 'NRCellDU'] } },
        { id: 'n2', type: 'action', label: 'For each cell...', data: { action: 'iterate', variable: 'cmhandle_id' } },
        { id: 'n3', type: 'action', label: 'Get RRC failure rate', data: { action: 'get_kpi', kpi: 'RRC_FAIL_RATE' } },
        { id: 'n4', type: 'condition', label: 'RRC fail > 3%?', data: { condition: 'rrc_fail_rate > 3' } },
        { id: 'n5', type: 'action', label: 'Increase maxHARQTx', data: { action: 'update_parameter', parameter: 'maxHARQTx', change: '+1' } },
        { id: 'n6', type: 'action', label: 'Log change', data: { action: 'log_report' } },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { from: 'start', to: 'n1' },
        { from: 'n1', to: 'n2' },
        { from: 'n2', to: 'n3' },
        { from: 'n3', to: 'n4' },
        { from: 'n4', to: 'n5', label: 'yes' },
        { from: 'n4', to: 'n6', label: 'no' },
        { from: 'n5', to: 'n6' },
        { from: 'n6', to: 'end' },
      ],
    },
  },

  {
    id: 'data-drop-mitigation',
    name: 'Data Drop Rate Mitigator',
    description: 'Reduce packet drops by optimizing buffer and scheduling parameters',
    icon: '📉',
    conversation: [
      {
        role: 'user',
        content: 'Our data drop rate is too high in some cells',
      },
      {
        role: 'assistant',
        content: 'High data drops hurt user experience. What drop rate level is acceptable vs. problematic for you?',
        delay: 800,
      },
      {
        role: 'user',
        content: 'Anything above 2% is bad',
      },
      {
        role: 'assistant',
        content: 'Clear threshold: **Data drop rate > 2%**. What would you like the app to adjust to reduce drops?',
        delay: 950,
      },
      {
        role: 'user',
        content: 'Increase ulSchedulingAlgorithm parameter to prioritize retransmissions',
      },
      {
        role: 'assistant',
        content: 'Smart! Better scheduling reduces drops. Should we also check if PDCP buffer is near full before making changes?',
        delay: 1000,
      },
      {
        role: 'user',
        content: 'Yes, only adjust if PDCP buffer usage > 80%',
      },
      {
        role: 'assistant',
        content: "Perfect! **Dual condition check**. Creating an app with:\n\n1. **Monitor**: Data drop rate & PDCP buffer\n2. **Trigger**: Drop > 2% AND buffer > 80%\n3. **Action**: Optimize scheduling\n\nGenerating...",
        delay: 1200,
      },
    ],
    finalWorkflow: {
      name: 'DataDropMitigator',
      description: 'Reduces data drops by optimizing scheduling when drop rate > 2% and PDCP buffer > 80%',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'n1', type: 'action', label: 'Get all 4G cells', data: { action: 'get_cm_handle_ids', entityType: 'EUtranCell' } },
        { id: 'n2', type: 'action', label: 'For each cell...', data: { action: 'iterate', variable: 'cmhandle_id' } },
        { id: 'n3', type: 'action', label: 'Get data drop rate', data: { action: 'get_kpi', kpi: 'DATA_DROP_RATE' } },
        { id: 'n4', type: 'action', label: 'Get PDCP buffer', data: { action: 'get_kpi', kpi: 'PDCP_BUFFER_USAGE' } },
        { id: 'n5', type: 'condition', label: 'Drop > 2% AND Buffer > 80%?', data: { condition: 'data_drop_rate > 2 and pdcp_buffer > 80' } },
        { id: 'n6', type: 'action', label: 'Optimize scheduling', data: { action: 'update_parameter', parameter: 'ulSchedulingAlgorithm', value: '1' } },
        { id: 'n7', type: 'action', label: 'Log optimization', data: { action: 'log_report' } },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { from: 'start', to: 'n1' },
        { from: 'n1', to: 'n2' },
        { from: 'n2', to: 'n3' },
        { from: 'n3', to: 'n4' },
        { from: 'n4', to: 'n5' },
        { from: 'n5', to: 'n6', label: 'yes' },
        { from: 'n5', to: 'n7', label: 'no' },
        { from: 'n6', to: 'n7' },
        { from: 'n7', to: 'end' },
      ],
    },
  },

  {
    id: '5g-capacity-boost',
    name: '5G Capacity Booster',
    description: 'Increase 5G throughput by enabling carrier aggregation when load permits',
    icon: '🚀',
    conversation: [
      {
        role: 'user',
        content: 'I want to improve 5G throughput',
      },
      {
        role: 'assistant',
        content: 'Great goal! 5G throughput depends on many factors. What specific strategy did you have in mind?',
        delay: 800,
      },
      {
        role: 'user',
        content: 'Enable carrier aggregation when cells have spare capacity',
      },
      {
        role: 'assistant',
        content: 'Excellent! **Carrier aggregation** boosts speeds. How do we determine if a cell has "spare capacity"?',
        delay: 950,
      },
      {
        role: 'user',
        content: 'When PRB utilization is below 60%',
      },
      {
        role: 'assistant',
        content: 'Perfect threshold: **PRB < 60%** means underutilized. What parameter enables carrier aggregation?',
        delay: 900,
      },
      {
        role: 'user',
        content: 'Set maxNumScells to 4 to allow up to 4 secondary cells',
      },
      {
        role: 'assistant',
        content: "Got it! Building an app that:\n\n1. **Identifies** underutilized 5G cells (PRB < 60%)\n2. **Enables** carrier aggregation (maxNumScells = 4)\n3. **Boosts** throughput capacity\n\nGenerating workflow...",
        delay: 1100,
      },
    ],
    finalWorkflow: {
      name: 'FiveGCapacityBooster',
      description: 'Enables carrier aggregation on underutilized 5G cells to increase throughput capacity',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'n1', type: 'action', label: 'Get all 5G cells', data: { action: 'get_cm_handle_ids', entityType: 'NRCellDU' } },
        { id: 'n2', type: 'action', label: 'For each cell...', data: { action: 'iterate', variable: 'cmhandle_id' } },
        { id: 'n3', type: 'action', label: 'Get PRB utilization', data: { action: 'get_kpi', kpi: 'AVG_DL_PRB_UTIL' } },
        { id: 'n4', type: 'condition', label: 'PRB < 60%?', data: { condition: 'avg_dl_prb_util < 60' } },
        { id: 'n5', type: 'action', label: 'Enable carrier aggregation', data: { action: 'update_parameter', parameter: 'maxNumScells', value: '4' } },
        { id: 'n6', type: 'action', label: 'Log change', data: { action: 'log_report' } },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { from: 'start', to: 'n1' },
        { from: 'n1', to: 'n2' },
        { from: 'n2', to: 'n3' },
        { from: 'n3', to: 'n4' },
        { from: 'n4', to: 'n5', label: 'yes' },
        { from: 'n4', to: 'n6', label: 'no' },
        { from: 'n5', to: 'n6' },
        { from: 'n6', to: 'end' },
      ],
    },
  },
];

/**
 * Get demo scenario by ID
 */
export function getDemoScenario(scenarioId: string): DemoScenario | null {
  return DEMO_SCENARIOS.find((s) => s.id === scenarioId) || null;
}

/**
 * Get random demo scenario
 */
export function getRandomDemoScenario(): DemoScenario {
  return DEMO_SCENARIOS[Math.floor(Math.random() * DEMO_SCENARIOS.length)];
}
