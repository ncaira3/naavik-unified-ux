/**
 * Constants and Configuration
 * Anomaly thresholds, RCA rules, demo scenarios
 */

// =====================================================
// Anomaly Detection Thresholds
// =====================================================

export const ANOMALY_THRESHOLDS = {
  // Data Drop Rate (higher is worse)
  DATA_DROP_RATE: {
    critical: 5.0,  // % - Above 5% is critical
    warning: 3.0,   // % - Above 3% is warning
  },
  
  // Data Access Rate (lower is worse - inverse threshold)
  DATA_ACC_RATE: {
    critical: 95.0,  // % - Below 95% is critical
    warning: 97.0,   // % - Below 97% is warning
    inverse: true,   // Lower values are worse
  },
  
  // Network Slice ESO Availability (lower is worse)
  NS_ESO_AVAIL: {
    critical: 99.0,   // % - Below 99% is critical
    warning: 99.5,    // % - Below 99.5% is warning
    inverse: true,
  },
  
  // PDCP Throughput MB (lower is worse)
  PDCP_MB: {
    critical: 10,     // Mbps - Below 10 is critical
    warning: 20,      // Mbps - Below 20 is warning
    inverse: true,
  },
  
  // Downlink Throughput
  DL_DRB_TPUT: {
    critical: 5,      // Mbps
    warning: 10,      // Mbps
    inverse: true,
  },
  
  // VoLTE Accessibility
  VOLTE_RAN_ACC: {
    critical: 98.0,   // %
    warning: 99.0,    // %
    inverse: true,
  },
};

// =====================================================
// RCA Configuration
// =====================================================

export const RCA_CONFIG = {
  // When a site has outage, neighbors within this radius are affected
  OUTAGE_IMPACT_RADIUS_KM: 10,
  
  // Traffic increase on neighbors due to outage
  NEIGHBOR_CONGESTION_INCREASE: {
    min: 20,  // % minimum increase
    max: 40,  // % maximum increase
  },
  
  // KPIs affected by congestion
  CONGESTION_AFFECTED_KPIS: [
    'DATA_DROP_RATE',
    'DATA_ACC_RATE',
    'DL_DRB_TPUT',
    'ERAB_DROP',
    'RRC_SETUP_SR'
  ],
  
  // Confidence scoring
  CONFIDENCE_WEIGHTS: {
    spatial_proximity: 0.4,    // How close neighbors are
    temporal_correlation: 0.3, // Timing of anomalies
    kpi_pattern_match: 0.3,    // KPI degradation pattern
  },
};

// =====================================================
// Agent Timing Configuration (for demo realism)
// =====================================================

export const AGENT_TIMING = {
  OBSERVATION: {
    startDelay: 0,       // Starts immediately
    duration: 1500,      // 1.5 seconds
    progressSteps: [0, 30, 60, 100],
  },
  REASONING: {
    startDelay: 1000,    // Starts at 1s
    duration: 1500,      // 1.5 seconds
    progressSteps: [0, 40, 80, 100],
  },
  PERCEPTION: {
    startDelay: 2000,    // Starts at 2s
    duration: 1200,      // 1.2 seconds
    progressSteps: [0, 50, 100],
  },
  SENSING: {
    startDelay: 2500,    // Starts at 2.5s
    duration: 1500,      // 1.5 seconds
    progressSteps: [0, 35, 70, 100],
  },
};

// =====================================================
// Provisioning Workflow Steps
// =====================================================

export const PROVISIONING_STEPS = [
  {
    step: 'SCRIPT_PREPARATION' as const,
    duration: 2000,  // 2 seconds
    message: 'Preparing configuration scripts...',
  },
  {
    step: 'ADRCA_TRIGGER' as const,
    duration: 1000,  // 1 second
    message: 'Triggering ADRCA (Auto-Deploy, Remediate, Configure, Assure)...',
  },
  {
    step: 'IMPLEMENTATION' as const,
    duration: 3000,  // 3 seconds
    message: 'Implementing configuration on network element...',
  },
  {
    step: 'VALIDATION' as const,
    duration: 2000,  // 2 seconds
    message: 'Validating configuration...',
  },
  {
    step: 'HEALTH_CHECK' as const,
    duration: 1000,  // 1 second
    message: 'Running health checks...',
  },
];

// =====================================================
// KPI Display Names
// =====================================================

export const KPI_DISPLAY_NAMES: Record<string, string> = {
  DATA_DROP_RATE: 'Data Drop Rate',
  DATA_ACC_RATE: 'Data Accessibility Rate',
  NS_ESO_AVAIL: 'Network Slice ESO Availability',
  PDCP_MB: 'PDCP Throughput (MB)',
  DL_DRB_TPUT: 'Downlink DRB Throughput',
  UL_DRB_TPUT: 'Uplink DRB Throughput',
  VOLTE_RAN_ACC: 'VoLTE RAN Accessibility',
  ERAB_DROP: 'ERAB Drop Rate',
  RRC_SETUP_SR: 'RRC Setup Success Rate',
};

// =====================================================
// Demo Scenarios (Pre-configured)
// =====================================================

export const DEMO_SCENARIOS = {
  HIGH_DROP_RATE_REGION: {
    name: 'High Drop Rate in Downtown',
    siteIds: ['UST12345', 'UST12346', 'UST12347'],
    trigger: 'DATA_DROP_RATE',
    value: 6.5,
    threshold: 5.0,
  },
  
  OUTAGE_PROPAGATION: {
    name: 'Outage with Neighbor Impact',
    outageSiteId: 'UST12340',
    impactedNeighbors: ['UST12345', 'UST12346', 'UST12347'],
    congestionIncrease: 35,
  },
  
  LOW_THROUGHPUT: {
    name: 'Low Throughput Cluster',
    siteIds: ['UST12850', 'UST12851'],
    trigger: 'DL_DRB_TPUT',
    value: 4.2,
    threshold: 10.0,
  },
};

// =====================================================
// Cache Keys
// =====================================================

export const CACHE_KEYS = {
  SITES_ALL: 'sites:all',
  SITES_BY_DATE: (date: string) => `sites:date:${date}`,
  SITE_DETAILS: (siteId: string) => `site:${siteId}`,
  KPI_TIMESERIES: (siteId: string, kpi: string) => `kpi:${siteId}:${kpi}`,
  ANOMALIES_ACTIVE: 'anomalies:active',
  APPS_ALL: 'apps:all',
};

// =====================================================
// Response Time Targets
// =====================================================

export const PERFORMANCE_TARGETS = {
  INTENT_PARSING: 500,      // ms - Must respond within 500ms
  AGENT_WORKFLOW: 5000,     // ms - Total workflow under 5s
  SITE_QUERY: 200,          // ms - Fast data retrieval
  KPI_QUERY: 500,           // ms - Time-series acceptable
  APP_GENERATION: 10000,    // ms - Code generation can take up to 10s
  PROVISIONING_TOTAL: 10000, // ms - Total ZTP workflow
};
