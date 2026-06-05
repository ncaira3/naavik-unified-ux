/**
 * RCA Strategy types — shared between the dispatcher and per-family modules.
 *
 * A "strategy" takes the precomputed (or live) RCA context for one site and
 * returns a structured `RecommendedAction[]` an engineer can act on. Actions
 * are intentionally action-shaped, not parameter-shaped — engineers don't
 * want a list of EIAP names when the answer is "shift load to neighbours".
 */

export type ActionKind =
  | 'load_shed'        // Traffic balancer — shift HO share to under-loaded neighbours
  | 'layer_move'       // LPE — push the BH layer onto an adjacent carrier/band
  | 'tilt'             // Mechanical / electrical RET adjustment
  | 'power'            // Tx-power / Reference-signal power tweak
  | 'revert'           // Revert a recent config change
  | 'capacity'         // CapEx recommendation — add carrier / cell / sector
  | 'escalate'         // Hardware / transport / software — open ticket
  | 'monitor'          // No action; observe over N hours/days
  | 'validate';        // Re-check after the change

export interface ActionParam {
  /** The parameter name as it should be written into the change request. */
  paramName: string;
  /** Cell / sector / neighbour the change applies to. */
  scope?: string;
  /** Direction the parameter should move ("Increase by 2 dB", "Set to UNLOCKED"). */
  change?: string;
  /** Human-readable description (typically from DataDict). */
  description?: string;
  /** Operational impact summary (typically from the RCA knowledge base). */
  impact?: string;
}

export interface RecommendedAction {
  kind: ActionKind;
  /** Short imperative title — "Shift load to NEIGH 9657". */
  title: string;
  /** 1-2 sentence rationale — why we're suggesting it. */
  rationale: string;
  /** Confidence the strategy has in this action being correct: high / medium / low. */
  confidence?: 'high' | 'medium' | 'low';
  /** Optional structured detail per kind. */
  loadShed?: Array<{
    neighborUsid: string;
    neighborFace?: string;
    currentHoShare?: number;        // 0..1
    neighborPrbHeadroom?: number;   // PRB %-points still available before safety
    paramName?: string;             // e.g. 'cellIndividualOffset' / 'qOffsetCell'
    deltaDb?: number;               // recommended dB shift on CIO
  }>;
  layerMove?: {
    fromBand: string;               // e.g. 'AWS 1700'
    toBand: string;                 // e.g. 'PCS 1900'
    bhPeakPrb?: number;             // PRB% on the source layer at busy hour
    note?: string;
  };
  tilt?: { cellName: string; currentDeg?: number; deltaDeg: number; reason?: string };
  power?: { cellName: string; deltaDb: number; reason?: string };
  /** Parameter list the action touches — duplicated into RecommendationPlan.parameters. */
  params?: ActionParam[];
  /** Evidence citations the engineer can verify ("PRB on NEIGH 9657 = 47% at 19:00"). */
  evidence?: string[];
  /** Predicted KPI deltas produced by `action-simulator`. */
  simulation?: {
    confidence: number;       // 0..1
    basedOn: string;
    predicted: Array<{
      label: string;
      before: string;
      after: string;
      delta: string;
      tone: 'green' | 'amber' | 'red';
    }>;
  };
}

/**
 * Optional structured context any strategy may want when it runs. The
 * dispatcher fills as much as it can from the precomputed RCA + live mirror
 * queries; strategies can pull more themselves if they need to.
 */
export interface StrategyContext {
  siteId: string;
  date: string;                     // YYYY-MM-DD
  bucketName: string;               // canonical (e.g. "Congestion - Traffic Increase - Site")
  bucketConfidence?: number;        // 0..1
  alternativeBuckets?: Array<{ bucket: string; confidence: number }>;
  reasoning?: string;               // chain_of_thought when available
  solutionText?: string;            // RCA's own recommendation text when available
  /**
   * When true: skip DB-backed algorithms (LPE, outage tilt) and return the
   * in-memory playbook immediately. Use for the precomputed-DB path where the
   * bucket name is already known and speed is critical.
   */
  fast?: boolean;
}

export interface StrategyOutput {
  /** Short headline shown above the action list. */
  headline: string;
  /** Confidence chip the UI shows: high / medium / low. */
  confidence?: 'high' | 'medium' | 'low';
  /** Action list — empty for "no action" classes (monitor, planned-maintenance). */
  actions: RecommendedAction[];
  /** Free-text fallback if the strategy doesn't produce structured actions. */
  freeText?: string;
}
