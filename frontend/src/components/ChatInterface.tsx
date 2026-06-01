import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, RotateCcw, CheckCircle, AlertTriangle, XCircle, BookOpen, Code2, Map, Radio, ChevronDown, ArrowRight, ChevronRight, X, MessageCircle, Eye, Search, Zap, RefreshCw, FileText, Image as ImageIcon, LayoutDashboard, BarChart2, Square } from 'lucide-react';
import { useSavedDashboards } from '../hooks/useSavedDashboards';
import api from '../services/api';
import apiWithCache from '../services/apiWithCache';
import { AppGenAgentChatResponse, ChatMessage, type ChatAttachment } from '../types';
import ChatMessageComponent from './ChatMessage';
import TypingIndicator from './TypingIndicator';
import AgentActivityCard from './Chat/AgentActivityCard';
import ClarificationCard from './Chat/ClarificationCard';
import { useAgentStream } from '../hooks/useAgentStream';
import { useChat, type ChatStream } from '../context/ChatContext';
import { useMapData } from '../context/MapDataContext';
import { useDummifier } from '../context/DummifierContext';
import { useTheme } from '../context/ThemeContext';
import type { AppSpaceView } from './AppSpaceLayout';
import { classifyIntent } from '../utils/intentClassifier';
import { resolveNavigationIntent } from '../utils/navigationResolver';
import { buildHomeChatMemory, saveHomeChatMemory } from '../services/home-chat-memory';
import { useAppRegistry } from '../platform/useAppRegistry';
import { sanitizeUiBlocks } from '../utils/uiBlocks';
import { ALL_STANDARD_KPIS, KPI_MAP, STANDARD_KPI_GROUPS } from './Chat/ReportComponents/ChatKpiDashboard';
import FluidBackground from './FluidBackground';

type IntentFeedback = 'success' | 'incomplete' | 'error' | null;

const MAX_ATTACHMENTS = 3;
const MAX_CSV_BYTES = 750_000; // ~0.75MB
const MAX_IMAGE_BYTES = 900_000; // keep data URLs reasonably small for JSON POST
const MAX_TEXT_CHARS = 120_000;

const DEFAULT_SUGGESTIONS = [
  'Observe and Analyze',
  'Build an App',
  'Ask the Telco Library',
  'Trigger a change',
];

const STREAM_CONFIG: Record<ChatStream, { label: string; icon: typeof BookOpen; placeholder: string; suggestions: string[] }> = {
  universal: {
    label: 'All Modules',
    icon: BookOpen,
    placeholder: 'Lets chat! What would you like to do?',
    suggestions: DEFAULT_SUGGESTIONS,
  },
  knowledge: {
    label: 'Knowledge',
    icon: BookOpen,
    placeholder: 'Ask about parameters or KPIs (e.g. What is qRxLevMin?)',
    suggestions: ['What is qRxLevMin?', 'Explain DATA_DROP_RATE', 'What parameters affect coverage?'],
  },
  appgen: {
    label: 'Naavik AppGen',
    icon: Code2,
    placeholder: 'Describe your automation (e.g. Increase qRxLevMin when PRB > 80%)',
    suggestions: ['Build app: increase qRxLevMin when PRB exceeds 80%', 'Generate app for drop rate tuning', 'Create automation for load balancing'],
  },
  observability: {
    label: 'Naavik Observe',
    icon: Map,
    placeholder: 'Show data, trends, maps (e.g. Show me sites with alarms)',
    suggestions: ["What's wrong with the network?", 'Show me all sites with alarms', 'Show map of congested cells'],
  },
  provision: {
    label: 'Naavik Provision',
    icon: Radio,
    placeholder: 'Change parameters, provision sites, create scripts',
    suggestions: ['Change qRxLevMin on site X', 'Provision new cells', 'Create script for parameter update'],
  },
};

const ACTION_TAGS = [
  { id: 'show', label: 'Show/Plot', phrase: 'Show me ' },
  { id: 'build', label: 'Build', phrase: 'Build an app to ' },
  { id: 'change', label: 'Change', phrase: 'Change parameter ' },
  { id: 'provision', label: 'Provision', phrase: 'Provision ' },
];

const INTRO_FUTURE_STEPS = [
  { id: 'intent', label: 'Intent', Icon: MessageCircle },
  { id: 'observe', stepNumber: 1, label: 'Observe', Icon: Eye },
  { id: 'root_cause', stepNumber: 2, label: 'Root Cause', Icon: Search },
  { id: 'execute', stepNumber: 3, label: 'Execute', Icon: Zap },
  { id: 'automate', stepNumber: 4, label: 'Automate', Icon: RefreshCw },
  { id: 'outcome', label: 'Outcome', Icon: CheckCircle },
] as const;

const OSS_PARAMETER_INTENT_REGEX =
  /(change|set|update)\s+([a-zA-Z_][a-zA-Z0-9_]*)[\s\S]*?(?:site|on)\s+([a-zA-Z0-9_-]+)[\s\S]*?(?:to|=)\s*(-?\d+(?:\.\d+)?)(?:\s*([a-zA-Z%]+))?/i;
/**
 * UI block / visualization types that produce a panel taller than the chat
 * viewport. When the last assistant message contains one of these we anchor
 * the scroll on the message's TOP so the user lands at the dashboard header
 * (filters, USID switcher, KPI picker) and scrolls DOWN into the charts —
 * instead of being dumped at the very bottom of a long card.
 */
const TALL_UI_BLOCK_TYPES = new Set<string>([
  'kpi_dashboard',
  'diagnosis_card',
  'tabs',
  'grid_layout',
  'rca_story',
  'rca_report',
  'severity_meter',
  'topology_grid',
  'recommendation_card',
]);
const TALL_VISUALIZATION_TYPES = new Set<string>([
  'kpi_dashboard',
  'chat_kpi_dashboard',
  'rca_story',
  'tabs',
  'grid',
]);
function isTallAssistantMessage(msg: any): boolean {
  if (!msg || msg.role !== 'assistant') return false;
  if (Array.isArray(msg.uiBlocks)) {
    for (const b of msg.uiBlocks) {
      if (b && TALL_UI_BLOCK_TYPES.has(b.type)) return true;
    }
  }
  const vt = msg.visualization?.type;
  if (vt && TALL_VISUALIZATION_TYPES.has(vt)) return true;
  return false;
}

function getYesterdayISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}
const WORST_OFFENDERS_DEFAULT_DATE = getYesterdayISO();
const INTENT_CANONICALIZER_V1_ENABLED = true;

type PendingAttachment = ChatAttachment & { id: string };

interface StorySite {
  siteId: string;
  realSiteId?: string;
  siteName: string;
  latitude: number;
  longitude: number;
  isOutage?: boolean;
}

interface SolutionRec {
  technique: string;
  moClass: string;
  parameter: string;
  value: number;
  delta?: number;
  unit: string;
  description: string;
  targetSiteId?: string;
  targetNeighbors?: string[];
}

interface RcaFollowupContext {
  sourceSite: StorySite;
  relatedSites: StorySite[];
  outageNeighborSiteId?: string;
  dateId: string;
  rcaBucket?: string;
  shortSummary?: string;
  trafficCandidates?: StorySite[];
  solutionRec?: SolutionRec;
}

interface ChatInterfaceProps {
  onNavigate?: (view: AppSpaceView) => void;
  currentView?: AppSpaceView;
}

const NAV_CHOICE_IDS = {
  APPGEN: 'nav_appgen',
  OBSERVE: 'nav_observe',
  PROVISION: 'nav_provision',
  SETTINGS: 'nav_settings',
} as const;

interface PendingOssChange {
  siteId: string;
  parameter: string;
  value: string;
  unit?: string;
  sourceQuery: string;
}

/** Return true if a 4-digit string is a calendar year (1900-2099) — not a USID. */
function isLikelyYear(n: string): boolean {
  if (n.length !== 4) return false;
  const v = parseInt(n, 10);
  return v >= 1900 && v <= 2099;
}

/**
 * Extract a USID from a free-text query.
 * Priority: UST-prefix → SITE_X format → numeric after keyword → any 4-6 digit number.
 * 4-digit calendar years (1900-2099) are never returned as USIDs.
 */
function extractDummySiteId(query: string): string | null {
  // 1. UST-format IDs (e.g. UST047323)
  const ustMatch = query.match(/\b(UST\d{4,8})\b/i);
  if (ustMatch) return ustMatch[1].toUpperCase();
  // 2. SITE_X1234 format
  const siteMatch = query.match(/\bsite[\s_-]*([a-z]\d{4,6})\b/i);
  if (siteMatch) return `SITE_${siteMatch[1].toUpperCase()}`;
  // 3. Numeric after "site" keyword (e.g. "site 47323")
  const numericAfterSite = query.match(/\bsite\s+(\d{4,7})\b/i);
  if (numericAfterSite) return numericAfterSite[1];
  // 4. Numeric after common action keywords (e.g. "rca for 1234", "analyze 56789")
  const numericAfterKeyword = query.match(/\b(?:for|analyze|check|show|rca|lookup|explain)\s+(\d{4,6})\b/i);
  if (numericAfterKeyword) return numericAfterKeyword[1];
  // 5. Any standalone 4-6 digit number that is not a calendar year
  const allNums = [...query.matchAll(/\b(\d{4,6})\b/g)].map((m) => m[1]);
  const usid = allNums.find((n) => !isLikelyYear(n));
  return usid ?? null;
}

type SiteLayerMode = 'degraded' | 'outage' | 'overutilized';

function resolveMapLayerFromQuery(query: string): SiteLayerMode | null {
  const lower = query.toLowerCase();
  if (
    lower.includes('outage') ||
    lower.includes('down site') ||
    lower.includes('down sites') ||
    lower.includes('site down')
  ) {
    return 'outage';
  }
  if (
    lower.includes('overutil') ||
    lower.includes('congested') ||
    lower.includes('congestion') ||
    lower.includes('high prb') ||
    lower.includes('prb util') ||
    lower.includes('duac')
  ) {
    return 'overutilized';
  }
  if (
    lower.includes('degraded') ||
    lower.includes('offender') ||
    lower.includes('anomal')
  ) {
    return 'degraded';
  }
  return null;
}

function pickSolutionRec(
  rcaBucket: string,
  sourceSite: StorySite,
  topNeighbors: StorySite[],
): SolutionRec {
  const bucket = rcaBucket.toLowerCase();
  const n1 = topNeighbors[0];
  const n2 = topNeighbors[1];
  const targetNeighbors = [n1?.siteId, n2?.siteId].filter(Boolean) as string[];

  if (bucket.includes('access')) {
    const options: SolutionRec[] = [
      {
        technique: 'Traffic Steering via CIO',
        moClass: 'EUtranCellRelation',
        parameter: 'cellIndividualOffset',
        value: 2 + Math.floor(Math.random() * 2), // 2 or 3 dB
        unit: 'dB',
        description: `Increase EUtranCellRelation.cellIndividualOffset to +${2 + Math.floor(Math.random() * 2)} dB on outbound relations from ${sourceSite.siteId} toward ${n1?.siteId ?? 'neighbor'}`,
        targetSiteId: n1?.siteId,
        targetNeighbors,
      },
      {
        technique: 'Downtilt (Coverage Tuning)',
        moClass: 'EUtranCellFDD',
        parameter: 'electricalAntennaTilt',
        value: 1,
        unit: 'deg',
        description: `Downtilt ${sourceSite.siteId} by 1° to reduce coverage overlap and steer edge users toward ${n1?.siteId ?? 'neighbors'}`,
        targetSiteId: sourceSite.siteId,
        targetNeighbors,
      },
      {
        technique: 'Uptilt Neighbor (Outage Compensation)',
        moClass: 'EUtranCellFDD',
        parameter: 'electricalAntennaTilt',
        value: -1,
        unit: 'deg',
        description: `Uptilt ${n1?.siteId ?? 'neighbor'} by 1° to expand its coverage footprint and absorb additional traffic from ${sourceSite.siteId}`,
        targetSiteId: n1?.siteId,
        targetNeighbors,
      },
      {
        technique: 'Accessibility Parameter Tune',
        moClass: 'EUtranCellFDD',
        parameter: 'qRxLevMin',
        value: -110,
        unit: 'dBm',
        description: `Adjust qRxLevMin on ${sourceSite.siteId} to -110 dBm to reduce UE admission failures and improve RRC setup success`,
        targetSiteId: sourceSite.siteId,
        targetNeighbors,
      },
    ];
    return options[Math.floor(Math.random() * options.length)];
  }

  if (bucket.includes('retain')) {
    return {
      technique: 'Uptilt Neighbor for Outage Compensation',
      moClass: 'EUtranCellFDD',
      parameter: 'electricalAntennaTilt',
      value: 2,
      unit: 'deg',
      description: `Uptilt ${n1?.siteId ?? 'neighbor'} by 2° for outage compensation — expands its serving area to reduce drop rate impact on ${sourceSite.siteId}`,
      targetSiteId: n1?.siteId,
      targetNeighbors,
    };
  }

  // Default — throughput / congestion / load
  return {
    technique: 'Traffic Steering via CIO',
    moClass: 'EUtranCellRelation',
    parameter: 'cellIndividualOffset',
    value: 2,
    unit: 'dB',
    description: `Increase EUtranCellRelation.cellIndividualOffset to +2 dB on outbound relation from ${sourceSite.siteId} toward ${n1?.siteId ?? 'neighbor'} to redistribute load`,
    targetSiteId: n1?.siteId,
    targetNeighbors,
  };
}

function buildRcaAppgenCode(cellScope: string, steeringLogic: string, triggerKpi: string, solutionRec?: SolutionRec): string {
  const cellType = cellScope === '5g' ? 'NRCellDU' : cellScope === 'both' ? 'EUtranCellFDD + NRCellDU' : 'EUtranCellFDD';
  const steeringMap: Record<string, string> = {
    uniform: 'UNIFORM_DISTRIBUTE',
    room: 'CAPACITY_AWARE',
    force: 'FORCED_HANDOVER',
  };
  const steeringMode = steeringMap[steeringLogic] || 'UNIFORM_DISTRIBUTE';
  const steeringDesc: Record<string, string> = {
    uniform: 'Uniformly distribute traffic across all eligible neighbor relations',
    room: 'Identify neighbors with available capacity headroom and steer proportionally',
    force: 'Force-handover users to target cells via aggressive CIO adjustment',
  };

  // Use solution recommendation values when available, otherwise fall back to defaults
  const moClass = solutionRec?.moClass || 'EUtranCellRelation';
  const paramName = solutionRec?.parameter || 'cellIndividualOffset';
  const paramValue = solutionRec?.value ?? 3;
  const paramUnit = solutionRec?.unit || 'dB';
  const technique = solutionRec?.technique || 'Traffic Steering via CIO';
  const targetNeighbors = solutionRec?.targetNeighbors ?? [];
  const targetNeighborsList = targetNeighbors.length
    ? targetNeighbors.map((s) => `"${s}"`).join(', ')
    : '';
  const solutionDescription = solutionRec?.description || steeringDesc[steeringLogic] || steeringDesc.uniform;

  return `#!/usr/bin/env python3
"""
rApp: ${technique}
Generated by Naavik AppGen Agent

Solution    : ${solutionDescription}
Trigger KPI : ${triggerKpi}
Cell Scope  : ${cellType}
MO Class    : ${moClass}
Parameter   : ${moClass.toLowerCase()}.${paramName.toLowerCase()} (target value: ${paramValue} ${paramUnit})
${targetNeighbors.length ? `Target Sites: ${targetNeighbors.join(', ')}` : ''}
"""

import logging
import argparse
from datetime import datetime, timezone
from r1_service_client import R1ServiceClient
from data_adapter import DataAdapter

LOG = logging.getLogger("RAppAgent")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

# ── Configuration ────────────────────────────────────────────────────
TRIGGER_KPI         = "${triggerKpi}"
KPI_THRESHOLD       = 90.0
PARAMETER_VALUE     = ${paramValue}        # ${paramUnit}
STEERING_MODE       = "${steeringMode}"
CELL_TYPES          = ["${cellType.replace(' + ', '", "')}"]
MO_CLASS            = "${moClass}"
PARAMETER_NAME      = "${paramName}"
TARGET_NEIGHBORS    = [${targetNeighborsList}]
DRY_RUN             = False


def _safe_float(val, default=0.0):
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


class TrafficSteeringRApp:
    """
    Main rApp class.
    1. Discovers cells matching CELL_TYPES
    2. Fetches TRIGGER_KPI for each cell
    3. Identifies degraded cells breaching KPI_THRESHOLD
    4. Resolves neighbor relations and applies CIO offset
    """

    def __init__(self, *, dry_run: bool = DRY_RUN):
        self.client = R1ServiceClient()
        self.adapter = DataAdapter()
        self.dry_run = dry_run
        self._rollback_log: list[dict] = []

    # ── Step 1: Discover cells ───────────────────────────────────────
    def _discover_cells(self) -> list[dict]:
        LOG.info("Discovering cells of type: %s", CELL_TYPES)
        cells = []
        for cell_type in CELL_TYPES:
            handles = self.client.get_cm_handles(mo_class=cell_type)
            for h in handles:
                cells.append({
                    "cmHandleId": h["cmHandleId"],
                    "moClass": cell_type,
                    "fdn": h.get("fdn", ""),
                })
        LOG.info("Discovered %d cells", len(cells))
        return cells

    # ── Step 2: Fetch KPIs ───────────────────────────────────────────
    def _fetch_kpis(self, cells: list[dict]) -> list[dict]:
        LOG.info("Fetching KPI '%s' for %d cells", TRIGGER_KPI, len(cells))
        enriched = []
        for cell in cells:
            kpi_val = self.adapter.get_kpi(
                cm_handle=cell["cmHandleId"],
                kpi_name=TRIGGER_KPI,
            )
            cell["kpi_value"] = _safe_float(kpi_val)
            enriched.append(cell)
        return enriched

    # ── Step 3: Evaluate degraded cells ──────────────────────────────
    @staticmethod
    def _filter_degraded(cells: list[dict]) -> list[dict]:
        degraded = [c for c in cells if c["kpi_value"] < KPI_THRESHOLD]
        LOG.info("%d / %d cells below threshold (%.1f)", len(degraded), len(cells), KPI_THRESHOLD)
        return degraded

    # ── Step 4: Resolve neighbors & compute offset ───────────────────
    def _resolve_neighbors(self, cell: dict) -> list[dict]:
        relations = self.client.get_resource(
            cm_handle=cell["cmHandleId"],
            resource_path=f"{MO_CLASS}",
        )
        neighbors = []
        for rel in (relations or []):
            nbr_handle = rel.get("adjacentCell", rel.get("cmHandleId"))
            nbr_kpi = _safe_float(
                self.adapter.get_kpi(cm_handle=nbr_handle, kpi_name=TRIGGER_KPI)
            )
            neighbors.append({
                "cmHandleId": nbr_handle,
                "fdn": rel.get("fdn", ""),
                "kpi_value": nbr_kpi,
                "headroom": max(0, nbr_kpi - KPI_THRESHOLD),
            })
        return neighbors

    def _compute_offsets(self, neighbors: list[dict]) -> list[dict]:
        if STEERING_MODE == "UNIFORM_DISTRIBUTE":
            for n in neighbors:
                n["cio_offset"] = CIO_DEFAULT_OFFSET
        elif STEERING_MODE == "CAPACITY_AWARE":
            total_headroom = sum(n["headroom"] for n in neighbors) or 1.0
            for n in neighbors:
                n["cio_offset"] = round(CIO_DEFAULT_OFFSET * (n["headroom"] / total_headroom), 1)
        elif STEERING_MODE == "FORCED_HANDOVER":
            best = sorted(neighbors, key=lambda n: n["kpi_value"], reverse=True)
            for i, n in enumerate(best):
                n["cio_offset"] = CIO_DEFAULT_OFFSET + (2 * i)
        return [n for n in neighbors if n["cio_offset"] > 0]

    # ── Step 5: Apply CIO changes ────────────────────────────────────
    def _apply_cio(self, source_cell: dict, targets: list[dict]):
        for t in targets:
            current_val = _safe_float(
                self.client.get_resource_value(
                    cm_handle=source_cell["cmHandleId"],
                    resource_path=f"{MO_CLASS}/attributes/{PARAMETER_NAME}",
                )
            )
            new_val = current_val + t["cio_offset"]
            LOG.info(
                "  %s -> %s : %s %s -> %s (offset +%s dB)",
                source_cell["fdn"], t["fdn"],
                PARAMETER_NAME, current_val, new_val, t["cio_offset"],
            )
            if not self.dry_run:
                self.client.set_resource_value(
                    cm_handle=source_cell["cmHandleId"],
                    resource_path=f"{MO_CLASS}/attributes/{PARAMETER_NAME}",
                    value=new_val,
                )
                self._rollback_log.append({
                    "cmHandleId": source_cell["cmHandleId"],
                    "path": f"{MO_CLASS}/attributes/{PARAMETER_NAME}",
                    "previous": current_val,
                })

    # ── Step 6: Rollback on failure ──────────────────────────────────
    def _rollback(self):
        LOG.warning("Rolling back %d changes", len(self._rollback_log))
        for entry in reversed(self._rollback_log):
            try:
                self.client.set_resource_value(
                    cm_handle=entry["cmHandleId"],
                    resource_path=entry["path"],
                    value=entry["previous"],
                )
            except Exception as exc:
                LOG.error("Rollback failed for %s: %s", entry["cmHandleId"], exc)
        self._rollback_log.clear()

    # ── Main execution ───────────────────────────────────────────────
    def execute(self):
        run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        LOG.info("=== Traffic Steering Run %s (dry_run=%s) ===", run_id, self.dry_run)

        cells = self._discover_cells()
        cells = self._fetch_kpis(cells)
        degraded = self._filter_degraded(cells)

        if not degraded:
            LOG.info("No degraded cells found. Nothing to do.")
            return {"run_id": run_id, "status": "no_action", "cells_checked": len(cells)}

        actions_taken = 0
        try:
            for cell in degraded:
                neighbors = self._resolve_neighbors(cell)
                targets = self._compute_offsets(neighbors)
                if targets:
                    LOG.info("Steering traffic for %s (%d targets)", cell["fdn"], len(targets))
                    self._apply_cio(cell, targets)
                    actions_taken += len(targets)
        except Exception:
            LOG.exception("Execution error — initiating rollback")
            self._rollback()
            return {"run_id": run_id, "status": "rolled_back", "error": True}

        summary = {
            "run_id": run_id,
            "status": "completed" if not self.dry_run else "dry_run",
            "cells_checked": len(cells),
            "degraded_count": len(degraded),
            "actions_taken": actions_taken,
        }
        LOG.info("=== Run complete: %s ===", summary)
        return summary


# ── CLI entry point ──────────────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Traffic Steering rApp")
    parser.add_argument("--dry-run", action="store_true", help="Simulate without applying changes")
    args = parser.parse_args()

    app = TrafficSteeringRApp(dry_run=args.dry_run)
    result = app.execute()
    print(result)
`;
}

export default function ChatInterface({ onNavigate, currentView }: ChatInterfaceProps) {
  const { activeStream, setActiveStream, messages, setMessages, clearChat, conversationContext, updateContext, sessionId } = useChat();
  const { setSelectedDateId, setActiveSiteLayer, setFocusSiteToken, setChatHighlightSiteIds } = useMapData();
  const { unmapText } = useDummifier();
  const { theme } = useTheme();
  const { registry } = useAppRegistry();
  const { dashboards: savedDashboardsList } = useSavedDashboards();
  const schemaRef = useRef<string>('');
  const [inputValue, setInputValue] = useState('');

  /** Trim leading/trailing whitespace from pasted text before inserting. */
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').trim();
    const el = e.currentTarget;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    setInputValue((prev) => prev.slice(0, start) + pasted + prev.slice(end));
  };

  const [isLoading, setIsLoading] = useState(false);
  const [latestOffenderDate, setLatestOffenderDate] = useState(WORST_OFFENDERS_DEFAULT_DATE);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<IntentFeedback>(null);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [showActivityPanel, setShowActivityPanel] = useState(false);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  // AbortController for the in-flight agent request. The send button turns
  // into a stop button while a request is running; clicking it aborts.
  const inflightControllerRef = useRef<AbortController | null>(null);

  // SSE streaming hook (V3 streaming endpoint). When the user has SSE enabled
  // (default: on), we route through this hook instead of api.agentV3Chat for
  // live tool-call visibility and clarification cards. Stop button cancels
  // both the legacy AbortController and the SSE stream.
  const agentStream = useAgentStream();

  const handleStopRequest = useCallback(() => {
    inflightControllerRef.current?.abort();
    inflightControllerRef.current = null;
    agentStream.cancel();
    setIsLoading(false);
  }, [agentStream]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollPinnedRef = useRef<boolean>(true);
  const lastAnswerRef = useRef<HTMLDivElement>(null);
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const pendingOssChangesRef = useRef<Record<string, PendingOssChange>>({});
  const rcaFollowupContextRef = useRef<Record<string, RcaFollowupContext>>({});
  const pendingTrafficBalanceRef = useRef<RcaFollowupContext | null>(null);
  const knownStorySitesRef = useRef<Record<string, StorySite>>({});
  const appgenThreadIdRef = useRef<string | undefined>(undefined);
  const appgenAuthTokenRef = useRef<Record<string, string>>({});
  const appgenChoicesRef = useRef<Record<string, { value: string; action?: 'chat' | 'authorize_generate' | 'refine' }>>({});
  const lastGeneratedCodeRef = useRef<string>('');
  const [showHomeIntroModal, setShowHomeIntroModal] = useState(false);
  const rcaAppgenBuildRef = useRef<{
    siteId: string;
    rcaBucket: string;
    cellScope?: string;
    steeringLogic?: string;
    triggerKpi?: string;
    solutionRec?: SolutionRec;
  } | null>(null);

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const formatBytes = (bytes?: number) => {
    const b = Number(bytes || 0);
    if (!b) return '';
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  };

  const readFileAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });

  const buildCsvPreview = (text: string) => {
    const trimmed = String(text || '').replace(/\r\n/g, '\n').trim();
    const lines = trimmed.split('\n').slice(0, 30);
    const header = lines[0] || '';
    const cols = header ? header.split(',').map((c) => c.trim()).filter(Boolean) : [];
    const sample = lines.slice(0, 12).join('\n');
    const colHint = cols.length ? `Columns (${cols.length}): ${cols.slice(0, 12).join(', ')}${cols.length > 12 ? ', …' : ''}` : 'Columns: (could not infer)';
    return `${colHint}\n\nSample (first ${Math.min(12, lines.length)} lines):\n${sample}`;
  };

  // openAttachmentPicker was removed for v1.0 (no multi-modal). The hidden
  // input + handlers stay in place so reintroducing the + button later is a
  // single-line change in the composer.

  const removePendingAttachment = (id: string) => {
    setPendingAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const handleAttachmentInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setAttachmentError(null);

    const next: PendingAttachment[] = [];
    const problems: string[] = [];

    for (const file of Array.from(files)) {
      if (pendingAttachments.length + next.length >= MAX_ATTACHMENTS) {
        problems.push(`You can attach up to ${MAX_ATTACHMENTS} files at a time.`);
        break;
      }

      const name = file.name || 'attachment';
      const mimeType = file.type || '';
      const sizeBytes = file.size || 0;
      const lower = name.toLowerCase();

      try {
        if (mimeType.startsWith('image/') || /\.(png|jpg|jpeg|webp|gif)$/i.test(lower)) {
          if (sizeBytes > MAX_IMAGE_BYTES) {
            problems.push(`${name} is too large (${formatBytes(sizeBytes)}). Max image size is ${formatBytes(MAX_IMAGE_BYTES)}.`);
            continue;
          }
          const dataUrl = await readFileAsDataUrl(file);
          next.push({
            id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
            kind: 'image',
            name,
            mimeType: mimeType || 'image/*',
            sizeBytes,
            dataUrl,
          });
          continue;
        }

        const isCsv =
          lower.endsWith('.csv') ||
          mimeType === 'text/csv' ||
          mimeType === 'application/vnd.ms-excel' ||
          mimeType.startsWith('text/');
        if (isCsv) {
          if (sizeBytes > MAX_CSV_BYTES) {
            problems.push(`${name} is too large (${formatBytes(sizeBytes)}). Max CSV size is ${formatBytes(MAX_CSV_BYTES)}.`);
            continue;
          }
          const text = (await file.text()).slice(0, MAX_TEXT_CHARS);
          next.push({
            id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
            kind: 'csv',
            name,
            mimeType: mimeType || 'text/csv',
            sizeBytes,
            text,
          });
          continue;
        }

        problems.push(`${name}: unsupported file type. Please upload a CSV or an image.`);
      } catch {
        problems.push(`${name}: failed to read file.`);
      }
    }

    setPendingAttachments((prev) => [...prev, ...next].slice(0, MAX_ATTACHMENTS));
    if (problems.length) setAttachmentError(problems[0]);
    if (attachmentInputRef.current) attachmentInputRef.current.value = '';
    requestAnimationFrame(() => (inputRef.current as any)?.focus?.());
  };

  // Fetch the latest available offender date once on mount so we don't hardcode 2026-02-01
  useEffect(() => {
    api.getLatestOffenderDate()
      .then((date: string) => { if (date) setLatestOffenderDate(date); })
      .catch(() => {/* keep default */});
  }, []);

  // Fetch DB schema once and cache as compact summary for agent context
  useEffect(() => {
    if (schemaRef.current) return;
    api.getDatabaseSchema().then((schema: any) => {
      try {
        // Build a compact "table: [col1, col2, ...]" summary
        const tables: Record<string, string[]> = schema?.tables || schema || {};
        const lines = Object.entries(tables)
          .map(([tbl, cols]: [string, any]) => `${tbl}(${Array.isArray(cols) ? cols.slice(0, 12).join(',') : Object.keys(cols).slice(0, 12).join(',')})`);
        schemaRef.current = `[DB Schema: ${lines.join(' | ')}]`;
      } catch {
        schemaRef.current = JSON.stringify(schema).slice(0, 1200);
      }
    }).catch(() => {/* schema unavailable */});
  }, []);

  // Animate placeholder text through prompt shortcuts (only on home view when no messages)
  useEffect(() => {
    if (currentView !== 'home' || messages.length > 0 || inputValue.length > 0) {
      return;
    }

    const interval = setInterval(() => {
      setPlaceholderIndex((prev) => (prev + 1) % ACTION_TAGS.length);
    }, 4000); // Change placeholder every 4 seconds

    return () => clearInterval(interval);
  }, [currentView, messages.length, inputValue.length]);

  // Load RCA context from sessionStorage on mount
  useEffect(() => {
    try {
      const rcaStored = sessionStorage.getItem('naavik-rca-context');
      if (rcaStored) rcaFollowupContextRef.current = JSON.parse(rcaStored);

      const sitesStored = sessionStorage.getItem('naavik-known-sites');
      if (sitesStored) knownStorySitesRef.current = JSON.parse(sitesStored);
    } catch (error) {
      console.warn('Failed to load RCA context from sessionStorage:', error);
    }
  }, []);

  // Save RCA context to sessionStorage
  const saveRcaContext = () => {
    try {
      sessionStorage.setItem('naavik-rca-context', JSON.stringify(rcaFollowupContextRef.current));
    } catch (error) {
      console.warn('Failed to save RCA context:', error);
    }
  };

  // Save known sites to sessionStorage
  const saveKnownSites = () => {
    try {
      sessionStorage.setItem('naavik-known-sites', JSON.stringify(knownStorySitesRef.current));
    } catch (error) {
      console.warn('Failed to save known sites:', error);
    }
  };

  useEffect(() => {
    if (currentView !== 'home') return;
    try {
      // Check if intro modals are enabled in settings
      const showIntroModals = localStorage.getItem('naavik-show-intro-modals');
      const introModalsEnabled = showIntroModals === null ? true : showIntroModals === 'true';

      // If modals are disabled, skip showing them
      if (!introModalsEnabled) {
        setShowHomeIntroModal(false);
        return;
      }

      // Otherwise check if this session has dismissed the modal
      const dismissed = sessionStorage.getItem('naavik-home-intro-dismissed') === '1';
      if (!dismissed) setShowHomeIntroModal(true);
    } catch {
      setShowHomeIntroModal(true);
    }
  }, [currentView]);

  // Add initial greeting message when switching to knowledge stream
  useEffect(() => {
    if (activeStream === 'knowledge' && messages.length === 0) {
      const greetingMessage: ChatMessage = {
        id: Date.now().toString(),
        role: 'assistant',
        content: 'What do you want to learn about the network?',
        timestamp: new Date(),
      };
      setMessages([greetingMessage]);
    }
  }, [activeStream]);

  // Track home chat memory for context persistence
  useEffect(() => {
    if (activeStream === 'universal' && messages.length > 0) {
      const memory = buildHomeChatMemory(conversationContext.conversationId, messages);
      saveHomeChatMemory(memory);
    }
  }, [messages, activeStream, conversationContext.conversationId]);

  const dismissHomeIntroModal = () => {
    setShowHomeIntroModal(false);
    try {
      sessionStorage.setItem('naavik-home-intro-dismissed', '1');
    } catch {
      // no-op if storage is unavailable
    }
  };

  // Clear chat and memory
  const handleClearChat = () => {
    clearChat();
    // Clear RCA context and known sites
    rcaFollowupContextRef.current = {};
    knownStorySitesRef.current = {};
    try {
      sessionStorage.removeItem('naavik-rca-context');
      sessionStorage.removeItem('naavik-known-sites');
      import('../services/home-chat-memory').then(m => m.clearHomeChatMemory());
    } catch (error) {
      console.warn('Failed to clear context:', error);
    }
  };

  const applyAgentUiCommands = (uiCommands?: Array<{ type: string; payload: any }>) => {
    if (!Array.isArray(uiCommands) || uiCommands.length === 0) return;
    uiCommands.forEach((cmd) => {
      if (cmd.type === 'set_date' && cmd.payload?.dateId) {
        setSelectedDateId(String(cmd.payload.dateId));
      } else if (cmd.type === 'set_layer' && cmd.payload?.layer) {
        const layer = String(cmd.payload.layer) as 'degraded' | 'outage' | 'overutilized';
        setActiveSiteLayer(layer);
      } else if ((cmd.type === 'map_focus_site' || cmd.type === 'MAP_FOCUS_SITE') && cmd.payload?.siteToken) {
        setFocusSiteToken(String(cmd.payload.siteToken));
      } else if (cmd.type === 'map_highlight_set' && Array.isArray(cmd.payload?.siteIds)) {
        setChatHighlightSiteIds(new Set(cmd.payload.siteIds.map(String)));
      } else if (cmd.type === 'open_view' && cmd.payload?.view && onNavigate) {
        onNavigate(String(cmd.payload.view) as AppSpaceView);
      }
    });
  };

  // Dispatch streaming uiCommands as they arrive over SSE so the map/KPI panel
  // updates in real time (rather than only after the assistant message lands).
  const lastDispatchedStreamCmdLen = useRef(0);
  useEffect(() => {
    const cmds = agentStream.uiCommands;
    if (!cmds || cmds.length <= lastDispatchedStreamCmdLen.current) return;
    const fresh = cmds.slice(lastDispatchedStreamCmdLen.current) as Array<{ type: string; payload: any }>;
    lastDispatchedStreamCmdLen.current = cmds.length;
    applyAgentUiCommands(fresh);
  }, [agentStream.uiCommands]);
  // Reset the dispatch cursor when a new stream starts.
  useEffect(() => {
    if (agentStream.isStreaming && agentStream.uiCommands.length === 0) {
      lastDispatchedStreamCmdLen.current = 0;
    }
  }, [agentStream.isStreaming, agentStream.uiCommands.length]);

  const appendAgentAssistantMessage = (agentResponse: any) => {
    applyAgentUiCommands(agentResponse?.uiCommands);
    const storyFromViz =
      agentResponse?.visualization?.type === 'rca_story' && agentResponse?.visualization?.data?.sourceSite?.siteId
        ? agentResponse.visualization.data
        : null;
    const storyFromBlocks = Array.isArray(agentResponse?.uiBlocks)
      ? agentResponse.uiBlocks.find((b: any) => b?.type === 'rca_story' && b?.data?.sourceSite?.siteId)?.data
      : null;
    const story = storyFromViz || storyFromBlocks;
    if (story?.sourceSite?.siteId) {
      const sourceSiteId = String(story.sourceSite.siteId);
      rcaFollowupContextRef.current[sourceSiteId] = {
        sourceSite: story.sourceSite,
        relatedSites: Array.isArray(story.relatedSites) ? story.relatedSites : [],
        outageNeighborSiteId: story.outageNeighborSiteId,
        dateId: String(story.dateId || latestOffenderDate),
        rcaBucket: String(story.rcaBucket || ''),
        shortSummary: String(story.shortSummary || ''),
        trafficCandidates: Array.isArray(story.trafficCandidates) ? story.trafficCandidates : [],
      };
    }
    const isRcaStoryViz = agentResponse?.visualization?.type === 'rca_story' || Boolean(storyFromBlocks);
    const uiBlocks = sanitizeUiBlocks(agentResponse?.uiBlocks);
    const assistantMessage: ChatMessage = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: isRcaStoryViz ? '' : String(agentResponse?.assistantMessage || 'Done.'),
      timestamp: new Date(),
      uiSurface: agentResponse?.uiSurface === 'page' ? 'page' : 'chat',
      uiBlocks: uiBlocks.length ? uiBlocks : undefined,
      reportData: agentResponse?.reportData,
      actionButtons: agentResponse?.actionButtons,
      choiceButtons: agentResponse?.choiceButtons,
      executionStatus: agentResponse?.executionStatus,
      visualization: uiBlocks.length ? undefined : agentResponse?.visualization,
    };
    setMessages((prev) => [...prev, assistantMessage]);
  };

  const appendAppGenAgentMessage = (response: AppGenAgentChatResponse) => {
    appgenThreadIdRef.current = response.threadId;
    updateContext({
      appBuilderThreadId: response.threadId,
      appBuilderState: response.state,
    });
    if (response.authorizationToken) {
      appgenAuthTokenRef.current[response.threadId] = response.authorizationToken;
    }

    const choiceButtons = Array.isArray(response.choices)
      ? response.choices.map((choice) => {
          const choiceId = `appgen_choice_${response.threadId}_${choice.id}`;
          appgenChoicesRef.current[choiceId] = {
            value: choice.value,
            action: choice.action,
          };
          return { label: choice.label, choiceId };
        })
      : undefined;

    const assistantMessage: ChatMessage = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: String(response.assistantMessage || 'Ready.'),
      timestamp: new Date(),
      choiceButtons,
    };
    setMessages((prev) => [...prev, assistantMessage]);
  };

  useEffect(() => {
    if (!appgenThreadIdRef.current && conversationContext.appBuilderThreadId) {
      appgenThreadIdRef.current = conversationContext.appBuilderThreadId;
    }
  }, [conversationContext.appBuilderThreadId]);

  const parseOssParameterIntent = (query: string) => {
    const match = query.match(OSS_PARAMETER_INTENT_REGEX);
    if (!match) return null;
    return {
      parameter: match[2],
      siteId: match[3],
      value: match[4],
      unit: match[5] ?? undefined,
    };
  };

  const extractReportDateFromQuery = (query: string): string | undefined => {
    const text = query.trim();
    if (!text) return undefined;

    const isoMatch = text.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/);
    if (isoMatch) {
      const y = isoMatch[1];
      const m = isoMatch[2].padStart(2, '0');
      const d = isoMatch[3].padStart(2, '0');
      return `${y}-${m}-${d}`;
    }

    const usMatch = text.match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})\b/);
    if (usMatch) {
      const m = usMatch[1].padStart(2, '0');
      const d = usMatch[2].padStart(2, '0');
      const yRaw = usMatch[3];
      const y = yRaw.length === 2 ? `20${yRaw}` : yRaw;
      return `${y}-${m}-${d}`;
    }

    return undefined;
  };

  const isWorstOffenderQuery = (query: string) => {
    const ci = classifyIntent(query);
    if (ci.intent === 'worst_offenders') return true;
    const lower = query.toLowerCase();
    return lower.includes('worst offender') || (lower.includes('offender') && lower.includes('day'));
  };

  const isRcaExplainQuery = (query: string) => {
    const ci = classifyIntent(query);
    if (ci.intent === 'rca_explain') return true;
    const lower = query.toLowerCase();
    const hasExplainRca = lower.includes('explain') && lower.includes('rca');
    const hasSiteRef = lower.includes('site') || /ust\d{4,8}/i.test(query);
    return hasExplainRca && hasSiteRef;
  };

  const shouldIncludeRecommendations = (query: string) => {
    const ci = classifyIntent(query);
    if (ci.intent === 'solution_recommendation') return true;
    const lower = query.toLowerCase();
    return (
      lower.includes('recommend') ||
      lower.includes('recommendation') ||
      lower.includes('solution') ||
      lower.includes('action') ||
      lower.includes('fix') ||
      lower.includes('what should') ||
      lower.includes('next step')
    );
  };

  const inferKpiCategory = (rcaBucket: string) => {
    const lower = String(rcaBucket || '').toLowerCase();
    if (lower.includes('outage')) return 'outage';
    if (lower.includes('congestion') || lower.includes('traffic')) return 'congestion';
    if (lower.includes('interference')) return 'interference';
    if (lower.includes('access') || lower.includes('rrc')) return 'accessibility';
    return 'degradation';
  };

  const fetchWorstOffendersTable = async (dateId: string) => {
    const buildAscendingScores = (count: number) => {
      if (count <= 0) return [] as number[];
      const out: number[] = [];
      let current = Math.random() * 8;
      for (let i = 0; i < count; i += 1) {
        out.push(Number(Math.max(0, Math.min(100, current)).toFixed(2)));
        const remaining = count - i - 1;
        if (remaining <= 0) break;
        const maxStep = Math.max(2, (100 - current) / remaining);
        const step = 2 + Math.random() * Math.min(24, maxStep);
        current = Math.min(100, current + step);
      }
      return out.sort((a, b) => a - b);
    };

    const [offenderRes, mapRes] = await Promise.all([
      apiWithCache.getOffenderSiteIds(dateId),
      apiWithCache.getMapSites(),
    ]);

    const offenderIds = new Set<string>((offenderRes.data?.siteIds || []).map((id: string) => String(id)));
    const mapSites: StorySite[] = (Array.isArray(mapRes.data) ? mapRes.data : [])
      .map((site: any) => ({
        siteId: String(site.siteId || ''),
        realSiteId: String(site.siteId || ''),
        siteName: String(site.siteName || site.siteId || ''),
        latitude: Number(site.latitude),
        longitude: Number(site.longitude),
      }))
      .filter((s: StorySite) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude));

    const offenders = mapSites
      .filter((site) => offenderIds.has(site.siteId) || offenderIds.has(String(site.realSiteId || '')))
      .slice(0, 5);

    offenders.forEach((site) => {
      knownStorySitesRef.current[site.siteId.toUpperCase()] = site;
      if (site.realSiteId) {
        knownStorySitesRef.current[String(site.realSiteId).toUpperCase()] = site;
      }
    });
    saveKnownSites();

    const rcaRows = await Promise.all(
      offenders.map(async (site) => {
        try {
          const rcaRes = await apiWithCache.getSiteRCA(site.realSiteId || site.siteId, dateId);
          const rca = rcaRes?.data || {};
          return {
            siteId: site.siteId,
            degradedKpiCategory: inferKpiCategory(String(rca.rcaBucket || '')),
            rankingKpi: 0,
            rca: String(rca.rcaBucket || 'n/a'),
            shortExplanation: String(rca.shortSummary || 'No summary available'),
          };
        } catch {
          return {
            siteId: site.siteId,
            degradedKpiCategory: 'degradation',
            rankingKpi: 0,
            rca: 'RCA unavailable',
            shortExplanation: 'No summary available',
          };
        }
      })
    );

    const scores = buildAscendingScores(rcaRows.length);
    const scoredRows = rcaRows.map((row, idx) => ({
      ...row,
      rankingKpi: scores[idx] ?? 0,
    }));

    return { rows: scoredRows, sites: offenders };
  };

  const fetchRcaStory = async (
    siteId: string,
    dateId: string,
    options?: { showRecommendations?: boolean }
  ) => {
    const toStorySite = (site: any): StorySite | null => {
      const rawSiteId =
        site?.siteId ??
        site?.SiteID ??
        site?.realSiteId ??
        site?.usid ??
        site?.USID;
      const resolvedSiteId = String(rawSiteId || '').trim();
      if (!resolvedSiteId) return null;

      const latitude = Number(site?.latitude ?? site?.Latitude ?? site?.lat);
      const longitude = Number(site?.longitude ?? site?.Longitude ?? site?.lng ?? site?.lon);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

      const siteName = String(site?.siteName || site?.SiteName || '').trim() || resolvedSiteId;

      return {
        siteId: resolvedSiteId,
        realSiteId: resolvedSiteId,
        siteName,
        latitude,
        longitude,
      };
    };

    const mapRes = await apiWithCache.getMapSites();
    const mapSites: StorySite[] = (Array.isArray(mapRes.data) ? mapRes.data : [])
      .map(toStorySite)
      .filter((s): s is StorySite => Boolean(s));
    let sites: StorySite[] = [...mapSites];

    const normalizedSiteId = siteId.trim().toUpperCase();
    const numericPart = normalizedSiteId.replace(/^UST0*/i, '');

    const resolveSourceFrom = (pool: StorySite[]) =>
      pool.find((s) => s.siteId.toUpperCase() === normalizedSiteId) ||
      pool.find((s) => String(s.realSiteId || '').toUpperCase() === normalizedSiteId) ||
      pool.find((s) => String(s.realSiteId || '') === numericPart) ||
      pool.find((s) => String(s.siteId || '').endsWith(numericPart));

    let source: StorySite | undefined =
      resolveSourceFrom(sites) ||
      knownStorySitesRef.current[normalizedSiteId] ||
      knownStorySitesRef.current[numericPart];

    if (!source) {
      try {
        const sitesRes = await api.getSites();
        const allSites: StorySite[] = (Array.isArray(sitesRes.data) ? sitesRes.data : [])
          .map(toStorySite)
          .filter((s): s is StorySite => Boolean(s));
        sites = Array.from(
          new globalThis.Map(
            [...sites, ...allSites].map((s) => [s.siteId.toUpperCase(), s])
          ).values()
        );
        source = resolveSourceFrom(sites);
      } catch {
        // best-effort fallback; keep existing map pool
      }
    }

    if (!source) {
      const fallbackPool = sites.length > 0 ? sites : mapSites;
      const avgLat =
        fallbackPool.length > 0
          ? fallbackPool.reduce((sum, s) => sum + s.latitude, 0) / fallbackPool.length
          : 37.7749;
      const avgLon =
        fallbackPool.length > 0
          ? fallbackPool.reduce((sum, s) => sum + s.longitude, 0) / fallbackPool.length
          : -122.4194;
      source = {
        siteId: normalizedSiteId,
        realSiteId: numericPart || normalizedSiteId,
        siteName: normalizedSiteId,
        latitude: avgLat,
        longitude: avgLon,
      };
      sites = [source, ...fallbackPool];
    }

    knownStorySitesRef.current[source.siteId.toUpperCase()] = source;
    if (source.realSiteId) {
      knownStorySitesRef.current[String(source.realSiteId).toUpperCase()] = source;
    }
    saveKnownSites();

    const rcaRes = await apiWithCache.getSiteRCA(source.realSiteId || source.siteId, dateId);
    const rca = rcaRes?.data || {};
    const textBlob = [
      String(rca.rcaBucket || ''),
      String(rca.shortSummary || ''),
      ...(Array.isArray(rca.intuitions) ? rca.intuitions.map((i: any) => `${i.name || ''} ${i.explanation || ''}`) : []),
    ].join(' ');
    const mentionedSiteIds = Array.from(new Set((textBlob.match(/SITE_[A-Z]\d{4}/g) || [])))
      .filter((id) => id !== source.siteId);

    const mentionedSites = mentionedSiteIds
      .map((id) => sites.find((s) => s.siteId === id))
      .filter((s): s is StorySite => Boolean(s));

    const topNeighbors = sites
      .filter((s) => s.siteId !== source.siteId)
      .map((s) => ({
        site: s,
        distance:
          Math.pow(s.latitude - source.latitude, 2) +
          Math.pow(s.longitude - source.longitude, 2),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 15)
      .map((x) => x.site);

    const relatedSites = (mentionedSites.length ? mentionedSites : topNeighbors).slice(0, 15);
    const lowerRca = String(rca.rcaBucket || '').toLowerCase();
    const outageNeighbor =
      lowerRca.includes('outage') ? relatedSites[0] || topNeighbors[0] : undefined;
    const topNeighborsWithFlags = topNeighbors.map((s) => ({
      ...s,
      isOutage: outageNeighbor?.siteId === s.siteId,
    }));
    const trafficCandidates = topNeighborsWithFlags.filter((s) => !s.isOutage).slice(0, 2);

    // Pick a randomized solution recommendation based on RCA category + closest neighbors
    const rcaBucketStr = String(rca.rcaBucket || '');
    const solutionRec = pickSolutionRec(rcaBucketStr, source, topNeighbors);

    // If solution recommendation has target neighbors, use them for traffic candidates (green lines)
    const finalTrafficCandidates = solutionRec?.targetNeighbors
      ? solutionRec.targetNeighbors
          .map((neighborId) => topNeighbors.find((s) => s.siteId === neighborId))
          .filter((s): s is StorySite => Boolean(s))
      : trafficCandidates;

    const followupContext: RcaFollowupContext = {
      sourceSite: source,
      relatedSites: topNeighborsWithFlags,
      outageNeighborSiteId: outageNeighbor?.siteId,
      dateId,
      rcaBucket: rcaBucketStr,
      shortSummary: String(rca.shortSummary || ''),
      trafficCandidates: finalTrafficCandidates,
      solutionRec,
    };
    rcaFollowupContextRef.current[source.siteId] = followupContext;
    saveRcaContext();

    return {
      sourceSite: source,
      relatedSites: topNeighborsWithFlags,
      topNeighbors: topNeighborsWithFlags,
      allSites: sites,
      trafficCandidates: finalTrafficCandidates,
      outageNeighborSiteId: outageNeighbor?.siteId,
      dateId,
      rcaBucket: rcaBucketStr,
      shortSummary: String(rca.shortSummary || 'No summary available'),
      intuitions: Array.isArray(rca.intuitions)
        ? rca.intuitions.map((i: any) => ({
            name: String(i.name || 'intuition'),
            applies: Boolean(i.applies),
            explanation: String(i.explanation || ''),
          }))
        : [],
      sourceSiteId: source.siteId,
      showRecommendations: Boolean(options?.showRecommendations),
      solutionRec,
    };
  };

  const pollOssExecutionStatus = async (requestId: string, messageId: string) => {
    let attempts = 0;
    const maxAttempts = 90;

    while (attempts < maxAttempts) {
      attempts += 1;
      await sleep(950);

      try {
        const latest = await api.getOssParameterChangeStatus(requestId);
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === messageId
              ? {
                  ...msg,
                  executionStatus: latest,
                  content:
                    latest.status === 'completed'
                      ? `**Control Agent** » OSS adapter confirmed the parameter update for ${latest.siteId}.`
                      : latest.status === 'queued'
                        ? `**Control Agent** » OSS adapter queued the change for ${latest.siteId}. Retrying automatically...`
                        : latest.status === 'failed'
                          ? `**Control Agent** » OSS adapter encountered a transient error on ${latest.siteId}. Retrying automatically...`
                          : '**Control Agent** » Executing OSS adapter handshake and parameter update workflow...',
                }
              : msg
          )
        );

        if (latest.status === 'completed') return;

        if (latest.status === 'failed' || latest.status === 'queued') {
          await sleep(2000);
          try {
            await api.retryOssParameterChange(requestId);
          } catch {
            // Retry API failed — continue polling, it will resolve
          }
          continue;
        }
      } catch {
        return;
      }
    }
  };

  // ── Dashboard intent helpers ─────────────────────────────────────────────────

  /** Parse "create a dashboard for site 9817 ending 2026-04-07 hourly" */
  const parseDashboardIntent = (q: string): {
    siteId: string | null;
    endDate: string | null;
    timeframe: 'daily' | 'hourly';
    kpiNames: string[];
    daysBack: number;
  } | null => {
    const lower = q.toLowerCase();
    // Match: "dashboard", explicit "create/plot/show KPI chart/dashboard", or "show me <anything> KPIs for <site>"
    const isDashboard = /(dashboard|create.*chart|plot.*kpi|kpi.*dashboard|generate.*dashboard|show.*kpi.*chart)/i.test(lower);
    // "Show me KPIs for 9817" / "Show me Throughput KPIs for 9817" / "Show KPI for 9817"
    const isShowKpi = /\b(show|plot|give me|display)\b.*\bkpi/i.test(lower) && /\b\d{4,8}\b/.test(q);
    if (!isDashboard && !isShowKpi) return null;

    // Site ID
    const siteId =
      q.match(/\bUST0*(\d{4,8})\b/i)?.[1] ??
      q.match(/\bsite\s*[:#]?\s*(\d{4,8})\b/i)?.[1] ??
      q.match(/\bfor\s+(\d{4,8})\b/i)?.[1] ??
      q.match(/\b(\d{4,8})\b/)?.[1] ??
      null;

    // End date — ISO (2026-04-07) or US (4/7/2026)
    const isoMatch = q.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/);
    const usMatch  = q.match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})\b/);
    let endDate: string | null = null;
    if (isoMatch) {
      endDate = `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
    } else if (usMatch) {
      const year = usMatch[3].length === 2 ? `20${usMatch[3]}` : usMatch[3];
      endDate = `${year}-${usMatch[1].padStart(2, '0')}-${usMatch[2].padStart(2, '0')}`;
    }

    // Timeframe
    const timeframe: 'daily' | 'hourly' = /\bhourly\b/i.test(lower) ? 'hourly' : 'daily';

    // Days back — match the dashboard's default of 30d for daily / 48h for hourly.
    const daysMatch = q.match(/\b(\d+)\s*(?:days?|d)\b/i);
    const daysBack = daysMatch
      ? Math.min(90, Math.max(1, parseInt(daysMatch[1], 10)))
      : (timeframe === 'hourly' ? 48 : 30);

    // Named KPIs — scan for exact name, label word, or KPI group name in query
    const kpiNames: string[] = [];

    // Group name matching: "Throughput KPIs" → all Throughput group KPIs
    const KPI_GROUP_NAMES: Record<string, string> = {
      throughput: 'Throughput', accessibility: 'Accessibility', utilization: 'Utilization',
      quality: 'Quality', availability: 'Availability',
    };
    const matchedGroups = new Set<string>();
    for (const [keyword, groupName] of Object.entries(KPI_GROUP_NAMES)) {
      if (lower.includes(keyword)) matchedGroups.add(groupName);
    }

    for (const kpi of ALL_STANDARD_KPIS) {
      // Exact KPI name in query
      const namePattern = kpi.name.replace(/_/g, '[_\\s-]?');
      const matchesName = new RegExp(`\\b${namePattern}\\b`, 'i').test(q);
      // Label word match (word > 4 chars)
      const matchesLabel = kpi.label.toLowerCase().split(' ').some((w) => w.length > 4 && lower.includes(w));
      // Group match
      const groupName = STANDARD_KPI_GROUPS.find((g) => g.kpis.some((k) => k.name === kpi.name))?.group ?? '';
      const matchesGroup = matchedGroups.has(groupName);

      if (matchesName || matchesLabel || matchesGroup) {
        kpiNames.push(kpi.name);
      }
    }

    return { siteId, endDate, timeframe, kpiNames, daysBack };
  };

  /** Get list of unrecognised KPI-like words the user typed to confirm spelling */
  const extractUnknownKpiTerms = (q: string): string[] => {
    const lower = q.toLowerCase();
    const kpiPattern = /\b([A-Z][A-Z0-9_]{3,})\b/g;
    const found: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = kpiPattern.exec(q)) !== null) {
      const name = m[1];
      if (!KPI_MAP[name]) found.push(name);
    }
    return found;
  };

  const buildObservabilityNarrative = async (query: string, summary: Record<string, any>) => {
    try {
      const prompt =
        `User asked: "${query}". ` +
        `Observability summary: totalSites=${summary.totalSites ?? 0}, ` +
        `outageSites=${summary.outageSites ?? 0}, congestedSites=${summary.congestedSites ?? 0}, affectedCells=${summary.affectedCells ?? 0}. ` +
        `Respond in 2 concise sentences: key finding + next best step.`;
      const response = await api.askTelecomQuestion(prompt, 'observability_companion');
      const answer = String(response.answer || '').trim();
      if (!answer) return null;
      const lower = answer.toLowerCase();
      if (
        lower.includes("couldn't find relevant information") ||
        lower.includes('try rephrasing') ||
        lower.includes('knowledge base')
      ) {
        return null;
      }
      return answer;
    } catch {
      return null;
    }
  };

  const buildObservabilityFallbackText = (summary: Record<string, any>) => {
    const outageCount = Number(summary.outageSites ?? 0);
    const congestedCount = Number(summary.congestedSites ?? 0);
    const total = Number(summary.totalSites ?? 0);
    const date = summary.reportDate ? ` for ${summary.reportDate}` : '';
    const degraded = outageCount + congestedCount;

    if (degraded > 0) {
      return `Here is a map of the network offenders${date}. ${degraded} degraded sites are highlighted across ${total} total sites.`;
    }
    return `Here is a map of current network status${date}. ${total} sites are in scope, with no major degraded offenders detected in this slice.`;
  };

  const requestOssChangeConfirmation = async (query: string, changeIntent: { siteId: string; parameter: string; value: string; unit?: string }) => {
    const requestId = `oss_${Date.now()}`;
    const confirmId = `oss_confirm_${requestId}`;
    const cancelId = `oss_cancel_${requestId}`;

    pendingOssChangesRef.current[requestId] = {
      ...changeIntent,
      sourceQuery: query,
    };

    const valueWithUnit = changeIntent.unit ? `${changeIntent.value} ${changeIntent.unit}` : changeIntent.value;
    const assistantMessage: ChatMessage = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content:
        `Review network change request:\n` +
        `Site: ${changeIntent.siteId}\n` +
        `Parameter: ${changeIntent.parameter}\n` +
        `Target value: ${valueWithUnit}\n\n` +
        `This will trigger OSS adapter execution. Please confirm to proceed.`,
      timestamp: new Date(),
      choiceButtons: [
        { label: 'Confirm Change', choiceId: confirmId },
        { label: 'Cancel', choiceId: cancelId },
      ],
    };
    setMessages((prev) => [...prev, assistantMessage]);
    setFeedback('success');
  };

  const startConfirmedOssChange = async (requestKey: string) => {
    await sleep(CHOICE_THINKING_MS);
    setIsLoading(false);
    const pending = pendingOssChangesRef.current[requestKey];
    if (!pending) {
      const msg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'This change request is no longer available. Please submit the change intent again.',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, msg]);
      return;
    }

    delete pendingOssChangesRef.current[requestKey];

    const executionStatus = await api.startOssParameterChange({
      siteId: pending.siteId,
      parameter: pending.parameter,
      value: pending.value,
      unit: pending.unit,
      intentText: pending.sourceQuery,
    });

    const executionMessageId = (Date.now() + 1).toString();
    const assistantMessage: ChatMessage = {
      id: executionMessageId,
      role: 'assistant',
      content: '**Control Agent** » Executing OSS adapter handshake and parameter update workflow...',
      timestamp: new Date(),
      executionStatus,
      choiceButtons: [{ label: 'Open Naavik Provision', choiceId: NAV_CHOICE_IDS.PROVISION }],
    };
    setMessages((prev) => [...prev, assistantMessage]);
    setFeedback('success');
    void pollOssExecutionStatus(executionStatus.executionId, executionMessageId);
  };

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    const container = scrollContainerRef.current;
    if (container) {
      // Scroll the chat's own container — never bubble up to ancestors, which
      // would otherwise nudge the fixed input bar out of place.
      container.scrollTo({ top: container.scrollHeight, behavior });
    } else {
      // Fallback: nearest-block so we don't scroll the viewport either.
      messagesEndRef.current?.scrollIntoView({ behavior, block: 'nearest' });
    }
  };

  // Track whether the user is pinned to the bottom. If they scroll up to read
  // history we must NOT yank them back down when new content streams in.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const onScroll = () => {
      const threshold = 80; // px from bottom counts as "pinned"
      const atBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight <= threshold;
      scrollPinnedRef.current = atBottom;
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!messages.length) return;
    const container = scrollContainerRef.current;
    const lastMessage = messages[messages.length - 1];

    // When the assistant emits a tall payload (dashboard, diagnosis card,
    // multi-tab report, grid, long RCA story), anchor the scroll on the TOP
    // of that message so the header / filters land at the chat viewport top
    // and the user reads downward.
    const anchorTall = () => {
      const el = lastAnswerRef.current;
      if (!el || !container) return false;
      const containerRect = container.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const delta = elRect.top - containerRect.top;
      // Small top inset so the message has a little breathing room above it.
      const TOP_INSET = 12;
      container.scrollTo({
        top: Math.max(0, container.scrollTop + delta - TOP_INSET),
        behavior: 'auto',
      });
      // The user is no longer pinned to the absolute bottom, so the
      // ResizeObserver below won't override us when the dashboard fetches
      // data and grows in height.
      scrollPinnedRef.current = false;
      return true;
    };

    if (isTallAssistantMessage(lastMessage)) {
      // First pass — immediate jump so the dashboard doesn't appear off-screen.
      const first = anchorTall();
      // Second pass — after the dashboard's data fetch resolves the card
      // grows in height; re-anchor so its top stays at the viewport top.
      const re1 = setTimeout(() => anchorTall(), 200);
      const re2 = setTimeout(() => anchorTall(), 700);
      const re3 = setTimeout(() => anchorTall(), 1500);
      // If the ref wasn't ready yet, retry on the next paint.
      if (!first) {
        requestAnimationFrame(() => anchorTall());
      }
      return () => {
        clearTimeout(re1);
        clearTimeout(re2);
        clearTimeout(re3);
      };
    }

    // Default: scroll to the true bottom for normal/text messages. Two passes:
    // - an immediate jump so the user sees the assistant chrome appear,
    // - a deferred smooth pass once any inline media paints.
    scrollToBottom('auto');
    const delayMs = 120;
    const timer = setTimeout(() => scrollToBottom('smooth'), delayMs);
    return () => clearTimeout(timer);
  }, [messages, isLoading]);

  // Keep the view pinned to the bottom as the last message's DOM grows
  // (async RCA payloads, lazy images, etc.). ResizeObserver on the scroll
  // container catches those post-mount layout shifts.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (!scrollPinnedRef.current) return;
      container.scrollTop = container.scrollHeight;
    });
    ro.observe(container);
    // Observe the inner content wrapper too so growth in its height triggers.
    const inner = container.firstElementChild;
    if (inner) ro.observe(inner as Element);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenuOpen(false);
      }
    };
    if (contextMenuOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [contextMenuOpen]);

  const runIntent = async (query: string, options?: { overrideStream?: ChatStream; attachments?: PendingAttachment[] }) => {
    const attachmentsPayload: ChatAttachment[] | undefined = options?.attachments?.length
      ? options.attachments.map(({ id: _id, ...rest }) => rest)
      : undefined;
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: query,
      timestamp: new Date(),
      attachments: attachmentsPayload,
    };
    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);
    setFeedback(null);
    if (feedbackTimeoutRef.current) {
      clearTimeout(feedbackTimeoutRef.current);
      feedbackTimeoutRef.current = null;
    }

    // Demo-mode: the displayed userMessage preserves the UST###### tokens the
    // user typed, but every downstream backend call uses the real USIDs. This
    // is a no-op when dummifier is disabled.
    query = unmapText(query);

    const startTime = Date.now();
    const MIN_THINKING_MS = 600;
    const ensureMinThinkingTime = async () => {
      const elapsed = Date.now() - startTime;
      if (elapsed < MIN_THINKING_MS) {
        await new Promise((r) => setTimeout(r, MIN_THINKING_MS - elapsed));
      }
    };

    try {
      const lower = query.toLowerCase();
	      const stream = options?.overrideStream ?? activeStream;

      if (onNavigate) {
        const navResolution = resolveNavigationIntent({
          query,
          recentMessages: messages.slice(-5),
          currentView,
          registry,
        });

        if (navResolution) {
          await ensureMinThinkingTime();
          const ackMessage: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: navResolution.acknowledgmentText,
            timestamp: new Date(),
          };
          setMessages((prev) => [...prev, ackMessage]);
          setIsLoading(false);
          onNavigate(navResolution.targetView);
          return;
        }
      }

      const recentHistory = messages.slice(-6).map((m) => ({
        role: m.role,
        content: m.visualization?.type === 'rca_story'
          ? `[RCA Map Story for site ${m.visualization?.data?.sourceSite?.siteId || 'unknown'}]`
          : m.content.slice(0, 300),
      }));

      // --- Context-aware intent boosting ---
      // If the last assistant message was an RCA story, follow-up questions
      // about solutions/fixes/remediation should resolve automatically using
      // the site from that RCA context instead of asking for a site ID.
      const lastRcaSiteId = (() => {
        const contextSiteIds = Object.keys(rcaFollowupContextRef.current);
        return contextSiteIds.length > 0 ? contextSiteIds[contextSiteIds.length - 1] : null;
      })();

      const CONTEXTUAL_SOLUTION_TRIGGERS = [
        'solution', 'fix', 'remediat', 'resolve', 'mitigat', 'what should',
        'what do we do', 'what to do', 'next step', 'next action', 'recommend',
        'suggestion', 'corrective', 'how to fix', 'how do we', 'what can we',
        'any action', 'address this', 'handle this', 'deal with this',
      ];
      const CONTEXTUAL_ESCALATE_TRIGGERS = [
        'escalat', 'ticket', 'incident', 'raise', 'p1', 'noc', 'alarm', 'fault',
      ];
      const CONTEXTUAL_IMPLEMENT_TRIGGERS = [
        'implement', 'apply', 'execute', 'push', 'deploy', 'go ahead',
        'proceed', 'activate', 'enact', 'carry out', 'make the change',
        'do the change', 'trigger change',
      ];

      if (lastRcaSiteId) {
        const matchesSolution = CONTEXTUAL_SOLUTION_TRIGGERS.some((t) => lower.includes(t));
        const matchesEscalate = CONTEXTUAL_ESCALATE_TRIGGERS.some((t) => lower.includes(t));
        const matchesImplement = CONTEXTUAL_IMPLEMENT_TRIGGERS.some((t) => lower.includes(t));

        if (matchesEscalate && !matchesSolution && !matchesImplement) {
          const ctx = rcaFollowupContextRef.current[lastRcaSiteId];
          await ensureMinThinkingTime();
          const neighborSiteId = ctx?.outageNeighborSiteId || 'SITE_UNKNOWN';
          const ticketId = `TT-${Date.now().toString().slice(-7)}`;
          const comment = `Escalated due to sustained degradation impact on ${lastRcaSiteId}. Outage-neighbor correlation observed at ${neighborSiteId}, with congestion risk in serving area. Requested urgent transport/backhaul review and service restoration.`;
          const assistantMessage: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: `**Network Ops Agent** » Ticket escalation has been submitted for ${neighborSiteId}.`,
            timestamp: new Date(),
            visualization: {
              type: 'ticket_escalation',
              data: {
                impactedSite: lastRcaSiteId,
                outageNeighbor: neighborSiteId,
                ticketId,
                previousStatus: 'Monitoring (P4)',
                newStatus: 'Escalated (P1)',
                escalationComment: comment,
                updatedAt: new Date().toLocaleString(),
              },
            },
          };
          setMessages((prev) => [...prev, assistantMessage]);
          setFeedback('success');
          setIsLoading(false);
          return;
        }

        if (matchesImplement && !matchesSolution && !matchesEscalate) {
          const ctx = rcaFollowupContextRef.current[lastRcaSiteId];
          if (ctx) {
            pendingTrafficBalanceRef.current = null;
            const rec = ctx.solutionRec;
            const executionStatus = await api.startOssParameterChange({
              siteId: rec?.targetSiteId || ctx.sourceSite.siteId,
              parameter: rec?.parameter || 'cellIndividualOffset',
              value: rec?.value ?? 2,
              unit: rec?.unit || 'dB',
              intentText: rec?.description || `Apply traffic balancing on ${ctx.sourceSite.siteId}`,
            });
            await ensureMinThinkingTime();
            const executionMessageId = (Date.now() + 1).toString();
            const assistantMessage: ChatMessage = {
              id: executionMessageId,
              role: 'assistant',
              content: `**Control Agent** » Executing OSS adapter: **${rec?.technique || 'Parameter Change'}** — set \`${rec?.parameter || 'cellIndividualOffset'}\` to ${rec?.value ?? 2} ${rec?.unit || 'dB'} on ${rec?.targetSiteId || ctx.sourceSite.siteId}...`,
              timestamp: new Date(),
              executionStatus,
              choiceButtons: [{ label: 'Open Naavik Provision', choiceId: NAV_CHOICE_IDS.PROVISION }],
            };
            setMessages((prev) => [...prev, assistantMessage]);
            setFeedback('success');
            setIsLoading(false);
            void pollOssExecutionStatus(executionStatus.executionId, executionMessageId);
            return;
          }
        }

        if (matchesSolution) {
          const ctx = rcaFollowupContextRef.current[lastRcaSiteId];
          const story = await fetchRcaStory(lastRcaSiteId, ctx?.dateId || latestOffenderDate, {
            showRecommendations: true,
          });
          await ensureMinThinkingTime();
          const assistantMessage: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: '',
            timestamp: new Date(),
            visualization: { type: 'rca_story', data: story },
            choiceButtons: [
              { label: 'Implement Change', choiceId: `rca_balance_apply_${lastRcaSiteId}` },
              ...(story.outageNeighborSiteId ? [{ label: 'Escalate outage ticket', choiceId: `rca_escalate_${lastRcaSiteId}` }] : []),
              { label: 'Automate Solution via AppGen', choiceId: `rca_appgen_${lastRcaSiteId}` },
              { label: 'No further action', choiceId: `rca_no_action_${lastRcaSiteId}` },
            ],
          };
          setMessages((prev) => [...prev, assistantMessage]);
          setFeedback('success');
          setIsLoading(false);
          return;
        }
      }
      // --- End context-aware intent boosting ---

      const hasActiveAppGenSession = Boolean(appgenThreadIdRef.current);
      const looksLikeAppGenFollowup =
        lower.includes('authorize build') ||
        lower.includes('build now') ||
        lower.includes('generate app') ||
        lower.includes('generate code') ||
        lower.includes('refine input') ||
        lower.includes('edit kpi') ||
        lower.includes('edit parameter') ||
        lower.includes('edit action') ||
        lower.includes('edit scope') ||
        lower.includes('add kpi condition') ||
        lower.includes('continue app');
      const looksLikeExplicitNonAppGen =
        lower.includes('observe') ||
        lower.includes('map') ||
        lower.includes('offender') ||
        lower.includes('rca') ||
        lower.includes('outage') ||
        lower.includes('provision') ||
        lower.includes('ticket') ||
        lower.includes('alarm') ||
        lower.includes('telco library') ||
        lower.includes('knowledge');
      const useAppGenEarly =
        stream === 'appgen' ||
        (hasActiveAppGenSession && !looksLikeExplicitNonAppGen) ||
        looksLikeAppGenFollowup ||
        lower.includes('build') ||
        lower.includes('generate app') ||
        lower.includes('generate code') ||
        lower.includes('create app') ||
        lower.includes('build an app') ||
        (lower.includes('increase') && lower.includes('when')) ||
        (lower.includes('change') && lower.includes('when'));
      
      // Check for navigation commands first
      if (onNavigate) {
        const explicitNavToAppGen =
          lower.includes('open appgen') ||
          lower.includes('open app gen') ||
          lower.includes('go to appgen') ||
          lower.includes('go to app gen') ||
          lower.includes('open appgen') ||
          lower.includes('open app store');
        const explicitNavToProvision =
          lower.includes('open provision') ||
          lower.includes('open provisioning') ||
          lower.includes('go to provision') ||
          lower.includes('go to provisioning');
        const explicitNavToObserve =
          lower.includes('open observe') ||
          lower.includes('go to observe') ||
          lower.includes('open map view') ||
          lower.includes('open observability');
        const explicitNavToSettings =
          lower.includes('open settings') ||
          lower.includes('go to settings');

        if (explicitNavToAppGen) {
          await ensureMinThinkingTime();
          setIsLoading(false);
          const assistantMessage: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: 'I can handle Naavik AppGen here in chat. If you want the full visual workspace, open Naavik AppGen.',
            timestamp: new Date(),
            choiceButtons: [{ label: 'Open Naavik AppGen', choiceId: NAV_CHOICE_IDS.APPGEN }],
          };
          setMessages((prev) => [...prev, assistantMessage]);
          setFeedback('success');
          feedbackTimeoutRef.current = setTimeout(() => setFeedback(null), 6000);
          return;
        }
        
        if (explicitNavToProvision) {
          await ensureMinThinkingTime();
          setIsLoading(false);
          const assistantMessage: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: 'I can run provisioning workflows from chat. Open Naavik Provision page only when you want the full site queue UI.',
            timestamp: new Date(),
            choiceButtons: [{ label: 'Open Naavik Provision', choiceId: NAV_CHOICE_IDS.PROVISION }],
          };
          setMessages((prev) => [...prev, assistantMessage]);
          setFeedback('success');
          feedbackTimeoutRef.current = setTimeout(() => setFeedback(null), 6000);
          return;
        }
        
        if (explicitNavToObserve) {
          await ensureMinThinkingTime();
          setIsLoading(false);
          const assistantMessage: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: 'I can answer map and network questions here. Open Naavik Observe when you want map-first visual exploration.',
            timestamp: new Date(),
            choiceButtons: [{ label: 'Open Naavik Observe', choiceId: NAV_CHOICE_IDS.OBSERVE }],
          };
          setMessages((prev) => [...prev, assistantMessage]);
          setFeedback('success');
          feedbackTimeoutRef.current = setTimeout(() => setFeedback(null), 6000);
          return;
        }
        
        if (explicitNavToSettings) {
          await ensureMinThinkingTime();
          setIsLoading(false);
          const assistantMessage: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: 'Open Settings when you need account or environment controls.',
            timestamp: new Date(),
            choiceButtons: [{ label: 'Open Settings', choiceId: NAV_CHOICE_IDS.SETTINGS }],
          };
          setMessages((prev) => [...prev, assistantMessage]);
          setFeedback('success');
          feedbackTimeoutRef.current = setTimeout(() => setFeedback(null), 6000);
          return;
        }

        // "build" intent → proactively offer navigation to AppGen.
        // Whole-word match so "building" / "rebuild" don't trigger it.
        // Skip if the user is already on AppGen or mid-AppGen session — they've
        // clearly chosen to stay in chat for the build flow.
        const mentionsBuild = /\bbuild\b/i.test(query);
        const alreadyOnAppGen = currentView === 'appgen';
        if (mentionsBuild && !alreadyOnAppGen && !hasActiveAppGenSession) {
          await ensureMinThinkingTime();
          setIsLoading(false);
          const assistantMessage: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: 'Sounds like you want to build something. Naavik AppGen is the visual workspace for creating apps, rApps, and automations. Want me to take you there?',
            timestamp: new Date(),
            choiceButtons: [
              { label: 'Take me to AppGen', choiceId: NAV_CHOICE_IDS.APPGEN },
              { label: 'Stay in chat', choiceId: 'build_stay_in_chat' },
            ],
          };
          setMessages((prev) => [...prev, assistantMessage]);
          setFeedback('success');
          feedbackTimeoutRef.current = setTimeout(() => setFeedback(null), 6000);
          return;
        }
      }

      // Generic "I want to build / go to AppGen / provision" with no active session → just navigate
      if (useAppGenEarly && !hasActiveAppGenSession && !looksLikeAppGenFollowup && onNavigate) {
        const isGenericBuildIntent =
          /^(i want to build|build an app|i want to create an app|open appgen|go to appgen|take me to appgen|appgen|let'?s? build|create an app)/i.test(query.trim());
        const isProvisionIntent =
          /^(i want to provision|go to provision|open provision|take me to provision|provision)/i.test(query.trim());
        if (isGenericBuildIntent) {
          await ensureMinThinkingTime();
          setIsLoading(false);
          onNavigate('appgen');
          setMessages((prev) => [...prev, {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: 'Opening **Naavik AppGen** — describe your automation workflow there to get started.',
            timestamp: new Date(),
          } as ChatMessage]);
          setFeedback('success');
          feedbackTimeoutRef.current = setTimeout(() => setFeedback(null), 4000);
          return;
        }
        if (isProvisionIntent) {
          await ensureMinThinkingTime();
          setIsLoading(false);
          onNavigate('provision');
          setMessages((prev) => [...prev, {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: 'Opening **Naavik Provision** — manage your site provisioning queue there.',
            timestamp: new Date(),
          } as ChatMessage]);
          setFeedback('success');
          feedbackTimeoutRef.current = setTimeout(() => setFeedback(null), 4000);
          return;
        }
      }

      if (useAppGenEarly) {
        try {
          // If user already authorized in-thread and asks to build/generate now, run generation directly.
          if (
            hasActiveAppGenSession &&
            /(authorize build|build now|generate (the )?(app|code)|proceed|go ahead)/i.test(query)
          ) {
            const activeThreadId = appgenThreadIdRef.current;
            if (activeThreadId) {
              const authorizationToken = appgenAuthTokenRef.current[activeThreadId];
              if (authorizationToken) {
                const generated = await api.appgenAgentV1Generate(activeThreadId, authorizationToken);
                await ensureMinThinkingTime();
                setIsLoading(false);
                const data = generated.data || {};
                const code = String(data.eiapCode || '');
                lastGeneratedCodeRef.current = code;
                const savedAppName = conversationContext.appBuilderAppName || `rApp_${Date.now().toString().slice(-6)}`;
                if (code) {
                  api.createAutomationApp({
                    appName: savedAppName,
                    generatedCode: code,
                    description: `Auto-saved rApp from AppGen build`,
                    status: 'validated',
                  }).then(() => {
                    window.dispatchEvent(new CustomEvent('applet-saved'));
                  }).catch(() => {});
                }
                const doneMessage: ChatMessage = {
                  id: (Date.now() + 1).toString(),
                  role: 'assistant',
                  content: `**AppGen Agent** » Build completed and saved as **${savedAppName}** in Naavik AppGen. Review generated code below.`,
                  timestamp: new Date(),
                  visualization: code ? { type: 'code', data: code } : undefined,
                  choiceButtons: [
                    { label: 'Package as rApp', choiceId: 'appgen_package_rapp' },
                    { label: 'Save as Applet', choiceId: 'appgen_save_applet' },
                    { label: 'Open Naavik AppGen', choiceId: NAV_CHOICE_IDS.APPGEN },
                  ],
                };
                setMessages((prev) => [...prev, doneMessage]);
                setFeedback('success');
                feedbackTimeoutRef.current = setTimeout(() => setFeedback(null), 6000);
                return;
              }
            }
          }

          const startFreshBuild =
            stream !== 'appgen' &&
            /(build|create|start|generate).*(app|rapp|automation)/i.test(query) &&
            !/(continue|resume|refine|update|add condition)/i.test(query);
          const targetThreadId = startFreshBuild ? undefined : appgenThreadIdRef.current;
          if (startFreshBuild) {
            appgenThreadIdRef.current = undefined;
          }
          const result = await api.appgenAgentV1Chat(
            query,
            targetThreadId,
            stream === 'appgen' ? 'appgen_chat' : 'home_build'
          );
          await ensureMinThinkingTime();
          setIsLoading(false);
          if (result.success && result.data) {
            appendAppGenAgentMessage(result.data);
            setFeedback('success');
            feedbackTimeoutRef.current = setTimeout(() => setFeedback(null), 6000);
            return;
          }
          throw new Error('Unified AppGen agent returned an empty response.');
        } catch (error: any) {
          await ensureMinThinkingTime();
          setIsLoading(false);
          const assistantMessage: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: error?.message || 'Unable to start AppGen agent. Please restart backend and retry.',
            timestamp: new Date(),
          };
          setMessages((prev) => [...prev, assistantMessage]);
          setFeedback('error');
          feedbackTimeoutRef.current = setTimeout(() => setFeedback(null), 6000);
          return;
        }
      }

      // ── Saved dashboards list intent ──────────────────────────────────────
      if (/\b(my dashboards?|saved dashboards?|show dashboards?|open dashboards?|list dashboards?|view dashboards?)\b/i.test(lower)) {
        await ensureMinThinkingTime();
        setMessages((prev) => [...prev, {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: '**Observation Agent** » Here are your saved dashboards:',
          timestamp: new Date(),
          visualization: { type: 'saved_dashboards', data: {} },
        } as ChatMessage]);
        setFeedback('success');
        setIsLoading(false);
        return;
      }

      // ── KPI Dashboard intent (before agentic fallback) ───────────────────
      const _reportDateForDashboard = extractReportDateFromQuery(query);
      const dashboardIntent = parseDashboardIntent(query);
      if (dashboardIntent) {
        const { siteId, endDate, timeframe, kpiNames, daysBack } = dashboardIntent;

        if (!siteId) {
          await ensureMinThinkingTime();
          setMessages((prev) => [...prev, {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: 'Which site/USID should I create the dashboard for? (e.g. *Create a dashboard for site 9817 ending 2026-04-07*)',
            timestamp: new Date(),
          } as ChatMessage]);
          setFeedback('incomplete');
          setIsLoading(false);
          return;
        }

        const unknownTerms = extractUnknownKpiTerms(query);
        if (unknownTerms.length > 0 && kpiNames.length === 0) {
          const closest = ALL_STANDARD_KPIS.filter((k) =>
            unknownTerms.some((t) => k.name.toLowerCase().includes(t.toLowerCase()) || k.label.toLowerCase().includes(t.toLowerCase()))
          ).slice(0, 4);
          await ensureMinThinkingTime();
          const suggestions = closest.length > 0
            ? `\n\nDid you mean: ${closest.map((k) => `**${k.name}** (${k.label})`).join(', ')}?`
            : '\n\nAvailable KPIs: DL_TOTAL_DRB_THPUT, DATA_RAN_ACC, AVG_DL_PRB_UTIL, DL_PKTLOSS_RT…';
          setMessages((prev) => [...prev, {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: `I didn't recognise these KPI names: **${unknownTerms.join(', ')}**.${suggestions}\n\nShall I create the dashboard with **standard KPIs** instead?`,
            timestamp: new Date(),
            choiceButtons: [
              { label: `Standard KPIs for ${siteId}`, choiceId: `dashboard_standard_${siteId}_${endDate || _reportDateForDashboard || ''}_${timeframe}_${daysBack}` },
              ...closest.map((k) => ({ label: k.label, choiceId: `dashboard_kpi_${siteId}_${endDate || _reportDateForDashboard || ''}_${timeframe}_${daysBack}_${k.name}` })),
            ],
          } as ChatMessage]);
          setFeedback('incomplete');
          setIsLoading(false);
          return;
        }

        const resolvedEndDate = endDate || _reportDateForDashboard || undefined;
        const resolvedKpiNames = kpiNames.length > 0 ? kpiNames : [];
        await ensureMinThinkingTime();
        const kpiLabel = resolvedKpiNames.length > 0
          ? resolvedKpiNames.map((n) => KPI_MAP[n]?.label || n).join(', ')
          : 'standard KPIs';
        setMessages((prev) => [...prev, {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `**Observation Agent** » Dashboard for **${siteId}** · ${kpiLabel} · ${timeframe} · last ${daysBack} days`,
          timestamp: new Date(),
          visualization: {
            type: 'chat_kpi_dashboard',
            data: { siteId, endDate: resolvedEndDate, kpiNames: resolvedKpiNames, timeframe, daysBack },
          },
        } as ChatMessage]);
        setFeedback('success');
        setIsLoading(false);
        return;
      }

      // ── Purely agentic path ──────────────────────────────────────────────
      // All intents are handled by AgentOrchestrator on the backend.
      // V3 (true LLM tool-use loop) is opt-in via:
      //   localStorage.setItem('naavik:use-agent-v3', '1')
      // Otherwise V2 (intent-classified handlers) is used.
      let useV3 = true;
      try { useV3 = localStorage.getItem('naavik:use-agent-v3') !== '0'; } catch { /* SSR */ }

      let agentResponse: any;
      if (useV3) {
        const schemaCtx = schemaRef.current ? `\n${schemaRef.current}` : '';
        // SSE streaming path — default ON, disable with localStorage flag
        //   localStorage.setItem('naavik:use-agent-sse', '0')
        let useSse = true;
        try { useSse = localStorage.getItem('naavik:use-agent-sse') !== '0'; } catch { /* SSR */ }

        if (useSse) {
          // start() accumulates tokens/blocks/commands into local variables
          // and returns them directly — safe from stale-closure issues.
          const streamResult = await agentStream.start({
            threadId: sessionId,
            message: schemaCtx ? `${query}${schemaCtx}` : query,
            currentView: currentView || 'home',
          });
          const hasVisualBlocks = (streamResult.uiBlocks || []).length > 0;
          agentResponse = {
            threadId: sessionId,
            assistantMessage: streamResult.tokens
              || (streamResult.error ? `⚠ ${streamResult.error}` : null)
              || (hasVisualBlocks ? 'Analysis complete — see results below.' : "I completed the analysis but didn't produce a response. Try rephrasing your question."),
            intent: 'general',
            confidence: 1,
            uiCommands: streamResult.uiCommands || [],
            uiBlocks: streamResult.uiBlocks || [],
            handled: true,
          };
        } else {
          // Legacy atomic V3 path (no streaming)
          inflightControllerRef.current?.abort();
          const controller = new AbortController();
          inflightControllerRef.current = controller;
          const v3 = await api.agentV3Chat({
            threadId: sessionId,
            message: schemaCtx ? `${query}${schemaCtx}` : query,
            currentView: currentView || 'home',
            stream,
          }, { signal: controller.signal });
          if (inflightControllerRef.current === controller) inflightControllerRef.current = null;
          agentResponse = {
            threadId: v3.threadId,
            assistantMessage: v3.assistantMessage,
            intent: 'general',
            confidence: 1,
            uiCommands: v3.uiCommands || [],
            uiBlocks: v3.uiBlocks || [],
            handled: true,
          };
        }
      } else {
        agentResponse = await api.agentV2Chat({
          threadId: sessionId,
          message: query,
          stream,
          currentView: currentView || 'home',
          attachments: attachmentsPayload,
        });
      }
      await ensureMinThinkingTime();
      setIsLoading(false);
      appendAgentAssistantMessage(agentResponse);
      setFeedback('success');
      feedbackTimeoutRef.current = setTimeout(() => setFeedback(null), 6000);
      return;

      // Route by active stream/context – each stream has its own handler
      const layerFromQuery = resolveMapLayerFromQuery(query);
      const reportDate = extractReportDateFromQuery(query);
      const looksLikeMapCommand =
        lower.includes('show') ||
        lower.includes('load') ||
        lower.includes('display') ||
        lower.includes('plot') ||
        lower.includes('map');

      if (currentView === 'observe' && looksLikeMapCommand && (layerFromQuery || reportDate)) {
        if (reportDate) setSelectedDateId(reportDate);
        if (layerFromQuery) setActiveSiteLayer(layerFromQuery);

        await ensureMinThinkingTime();
        const layerLabel =
          layerFromQuery === 'degraded'
            ? 'Degraded Sites'
            : layerFromQuery === 'outage'
              ? 'Outage Sites'
              : layerFromQuery === 'overutilized'
                ? 'Overutilized Cells'
                : null;
        const applySummary = [
          reportDate ? `Date: ${reportDate}` : null,
          layerLabel ? `Layer: ${layerLabel}` : null,
        ]
          .filter(Boolean)
          .join(' | ');
        const assistantMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: applySummary
            ? `Applied to Naavik Observe map. ${applySummary}.`
            : 'Applied map filters in Naavik Observe.',
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, assistantMessage]);
        setFeedback('success');
        return;
      }

      if (pendingTrafficBalanceRef.current && /(implement change|proceed|yes|apply|go ahead)/i.test(lower)) {
        const ctx = pendingTrafficBalanceRef.current;
        pendingTrafficBalanceRef.current = null;
        const executionStatus = await api.startOssParameterChange({
          siteId: ctx.sourceSite.siteId,
          parameter: 'cellIndividualOffset',
          value: 2,
          unit: 'dB',
          intentText: `Apply traffic balancing on ${ctx.sourceSite.siteId} using selected neighbor relations`,
        });
        await ensureMinThinkingTime();
        const executionMessageId = (Date.now() + 1).toString();
        const assistantMessage: ChatMessage = {
          id: executionMessageId,
          role: 'assistant',
          content: `**Control Agent** » Executing OSS adapter change flow for traffic balancing on ${ctx.sourceSite.siteId}...`,
          timestamp: new Date(),
          executionStatus,
          choiceButtons: [{ label: 'Open Naavik Provision', choiceId: NAV_CHOICE_IDS.PROVISION }],
        };
        setMessages((prev) => [...prev, assistantMessage]);
        setFeedback('success');
        void pollOssExecutionStatus(executionStatus.executionId, executionMessageId);
        return;
      }

      if (stream === 'universal') {
        const ci = classifyIntent(query);
        const useTelecomKnowledge = ci.intent === 'knowledge_qa' || (
          ci.intent === 'unmatched' && (
            lower.includes("what is") ||
            lower.includes("explain") ||
            lower.includes("describe") ||
            lower.includes("tell me about") ||
            (lower.includes("parameter") && !lower.includes("change")) ||
            (lower.includes("kpi") && !lower.includes("show"))
          )
        );
        const useAppGen = ci.intent === 'appgen_create' || (
          ci.intent === 'unmatched' && (
            lower.includes("build") ||
            lower.includes("generate") ||
            lower.includes("create") ||
            (lower.includes("increase") && lower.includes("when")) ||
            (lower.includes("change") && lower.includes("when"))
          )
        );
        const useProvision = ci.intent === 'provision' || ci.intent === 'implement_change' || (
          ci.intent === 'unmatched' && (
            !!parseOssParameterIntent(query) ||
            (lower.includes('change') && lower.includes('site')) ||
            lower.includes('parameter change') ||
            lower.includes('oss')
          )
        );
        const useAutomation = ci.intent === 'unmatched' && (
          lower.includes("wrong") ||
          lower.includes("problem") ||
          lower.includes("what's wrong") ||
          lower.includes("network health") ||
          lower.includes("congested") ||
          lower.includes("outage") ||
          lower.includes("degraded") ||
          lower.includes("offender")
        );
        const useQuery = ci.intent === 'unmatched' && (
          lower.includes("show me") ||
          lower.includes("list") ||
          lower.includes("get") ||
          lower.includes("find") ||
          lower.includes("how many") ||
          lower.includes("count")
        );

        // KPI Request Handler
        if (ci.intent === 'kpi_request' && ci.metadata?.siteId) {
          const siteId = ci.metadata.siteId;
          await ensureMinThinkingTime();
          const assistantMessage: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: `Here's the KPI dashboard for site ${siteId}:`,
            timestamp: new Date(),
            visualization: {
              type: 'kpi_dashboard',
              data: { siteId },
            },
          };
          setMessages((prev) => [...prev, assistantMessage]);
          setFeedback('success');
          return;
        }

        // ── KPI Dashboard request ──────────────────────────────────────────────
        const dashboardIntent = parseDashboardIntent(query);
        if (dashboardIntent) {
          const { siteId, endDate, timeframe, kpiNames, daysBack } = dashboardIntent;

          if (!siteId) {
            await ensureMinThinkingTime();
            const msg: ChatMessage = {
              id: (Date.now() + 1).toString(),
              role: 'assistant',
              content: 'Which site/USID should I create the dashboard for? (e.g. *Create a dashboard for site 9817 ending 2026-04-07*)',
              timestamp: new Date(),
            };
            setMessages((prev) => [...prev, msg]);
            setFeedback('incomplete');
            setIsLoading(false);
            return;
          }

          const unknownTerms = extractUnknownKpiTerms(query);
          if (unknownTerms.length > 0 && kpiNames.length === 0) {
            const closest = ALL_STANDARD_KPIS.filter((k) =>
              unknownTerms.some((t) => k.name.toLowerCase().includes(t.toLowerCase()) || k.label.toLowerCase().includes(t.toLowerCase()))
            ).slice(0, 4);
            await ensureMinThinkingTime();
            const suggestions = closest.length > 0
              ? `\n\nDid you mean: ${closest.map((k) => `**${k.name}** (${k.label})`).join(', ')}?`
              : '\n\nAvailable KPIs: DL_TOTAL_DRB_THPUT, DATA_RAN_ACC, AVG_DL_PRB_UTIL, DL_PKTLOSS_RT…';
            const msg: ChatMessage = {
              id: (Date.now() + 1).toString(),
              role: 'assistant',
              content: `I didn't recognise these KPI names: **${unknownTerms.join(', ')}**.${suggestions}\n\nShall I create the dashboard with **standard KPIs** instead?`,
              timestamp: new Date(),
              choiceButtons: [
                { label: `Standard KPIs for ${siteId}`, choiceId: `dashboard_standard_${siteId}_${endDate || ''}_${timeframe}_${daysBack}` },
                ...closest.map((k) => ({ label: k.label, choiceId: `dashboard_kpi_${siteId}_${endDate || ''}_${timeframe}_${daysBack}_${k.name}` })),
              ],
            };
            setMessages((prev) => [...prev, msg]);
            setFeedback('incomplete');
            setIsLoading(false);
            return;
          }

          const resolvedEndDate = endDate || reportDate || undefined;
          const resolvedKpiNames = kpiNames.length > 0 ? kpiNames : [];
          await ensureMinThinkingTime();
          const kpiLabel = resolvedKpiNames.length > 0
            ? resolvedKpiNames.map((n) => KPI_MAP[n]?.label || n).join(', ')
            : 'standard KPIs';
          const dashMsg: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: `**Observation Agent** » Dashboard for **${siteId}** · ${kpiLabel} · ${timeframe} · last ${daysBack} days`,
            timestamp: new Date(),
            visualization: {
              type: 'chat_kpi_dashboard',
              data: { siteId, endDate: resolvedEndDate, kpiNames: resolvedKpiNames, timeframe, daysBack },
            },
          };
          setMessages((prev) => [...prev, dashMsg]);
          setFeedback('success');
          setIsLoading(false);
          return;
        }

        if (isWorstOffenderQuery(query)) {
          const dateId = reportDate || latestOffenderDate;
          const offenders = await fetchWorstOffendersTable(dateId);
          await ensureMinThinkingTime();
          const assistantMessage: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: `**Observation Agent** » Worst offenders for ${dateId}.`,
            timestamp: new Date(),
            visualization: {
              type: 'grid',
              data: {
                title: 'Worst Offenders',
                showSelection: false,
                rowTooltipField: '__shortSummaryTooltip',
                rows: offenders.rows.map((r) => ({
                  USID: r.siteId,
                  Date: dateId,
                  'Degraded KPI': r.degradedKpiCategory,
                  'CQX Value': r.rankingKpi,
                  'RCA Category': r.rca,
                  __shortSummaryTooltip: r.shortExplanation,
                  Site: r.siteId,
                  'Degraded KPI Category': r.degradedKpiCategory,
                  'Super KPI Value': r.rankingKpi,
                })),
              },
            },
            choiceButtons: [{ label: 'Open Naavik Observe', choiceId: NAV_CHOICE_IDS.OBSERVE }],
          };
          setMessages((prev) => [...prev, assistantMessage]);
          setFeedback('success');
        } else if (isRcaExplainQuery(query)) {
          const siteId = extractDummySiteId(query);
          if (!siteId) throw new Error('Please specify a site ID (e.g., site 47323).');
          const dateId = reportDate || latestOffenderDate;
          const includeRecommendations = shouldIncludeRecommendations(query);
          const story = await fetchRcaStory(siteId, dateId, {
            showRecommendations: includeRecommendations,
          });
          await ensureMinThinkingTime();
          const assistantMessage: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: '',
            timestamp: new Date(),
            visualization: { type: 'rca_story', data: story },
            choiceButtons: includeRecommendations
              ? [
                  { label: 'Implement Change', choiceId: `rca_balance_apply_${siteId}` },
                  ...(story.outageNeighborSiteId
                    ? [{ label: 'Escalate outage ticket', choiceId: `rca_escalate_${siteId}` }]
                    : []),
                  { label: 'Automate Solution via AppGen', choiceId: `rca_appgen_${siteId}` },
                  { label: 'No further action', choiceId: `rca_no_action_${siteId}` },
                ]
              : [
                  { label: 'Solution recommendation', choiceId: `rca_offer_${siteId}` },
                  { label: 'No further action', choiceId: `rca_no_action_${siteId}` },
                ],
          };
          setMessages((prev) => [...prev, assistantMessage]);
          setFeedback('success');
        } else if (ci.intent === 'solution_recommendation') {
          const contextSiteIds = Object.keys(rcaFollowupContextRef.current);
          const lastSiteId = contextSiteIds.length > 0 ? contextSiteIds[contextSiteIds.length - 1] : null;
          if (lastSiteId) {
            const ctx = rcaFollowupContextRef.current[lastSiteId];
            const story = await fetchRcaStory(lastSiteId, ctx?.dateId || reportDate || latestOffenderDate, {
              showRecommendations: true,
            });
            await ensureMinThinkingTime();
            const assistantMessage: ChatMessage = {
              id: (Date.now() + 1).toString(),
              role: 'assistant',
              content: '',
              timestamp: new Date(),
              visualization: { type: 'rca_story', data: story },
              choiceButtons: [
                { label: 'Implement Change', choiceId: `rca_balance_apply_${lastSiteId}` },
                ...(story.outageNeighborSiteId ? [{ label: 'Escalate outage ticket', choiceId: `rca_escalate_${lastSiteId}` }] : []),
                { label: 'Automate Solution via AppGen', choiceId: `rca_appgen_${lastSiteId}` },
                { label: 'No further action', choiceId: `rca_no_action_${lastSiteId}` },
              ],
            };
            setMessages((prev) => [...prev, assistantMessage]);
            setFeedback('success');
          } else {
            await ensureMinThinkingTime();
            const assistantMessage: ChatMessage = {
              id: (Date.now() + 1).toString(),
              role: 'assistant',
              content: '**Reasoning Agent** » No active RCA context found. Please first ask for the RCA of a specific site (e.g., "Explain the RCA at UST237369"), then I can provide a solution recommendation.',
              timestamp: new Date(),
            };
            setMessages((prev) => [...prev, assistantMessage]);
            setFeedback('incomplete');
          }
        } else if (ci.intent === 'escalate_ticket') {
          const contextSiteIds = Object.keys(rcaFollowupContextRef.current);
          const lastSiteId = contextSiteIds.length > 0 ? contextSiteIds[contextSiteIds.length - 1] : null;
          if (lastSiteId) {
            const ctx = rcaFollowupContextRef.current[lastSiteId];
            await ensureMinThinkingTime();
            const neighborSiteId = ctx?.outageNeighborSiteId || 'SITE_UNKNOWN';
            const ticketId = `TT-${Date.now().toString().slice(-7)}`;
            const comment = `Escalated due to sustained degradation impact on ${lastSiteId}. Outage-neighbor correlation observed at ${neighborSiteId}, with congestion risk in serving area. Requested urgent transport/backhaul review and service restoration.`;
            const assistantMessage: ChatMessage = {
              id: (Date.now() + 1).toString(),
              role: 'assistant',
              content: `**Network Ops Agent** » Ticket escalation has been submitted for ${neighborSiteId}.`,
              timestamp: new Date(),
              visualization: {
                type: 'ticket_escalation',
                data: {
                  impactedSite: lastSiteId,
                  outageNeighbor: neighborSiteId,
                  ticketId,
                  previousStatus: 'Monitoring (P4)',
                  newStatus: 'Escalated (P1)',
                  escalationComment: comment,
                  updatedAt: new Date().toLocaleString(),
                },
              },
            };
            setMessages((prev) => [...prev, assistantMessage]);
            setFeedback('success');
          } else {
            await ensureMinThinkingTime();
            const assistantMessage: ChatMessage = {
              id: (Date.now() + 1).toString(),
              role: 'assistant',
              content: '**Network Ops Agent** » No active RCA context found. Please first explain the RCA of a specific site, then I can escalate a ticket.',
              timestamp: new Date(),
            };
            setMessages((prev) => [...prev, assistantMessage]);
            setFeedback('incomplete');
          }
        } else if (ci.intent === 'implement_change') {
          const contextSiteIds = Object.keys(rcaFollowupContextRef.current);
          const lastSiteId = contextSiteIds.length > 0 ? contextSiteIds[contextSiteIds.length - 1] : null;
          if (lastSiteId) {
            const ctx = rcaFollowupContextRef.current[lastSiteId];
            if (ctx) {
              pendingTrafficBalanceRef.current = null;
              const executionStatus = await api.startOssParameterChange({
                siteId: ctx.sourceSite.siteId,
                parameter: 'cellIndividualOffset',
                value: 2,
                unit: 'dB',
                intentText: `Apply traffic balancing on ${ctx.sourceSite.siteId} using selected neighbor relations`,
              });
              await ensureMinThinkingTime();
              const executionMessageId = (Date.now() + 1).toString();
              const assistantMessage: ChatMessage = {
                id: executionMessageId,
                role: 'assistant',
                content: `**Control Agent** » Executing OSS adapter change flow for traffic balancing on ${ctx.sourceSite.siteId}...`,
                timestamp: new Date(),
                executionStatus,
                choiceButtons: [{ label: 'Open Naavik Provision', choiceId: NAV_CHOICE_IDS.PROVISION }],
              };
              setMessages((prev) => [...prev, assistantMessage]);
              setFeedback('success');
              void pollOssExecutionStatus(executionStatus.executionId, executionMessageId);
            }
          } else {
            await ensureMinThinkingTime();
            const assistantMessage: ChatMessage = {
              id: (Date.now() + 1).toString(),
              role: 'assistant',
              content: '**Control Agent** » No active RCA context found. Please first explain the RCA and get a solution recommendation, then I can implement the parameter change.',
              timestamp: new Date(),
            };
            setMessages((prev) => [...prev, assistantMessage]);
            setFeedback('incomplete');
          }
        } else if (useTelecomKnowledge) {
          try {
            const response = await api.askTelecomQuestion(query, 'universal', recentHistory);
            await ensureMinThinkingTime();
            const assistantMessage: ChatMessage = {
              id: (Date.now() + 1).toString(),
              role: 'assistant',
              content: response.answer,
              timestamp: new Date(),
            };
            if (response.sources && response.sources.length > 0) {
              const sourcesText = response.sources.slice(0, 3).map((s: any, idx: number) => `${idx + 1}. ${s.name} (${s.type})`).join('\n');
              assistantMessage.content += `\n\n**Sources:**\n${sourcesText}`;
            }
            setMessages((prev) => [...prev, assistantMessage]);
            setFeedback('success');
          } catch (error: any) { throw error; }
        } else if (useProvision) {
          const changeIntent = parseOssParameterIntent(query);
          if (changeIntent) {
            await ensureMinThinkingTime();
            await requestOssChangeConfirmation(query, changeIntent);
          } else {
            const response = await api.executeIntent(query, 'provision');
            await ensureMinThinkingTime();
            const assistantMessage: ChatMessage = {
              id: (Date.now() + 1).toString(),
              role: 'assistant',
              content: response.response || 'Taking you to Provisioning. Describe the parameter changes or site provisioning you need.',
              timestamp: new Date(),
              intent: response.parsedIntent,
              workflow: response.workflow,
            };
            setMessages((prev) => [...prev, assistantMessage]);
            setFeedback('success');
          }
        } else if (useAppGen) {
          try {
            const startFreshBuild =
              /(build|create|start|generate).*(app|rapp|automation)/i.test(query) &&
              !/(continue|resume|refine|update|add condition)/i.test(query);
            const targetThreadId = startFreshBuild ? undefined : appgenThreadIdRef.current;
            if (startFreshBuild) {
              appgenThreadIdRef.current = undefined;
            }
            const result = await api.appgenAgentV1Chat(
              query,
              targetThreadId,
              'home_build'
            );
            await ensureMinThinkingTime();
            if (result.success && result.data) {
              appendAppGenAgentMessage(result.data);
            }
            setFeedback('success');
          } catch (error: any) { throw error; }
        } else if (useQuery) {
          try {
            const result = await api.executeNaturalQuery(query);
            await ensureMinThinkingTime();
            const assistantMessage: ChatMessage = {
              id: (Date.now() + 1).toString(),
              role: 'assistant',
              content: `Found ${result.result.rowCount} result${result.result.rowCount !== 1 ? 's' : ''} matching your query.`,
              timestamp: new Date(),
              queryResult: result.result,
            };
            setMessages((prev) => [...prev, assistantMessage]);
            setFeedback('success');
          } catch (error: any) { throw error; }
        } else if (useAutomation) {
          const result = await api.analyzeIntent(query, undefined, reportDate);
          await ensureMinThinkingTime();
          const report = result?.report && typeof result.report === 'object' ? result.report : null;
          const summary = report?.summary && typeof report.summary === 'object' ? report.summary : {};
          const actions = Array.isArray(result?.actions) ? result.actions : [];
          const llmNarrative = await buildObservabilityNarrative(query, summary);
          const assistantMessage: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: llmNarrative || buildObservabilityFallbackText(summary),
            timestamp: new Date(),
            reportData: report ?? undefined,
            actionButtons: actions.length > 0 ? actions : undefined,
            choiceButtons: [{ label: 'Open Naavik Observe', choiceId: NAV_CHOICE_IDS.OBSERVE }],
          };
          setMessages((prev) => [...prev, assistantMessage]);
          setFeedback('success');
        } else {
          if (ci.intent === 'unmatched') {
            try {
              const response = await api.askTelecomQuestion(query, 'universal_companion', recentHistory);
              await ensureMinThinkingTime();
              if (response.answer && response.answer.trim().length > 0) {
                const assistantMessage: ChatMessage = {
                  id: (Date.now() + 1).toString(),
                  role: 'assistant',
                  content: response.answer,
                  timestamp: new Date(),
                };
                setMessages((prev) => [...prev, assistantMessage]);
                setFeedback('success');
              } else {
                throw new Error('empty');
              }
            } catch {
              await ensureMinThinkingTime();
              const assistantMessage: ChatMessage = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: "I'm sorry, Naavik isn't able to answer that question. Try asking about network offenders, RCA analysis, solution recommendations, parameter changes, ticket escalation, app generation, provisioning, or telco knowledge base queries.",
                timestamp: new Date(),
              };
              setMessages((prev) => [...prev, assistantMessage]);
              setFeedback('incomplete');
            }
          } else {
            try {
              const response = await api.askTelecomQuestion(query, 'universal_companion', recentHistory);
              await ensureMinThinkingTime();
              const assistantMessage: ChatMessage = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: response.answer,
                timestamp: new Date(),
              };
              setMessages((prev) => [...prev, assistantMessage]);
              setFeedback('success');
            } catch {
              const response = await api.executeIntent(query, 'universal');
              await ensureMinThinkingTime();
              const assistantMessage: ChatMessage = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: response.response,
                timestamp: new Date(),
                intent: response.parsedIntent,
                workflow: response.workflow,
              };
              setMessages((prev) => [...prev, assistantMessage]);
              setFeedback('success');
            }
          }
        }
      } else if (stream === 'knowledge') {
        // Knowledge base: always use telecom Q&A
        try {
          const response = await api.askTelecomQuestion(query, 'knowledge', recentHistory);
          await ensureMinThinkingTime();
          const assistantMessage: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: response.answer,
            timestamp: new Date(),
          };

          if (response.sources && response.sources.length > 0) {
            const sourcesText = response.sources
              .slice(0, 3)
              .map((s: any, idx: number) => `${idx + 1}. ${s.name} (${s.type})`)
              .join('\n');
            assistantMessage.content += `\n\n**Sources:**\n${sourcesText}`;
          }

          setMessages((prev) => [...prev, assistantMessage]);
          setFeedback('success');
        } catch (error: any) {
          throw error;
        }
      } else if (stream === 'observability') {
        const obsCi = classifyIntent(query);
        const useTelecomKnowledge = obsCi.intent === 'knowledge_qa' || (
          obsCi.intent === 'unmatched' && (
            lower.includes("what is") ||
            lower.includes("explain") ||
            lower.includes("describe") ||
            lower.includes("tell me about") ||
            (lower.includes("parameter") && !lower.includes("change")) ||
            (lower.includes("kpi") && !lower.includes("show"))
          )
        );

        const useAutomation = obsCi.intent === 'unmatched' && (
          lower.includes("wrong") ||
          lower.includes("problem") ||
          lower.includes("what's wrong") ||
          lower.includes("network health") ||
          lower.includes("congested") ||
          lower.includes("outage") ||
          lower.includes("issues") ||
          lower.includes("degraded") ||
          lower.includes("offender")
        );

        const useQuery = obsCi.intent === 'unmatched' && (
          lower.includes("show me") ||
          lower.includes("list") ||
          lower.includes("get") ||
          lower.includes("find") ||
          lower.includes("how many") ||
          lower.includes("count")
        );

        const useAnalysis = obsCi.intent === 'unmatched' && (
          lower.includes("analyze") ||
          lower.includes("trend") ||
          lower.includes("compare") ||
          lower.includes("average")
        );

        if (isWorstOffenderQuery(query)) {
          const dateId = reportDate || latestOffenderDate;
          const offenders = await fetchWorstOffendersTable(dateId);
          await ensureMinThinkingTime();
          const assistantMessage: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: `**Observation Agent** » Worst offenders for ${dateId}.`,
            timestamp: new Date(),
            visualization: {
              type: 'grid',
              data: {
                title: 'Worst Offenders',
                showSelection: false,
                rowTooltipField: '__shortSummaryTooltip',
                rows: offenders.rows.map((r) => ({
                  USID: r.siteId,
                  Date: dateId,
                  'Degraded KPI': r.degradedKpiCategory,
                  'CQX Value': r.rankingKpi,
                  'RCA Category': r.rca,
                  __shortSummaryTooltip: r.shortExplanation,
                  Site: r.siteId,
                  'Degraded KPI Category': r.degradedKpiCategory,
                  'Super KPI Value': r.rankingKpi,
                })),
              },
            },
          };
          setMessages((prev) => [...prev, assistantMessage]);
          setFeedback('success');
        } else if (isRcaExplainQuery(query)) {
          const siteId = extractDummySiteId(query);
          if (!siteId) throw new Error('Please specify a site ID (e.g., site 47323).');
          const dateId = reportDate || latestOffenderDate;
          const includeRecommendations = shouldIncludeRecommendations(query);
          const story = await fetchRcaStory(siteId, dateId, {
            showRecommendations: includeRecommendations,
          });
          await ensureMinThinkingTime();
          const assistantMessage: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: '',
            timestamp: new Date(),
            visualization: { type: 'rca_story', data: story },
            choiceButtons: includeRecommendations
              ? [
                  { label: 'Implement Change', choiceId: `rca_balance_apply_${siteId}` },
                  ...(story.outageNeighborSiteId
                    ? [{ label: 'Escalate outage ticket', choiceId: `rca_escalate_${siteId}` }]
                    : []),
                  { label: 'Automate Solution via AppGen', choiceId: `rca_appgen_${siteId}` },
                  { label: 'No further action', choiceId: `rca_no_action_${siteId}` },
                ]
              : [
                  { label: 'Solution recommendation', choiceId: `rca_offer_${siteId}` },
                  { label: 'No further action', choiceId: `rca_no_action_${siteId}` },
                ],
          };
          setMessages((prev) => [...prev, assistantMessage]);
          setFeedback('success');
        } else if (obsCi.intent === 'solution_recommendation') {
          const contextSiteIds = Object.keys(rcaFollowupContextRef.current);
          const lastSiteId = contextSiteIds.length > 0 ? contextSiteIds[contextSiteIds.length - 1] : null;
          if (lastSiteId) {
            const ctx = rcaFollowupContextRef.current[lastSiteId];
            const story = await fetchRcaStory(lastSiteId, ctx?.dateId || reportDate || latestOffenderDate, {
              showRecommendations: true,
            });
            await ensureMinThinkingTime();
            const assistantMessage: ChatMessage = {
              id: (Date.now() + 1).toString(),
              role: 'assistant',
              content: '',
              timestamp: new Date(),
              visualization: { type: 'rca_story', data: story },
              choiceButtons: [
                { label: 'Implement Change', choiceId: `rca_balance_apply_${lastSiteId}` },
                ...(story.outageNeighborSiteId ? [{ label: 'Escalate outage ticket', choiceId: `rca_escalate_${lastSiteId}` }] : []),
                { label: 'Automate Solution via AppGen', choiceId: `rca_appgen_${lastSiteId}` },
                { label: 'No further action', choiceId: `rca_no_action_${lastSiteId}` },
              ],
            };
            setMessages((prev) => [...prev, assistantMessage]);
            setFeedback('success');
          } else {
            await ensureMinThinkingTime();
            const assistantMessage: ChatMessage = {
              id: (Date.now() + 1).toString(),
              role: 'assistant',
              content: '**Reasoning Agent** » No active RCA context found. Please first ask for the RCA of a specific site (e.g., "Explain the RCA at UST237369"), then I can provide a solution recommendation.',
              timestamp: new Date(),
            };
            setMessages((prev) => [...prev, assistantMessage]);
            setFeedback('incomplete');
          }
        } else if (useTelecomKnowledge) {
          try {
            const response = await api.askTelecomQuestion(query, 'observability', recentHistory);
            await ensureMinThinkingTime();
            const assistantMessage: ChatMessage = {
              id: (Date.now() + 1).toString(),
              role: 'assistant',
              content: response.answer,
              timestamp: new Date(),
            };
            if (response.sources && response.sources.length > 0) {
              const sourcesText = response.sources.slice(0, 3).map((s: any, idx: number) => `${idx + 1}. ${s.name} (${s.type})`).join('\n');
              assistantMessage.content += `\n\n**Sources:**\n${sourcesText}`;
            }
            setMessages((prev) => [...prev, assistantMessage]);
            setFeedback('success');
          } catch (error: any) { throw error; }
        } else if (useQuery) {
          try {
            const result = await api.executeNaturalQuery(query);
            await ensureMinThinkingTime();
            const assistantMessage: ChatMessage = {
              id: (Date.now() + 1).toString(),
              role: 'assistant',
              content: `Found ${result.result.rowCount} result${result.result.rowCount !== 1 ? 's' : ''} matching your query.`,
              timestamp: new Date(),
              queryResult: result.result,
            };
            setMessages((prev) => [...prev, assistantMessage]);
            setFeedback('success');
          } catch (error: any) { throw error; }
        } else if (useAnalysis) {
          await ensureMinThinkingTime();
          const assistantMessage: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: 'Data analysis is being set up. This feature will run statistical analysis and generate charts.',
            timestamp: new Date(),
          };
          setMessages((prev) => [...prev, assistantMessage]);
          setFeedback('success');
        } else if (useAutomation) {
          const result = await api.analyzeIntent(query, undefined, reportDate);
          await ensureMinThinkingTime();
          const report = result?.report && typeof result.report === 'object' ? result.report : null;
          const summary = report?.summary && typeof report.summary === 'object' ? report.summary : {};
          const actions = Array.isArray(result?.actions) ? result.actions : [];
          const llmNarrative = await buildObservabilityNarrative(query, summary);
          const assistantMessage: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: llmNarrative || buildObservabilityFallbackText(summary),
            timestamp: new Date(),
            reportData: report ?? undefined,
            actionButtons: actions.length > 0 ? actions : undefined,
            choiceButtons: [{ label: 'Open Naavik Observe', choiceId: NAV_CHOICE_IDS.OBSERVE }],
          };
          setMessages((prev) => [...prev, assistantMessage]);
          setFeedback('success');
        } else {
          const response = await api.executeIntent(query, 'observability');
          await ensureMinThinkingTime();
          const assistantMessage: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: response.response,
            timestamp: new Date(),
            intent: response.parsedIntent,
            workflow: response.workflow,
          };
          setMessages((prev) => [...prev, assistantMessage]);
          setFeedback('success');
        }
      } else if (stream === 'provision') {
        // Provision: parameter changes, site provisioning, scripts
        const changeIntent = parseOssParameterIntent(query);

        if (changeIntent) {
          await ensureMinThinkingTime();
          await requestOssChangeConfirmation(query, changeIntent);
        } else {
          const response = await api.executeIntent(query, 'provision');
          await ensureMinThinkingTime();
          const assistantMessage: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: response.response || 'Taking you to Provisioning. Describe the parameter changes or site provisioning you need.',
            timestamp: new Date(),
            intent: response.parsedIntent,
            workflow: response.workflow,
          };
          setMessages((prev) => [...prev, assistantMessage]);
          setFeedback('success');
        }
      }
    } catch (error: any) {
      // User-initiated abort (clicked the Stop button) — silent, no error toast.
      const isAborted =
        error?.name === 'AbortError' ||
        error?.name === 'CanceledError' ||
        error?.code === 'ERR_CANCELED' ||
        (typeof error?.message === 'string' && error.message.toLowerCase() === 'canceled');
      if (isAborted) {
        const assistantMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: '_Request stopped._',
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, assistantMessage]);
        return;
      }
      const msg = (error.response?.data?.error?.message || error.message || '').toLowerCase();
      const code = (error.response?.data?.error?.code || '').toUpperCase();
      const isIncomplete =
        code === 'INVALID_QUERY' ||
        msg.includes('clarify') ||
        msg.includes('rephrase') ||
        msg.includes('incomplete');
      setFeedback(isIncomplete ? 'incomplete' : 'error');

      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content:
          error.response?.data?.error?.message ||
          error.message ||
          'Sorry, I encountered an error processing your request.',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } finally {
      setIsLoading(false);
      inflightControllerRef.current = null;
      feedbackTimeoutRef.current = setTimeout(() => setFeedback(null), 6000);
    }
  };

  // Allow generative UI "chips" to trigger a new chat turn without tight component coupling.
  useEffect(() => {
    const handler = (evt: Event) => {
      const value = (evt as CustomEvent)?.detail?.value;
      if (typeof value !== 'string' || !value.trim()) return;
      if (isLoading) return;
      void runIntent(value.trim());
    };
    window.addEventListener('naavik:chat:chip', handler as any);
    return () => window.removeEventListener('naavik:chat:chip', handler as any);
  }, [isLoading, runIntent]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isLoading) return;
    const typed = inputValue.trim();
    const attachmentsToSend = pendingAttachments;
    const resolved = resolveTypedToChoiceId(typed);
    if (resolved) {
      setInputValue('');
      if (attachmentsToSend.length) setPendingAttachments([]);
      handleChoiceClick(resolved.messageId, resolved.choiceId);
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    if (attachmentsToSend.length) setPendingAttachments([]);
    await runIntent(typed, { attachments: attachmentsToSend.length ? attachmentsToSend : undefined });
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const normalizeChoiceText = (value: string) =>
    String(value || '')
      .toLowerCase()
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const findLastChoiceMessage = (): ChatMessage | null => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i];
      if (msg.role === 'assistant' && Array.isArray(msg.choiceButtons) && msg.choiceButtons.length > 0) {
        return msg;
      }
    }
    return null;
  };

  const resolveTypedToChoiceId = (typedInput: string): { messageId: string; choiceId: string } | null => {
    if (!INTENT_CANONICALIZER_V1_ENABLED) return null;
    const lastChoiceMessage = findLastChoiceMessage();
    if (!lastChoiceMessage || !Array.isArray(lastChoiceMessage.choiceButtons)) return null;
    const choices = lastChoiceMessage.choiceButtons;
    if (!choices.length) return null;

    const query = normalizeChoiceText(typedInput);
    if (!query) return null;

    const byExactLabel = choices.find((c) => normalizeChoiceText(c.label) === query);
    if (byExactLabel) return { messageId: lastChoiceMessage.id, choiceId: byExactLabel.choiceId };

    const pick = (predicate: (choice: { label: string; choiceId: string }) => boolean) => choices.find(predicate);
    const bySemantics =
      (/^__edit_logic__:\s*kpi$/.test(query) && pick((c) => /edit kpi condition/i.test(c.label))) ||
      (/^__edit_logic__:\s*parameter_mo$/.test(query) && pick((c) => /edit parameter/i.test(c.label))) ||
      (/^__edit_logic__:\s*action$/.test(query) && pick((c) => /edit action/i.test(c.label))) ||
      (/^__edit_logic__:\s*scope$/.test(query) && pick((c) => /edit scope/i.test(c.label))) ||
      (/(authorize|build now|generate app|generate code)/.test(query) && pick((c) => /authorize build|confirm change/i.test(c.label))) ||
      (
        /(solution recommendation|recommend solution|show recommendation|is there .*recommend|recommended action|next best action)/.test(query) &&
        pick((c) => /solution recommendation|recommended action/i.test(c.label) || /rca_offer_/i.test(c.choiceId))
      ) ||
      (/(implement change|execute change|apply change|do so)/.test(query) && pick((c) => /implement change|execute/i.test(c.label) || /rca_(balance_apply|execute)_/i.test(c.choiceId))) ||
      (/(escalate|ticket)/.test(query) && pick((c) => /escalate/i.test(c.label))) ||
      (/(no further action|no action)/.test(query) && pick((c) => /no action/i.test(c.label))) ||
      (/(cancel)/.test(query) && pick((c) => /cancel/i.test(c.label))) ||
      (/(open observe)/.test(query) && pick((c) => /open .*observe/i.test(c.label) || c.choiceId === NAV_CHOICE_IDS.OBSERVE)) ||
      (/(open appgen|open app gen)/.test(query) && pick((c) => /open .*appgen/i.test(c.label) || c.choiceId === NAV_CHOICE_IDS.APPGEN)) ||
      (/(open provision|open provisioning)/.test(query) && pick((c) => /open .*provision/i.test(c.label) || c.choiceId === NAV_CHOICE_IDS.PROVISION)) ||
      (/(open settings)/.test(query) && pick((c) => /open settings/i.test(c.label) || c.choiceId === NAV_CHOICE_IDS.SETTINGS)) ||
      (/(edit kpi)/.test(query) && pick((c) => /edit kpi/i.test(c.label))) ||
      (/(edit parameter|edit mo)/.test(query) && pick((c) => /edit parameter/i.test(c.label))) ||
      (/(edit action)/.test(query) && pick((c) => /edit action/i.test(c.label))) ||
      (/(edit scope)/.test(query) && pick((c) => /edit scope/i.test(c.label))) ||
      (/(add kpi)/.test(query) && pick((c) => /add kpi/i.test(c.label))) ||
      (/(refine input|refine)/.test(query) && pick((c) => /refine/i.test(c.label)));

    if (bySemantics) {
      return { messageId: lastChoiceMessage.id, choiceId: bySemantics.choiceId };
    }

    const byContains = choices.find((choice) => query.includes(normalizeChoiceText(choice.label)));
    if (byContains) return { messageId: lastChoiceMessage.id, choiceId: byContains.choiceId };

    return null;
  };

  const handleRowAction = (action: string, row: Record<string, any>) => {
    if (action === 'explain-rca') {
      const siteId = row.Site || row.site || row.siteId || row.site_id;
      if (!siteId) return;
      const dateId = String(row.DATE_ID || row.dateId || row.date || latestOffenderDate).slice(0, 10);
      const query = `Explain the RCA for site ${siteId} on ${dateId}`;
      void runIntent(query);
    }
  };

  const handleSuggestionClick = (text: string) => {
    if (text === 'Build an App') {
      setActiveStream('appgen');
      runIntent('I want to build an app', { overrideStream: 'appgen' });
      return;
    }
    if (text === 'Observe and Analyze') {
      setActiveStream('universal');
      setSelectedDateId(latestOffenderDate);
      setActiveSiteLayer('degraded');
      runIntent(
        'Show me the worst offenders of the network today',
        { overrideStream: 'universal' }
      );
      return;
    }
    if (text === 'Ask the Telco Library') {
      setActiveStream('knowledge');
      runIntent('What are the key network parameters and KPIs?', { overrideStream: 'knowledge' });
      return;
    }
    if (text === 'Trigger a change') {
      setActiveStream('provision');
      const userMsg: ChatMessage = {
        id: Date.now().toString(),
        role: 'user',
        content: text,
        timestamp: new Date(),
      };
      const assistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Would you like to change a single parameter or provision site(s)?',
        timestamp: new Date(),
        choiceButtons: [
          { label: 'Single parameter', choiceId: 'single' },
          { label: 'Site provisioning', choiceId: 'site' },
        ],
      };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      return;
    }
    runIntent(text);
  };

  const CHOICE_THINKING_MS = 2000;

  const echoUserChoice = (label: string) => {
    const echo: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: label,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, echo]);
    setIsLoading(true);
  };

  const handleChoiceClick = (_messageId: string, choiceId: string) => {
    if (choiceId.startsWith('agent_confirm_') || choiceId.startsWith('agent_cancel_')) {
      const actionId = choiceId
        .replace('agent_confirm_', '')
        .replace('agent_cancel_', '');
      const type = choiceId.startsWith('agent_confirm_') ? 'confirm' : 'cancel';
      echoUserChoice(type === 'confirm' ? 'Confirm change' : 'Cancel change');
      void (async () => {
        await sleep(CHOICE_THINKING_MS);
        setIsLoading(false);
        try {
          const response = await api.agentV2Chat({
            threadId: sessionId,
            message: '',
            stream: activeStream,
            currentView: currentView || 'home',
            action: { type, actionId },
          });
          appendAgentAssistantMessage(response);
        } catch {
          const fallback: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: 'I could not process that action right now. Please retry.',
            timestamp: new Date(),
          };
          setMessages((prev) => [...prev, fallback]);
        }
      })();
      return;
    }

    if (choiceId.startsWith('oss_confirm_')) {
      const key = choiceId.replace('oss_confirm_', '');
      echoUserChoice('Confirm parameter change');
      void startConfirmedOssChange(key);
      return;
    }
    if (choiceId.startsWith('oss_cancel_')) {
      const key = choiceId.replace('oss_cancel_', '');
      delete pendingOssChangesRef.current[key];
      echoUserChoice('Cancel parameter change');
      void (async () => {
        await sleep(CHOICE_THINKING_MS);
        setIsLoading(false);
        const msg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: 'Parameter change cancelled. No network action was triggered.',
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, msg]);
      })();
      return;
    }
    // ── Dashboard confirmation choices ───────────────────────────────────────
    if (choiceId.startsWith('dashboard_standard_') || choiceId.startsWith('dashboard_kpi_')) {
      // Format: dashboard_standard_{siteId}_{endDate}_{timeframe}_{daysBack}
      //         dashboard_kpi_{siteId}_{endDate}_{timeframe}_{daysBack}_{kpiName}
      const parts = choiceId.split('_');
      const isStandard = parts[1] === 'standard';
      // parts[0]=dashboard, parts[1]=standard|kpi, parts[2]=siteId, parts[3]=endDate, parts[4]=timeframe, parts[5]=daysBack, parts[6+]=kpiName
      const siteId = parts[2] ?? '';
      const endDateRaw = parts[3];
      const endDate = (endDateRaw && endDateRaw !== 'undefined') ? endDateRaw : undefined;
      const timeframe = (parts[4] === 'hourly' ? 'hourly' : 'daily') as 'daily' | 'hourly';
      const fallbackDays = timeframe === 'hourly' ? 48 : 30;
      const daysBack = parseInt(parts[5] ?? String(fallbackDays), 10) || fallbackDays;
      const kpiNames = isStandard ? [] : [parts.slice(6).join('_')].filter(Boolean);
      const label = kpiNames.length > 0
        ? kpiNames.map((n) => KPI_MAP[n]?.label || n).join(', ')
        : 'standard KPIs';
      echoUserChoice(isStandard ? `Standard KPIs for ${siteId}` : label);
      void (async () => {
        await sleep(CHOICE_THINKING_MS);
        setIsLoading(false);
        const dashMsg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `**Observation Agent** » Dashboard for **${siteId}** · ${label} · ${timeframe} · last ${daysBack} days`,
          timestamp: new Date(),
          visualization: {
            type: 'chat_kpi_dashboard',
            data: { siteId, endDate, kpiNames, timeframe, daysBack },
          },
        };
        setMessages((prev) => [...prev, dashMsg]);
      })();
      return;
    }

    if (choiceId === NAV_CHOICE_IDS.APPGEN) {
      if (onNavigate) onNavigate('appgen');
      return;
    }
    if (choiceId === 'build_stay_in_chat') {
      // User opted to stay in chat after the build → AppGen prompt.
      // Acknowledge without navigating; they can restate their ask more specifically.
      const ack: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Got it — staying in chat. Tell me what you want to build and I can scaffold it here, or just ask a question.',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, ack]);
      return;
    }
    if (choiceId === NAV_CHOICE_IDS.OBSERVE) {
      if (onNavigate) onNavigate('observe');
      return;
    }
    if (choiceId === NAV_CHOICE_IDS.PROVISION) {
      if (onNavigate) onNavigate('provision');
      return;
    }
    if (choiceId === NAV_CHOICE_IDS.SETTINGS) {
      if (onNavigate) onNavigate('settings');
      return;
    }
    if (choiceId === 'appgen_save_applet') {
      const code = lastGeneratedCodeRef.current;
      if (!code) {
        setMessages((prev) => [...prev, {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: 'No generated code found. Please build the app first.',
          timestamp: new Date(),
        }]);
        return;
      }
      const userMsg: ChatMessage = {
        id: Date.now().toString(),
        role: 'user',
        content: 'Save as Applet',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);
      void (async () => {
        await sleep(CHOICE_THINKING_MS);
        setIsLoading(false);
        try {
          const appName = conversationContext.appBuilderAppName || `Applet_${Date.now().toString().slice(-6)}`;
          await api.createAutomationApp({
            appName,
            generatedCode: code,
            description: `Generated EIAP applet: ${appName}`,
            status: 'validated',
          });
          window.dispatchEvent(new CustomEvent('applet-saved'));
          const msg: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: `**AppGen Agent** » Applet "${appName}" has been saved to the Naavik AppGen catalog. You can find it in the Applet library.`,
            timestamp: new Date(),
            choiceButtons: [{ label: 'Open Naavik AppGen', choiceId: NAV_CHOICE_IDS.APPGEN }],
          };
          setMessages((prev) => [...prev, msg]);
        } catch (error: any) {
          setMessages((prev) => [...prev, {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: error?.message || 'Failed to save applet. Please retry.',
            timestamp: new Date(),
          }]);
        }
      })();
      return;
    }
    if (choiceId.startsWith('appgen_choice_')) {
      const mapped = appgenChoicesRef.current[choiceId];
      if (!mapped) return;

      if (mapped.action === 'authorize_generate') {
        const threadId = appgenThreadIdRef.current;
        if (!threadId) return;
        const authorizationToken = appgenAuthTokenRef.current[threadId];
        if (!authorizationToken) {
          const failMessage: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: 'Build authorization expired. Please click Authorize Build again.',
            timestamp: new Date(),
          };
          setMessages((prev) => [...prev, failMessage]);
          return;
        }

        const userMsg: ChatMessage = {
          id: Date.now().toString(),
          role: 'user',
          content: 'Authorize Build',
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, userMsg]);

        void (async () => {
          try {
            const generated = await api.appgenAgentV1Generate(threadId, authorizationToken);
            const data = generated.data || {};
            const code = String(data.eiapCode || '');
            lastGeneratedCodeRef.current = code;
            const savedAppName2 = conversationContext.appBuilderAppName || `rApp_${Date.now().toString().slice(-6)}`;
            if (code) {
              api.createAutomationApp({
                appName: savedAppName2,
                generatedCode: code,
                description: `Auto-saved rApp from AppGen build`,
                status: 'validated',
              }).then(() => {
                window.dispatchEvent(new CustomEvent('applet-saved'));
              }).catch(() => {});
            }
            const doneMessage: ChatMessage = {
              id: (Date.now() + 1).toString(),
              role: 'assistant',
              content: `**AppGen Agent** » Build completed and saved as **${savedAppName2}** in Naavik AppGen. Review generated code below.`,
              timestamp: new Date(),
              visualization: code ? { type: 'code', data: code } : undefined,
              choiceButtons: [
                { label: 'Package as rApp', choiceId: 'appgen_package_rapp' },
                { label: 'Save as Applet', choiceId: 'appgen_save_applet' },
                { label: 'Open Naavik AppGen', choiceId: NAV_CHOICE_IDS.APPGEN },
              ],
            };
            setMessages((prev) => [...prev, doneMessage]);
          } catch (error: any) {
            const failMessage: ChatMessage = {
              id: (Date.now() + 1).toString(),
              role: 'assistant',
              content: error?.message || 'Build failed. Please refine the inputs and retry.',
              timestamp: new Date(),
            };
            setMessages((prev) => [...prev, failMessage]);
          }
        })();
        return;
      }

      const value = mapped.value || '';
      if (!value) return;
      if (value.startsWith('__edit_logic__:')) {
        const target = value.replace('__edit_logic__:', '');
        const promptMap: Record<string, string> = {
          kpi: 'Edit KPI condition',
          parameter_mo: 'Edit parameter and MO',
          action: 'Edit action type and value',
          scope: 'Edit scope and granularity',
        };
        void runIntent(promptMap[target] || 'Refine inputs', { overrideStream: 'appgen' });
        return;
      }
      if (value === '__refine_inputs__') {
        void runIntent('Refine inputs', { overrideStream: 'appgen' });
        return;
      }
      void runIntent(value, { overrideStream: 'appgen' });
      return;
    }
    if (choiceId.startsWith('rca_execute_')) {
      const siteId = choiceId.replace('rca_execute_', '');
      echoUserChoice(`Execute parameter change for ${siteId}`);
      const ctx = rcaFollowupContextRef.current[siteId];
      if (!ctx) {
        const msg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: 'Execution context is unavailable for this site. Please request the RCA again.',
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, msg]);
        return;
      }
      void (async () => {
        await sleep(CHOICE_THINKING_MS);
        setIsLoading(false);
        const candidates = (ctx.trafficCandidates && ctx.trafficCandidates.length > 0
          ? ctx.trafficCandidates
          : ctx.relatedSites.filter((s) => s.siteId !== ctx.outageNeighborSiteId).slice(0, 2))
          .map((s) => s.siteId);
        const executionStatus = await api.startOssParameterChange({
          siteId: ctx.sourceSite.siteId,
          parameter: 'cellindividualoffset',
          value: 2,
          unit: 'dB',
          intentText: `Traffic balancing for ${ctx.sourceSite.siteId}. Candidate neighbors: ${candidates.join(', ') || 'N/A'}.`,
        });
        const executionMessageId = (Date.now() + 1).toString();
        const assistantMessage: ChatMessage = {
          id: executionMessageId,
          role: 'assistant',
          content:
            `Executing relation-level parameter update for ${ctx.sourceSite.siteId}.\n` +
            `Parameter: eutrancellrelation.cellindividualoffset (+2 dB) on selected neighbors.\n` +
            `Candidates: ${candidates.join(', ') || 'N/A'}.`,
          timestamp: new Date(),
          executionStatus,
        };
        setMessages((prev) => [...prev, assistantMessage]);
        void pollOssExecutionStatus(executionStatus.executionId, executionMessageId);
      })();
      return;
    }
    if (choiceId.startsWith('rca_escalate_')) {
      const siteId = choiceId.replace('rca_escalate_', '');
      echoUserChoice('Escalate the outage ticket mentioned in the RCA to P1');
      void (async () => {
        await sleep(CHOICE_THINKING_MS);
        setIsLoading(false);
        const ctx = rcaFollowupContextRef.current[siteId];
        const neighborSiteId = ctx?.outageNeighborSiteId || 'SITE_UNKNOWN';
        const ticketId = `TT-${Date.now().toString().slice(-7)}`;
        const comment =
          `Escalated due to sustained degradation impact on ${siteId}. ` +
          `Outage-neighbor correlation observed at ${neighborSiteId}, with congestion risk in serving area. ` +
          `Requested urgent transport/backhaul review and service restoration.`;
        const msg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `**Network Ops Agent** » Ticket escalation has been submitted for ${neighborSiteId}.`,
          timestamp: new Date(),
          visualization: {
            type: 'ticket_escalation',
            data: {
              siteId,
              neighborSiteId,
              ticketId,
              previousStatus: 'Monitoring',
              updatedStatus: 'Escalated',
              previousPriority: 'P4',
              updatedPriority: 'P1',
              comment,
              updatedAt: new Date().toLocaleString(),
            },
          },
        };
        setMessages((prev) => [...prev, msg]);
      })();
      return;
    }
    if (choiceId.startsWith('rca_no_action_')) {
      const siteId = choiceId.replace('rca_no_action_', '');
      echoUserChoice('No further action');
      void (async () => {
        await sleep(CHOICE_THINKING_MS);
        setIsLoading(false);
        const msg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `No action recorded for ${siteId}. I will keep this site under monitoring.`,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, msg]);
      })();
      return;
    }
    if (choiceId.startsWith('rca_appgen_')) {
      const siteId = choiceId.replace('rca_appgen_', '');
      echoUserChoice('Build me an App to automate this solution recommendation');
      const ctx = rcaFollowupContextRef.current[siteId];
      rcaAppgenBuildRef.current = {
        siteId,
        rcaBucket: ctx?.rcaBucket || 'Unknown RCA',
        solutionRec: ctx?.solutionRec,
      };
      void (async () => {
        await sleep(CHOICE_THINKING_MS);
        setIsLoading(false);
        const msg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: '**AppGen Agent** » Should this rApp check conditions on 4G cells, 5G cells, or both?',
          timestamp: new Date(),
          choiceButtons: [
            { label: '4G Cells', choiceId: 'rcabuild_scope_4g' },
            { label: '5G Cells', choiceId: 'rcabuild_scope_5g' },
            { label: 'Both 4G & 5G', choiceId: 'rcabuild_scope_both' },
          ],
        };
        setMessages((prev) => [...prev, msg]);
      })();
      return;
    }
    if (choiceId.startsWith('rcabuild_scope_')) {
      const scope = choiceId.replace('rcabuild_scope_', '');
      const label = scope === '4g' ? '4G Cells' : scope === '5g' ? '5G Cells' : 'Both 4G & 5G';
      echoUserChoice(label);
      if (rcaAppgenBuildRef.current) rcaAppgenBuildRef.current.cellScope = scope;
      void (async () => {
        await sleep(CHOICE_THINKING_MS);
        setIsLoading(false);
        const msg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: '**AppGen Agent** » How should the traffic steering logic work?',
          timestamp: new Date(),
          choiceButtons: [
            { label: 'Uniformly distribute to neighbors', choiceId: 'rcabuild_steer_uniform' },
            { label: 'Identify neighbors with room for additional traffic', choiceId: 'rcabuild_steer_room' },
            { label: 'Force users to other cells', choiceId: 'rcabuild_steer_force' },
          ],
        };
        setMessages((prev) => [...prev, msg]);
      })();
      return;
    }
    if (choiceId.startsWith('rcabuild_steer_')) {
      const steer = choiceId.replace('rcabuild_steer_', '');
      const steerLabels: Record<string, string> = {
        uniform: 'Uniformly distribute to neighbors',
        room: 'Identify neighbors with room for additional traffic',
        force: 'Force users to other cells',
      };
      echoUserChoice(steerLabels[steer] || steer);
      if (rcaAppgenBuildRef.current) rcaAppgenBuildRef.current.steeringLogic = steer;
      void (async () => {
        await sleep(CHOICE_THINKING_MS);
        setIsLoading(false);
        const msg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: '**AppGen Agent** » Which KPI should trigger the traffic steering action?',
          timestamp: new Date(),
          choiceButtons: [
            { label: 'Accessibility (RRC Setup Success Rate)', choiceId: 'rcabuild_kpi_accessibility' },
            { label: 'Retainability (Call Drop Rate)', choiceId: 'rcabuild_kpi_retainability' },
            { label: 'Throughput (Avg DL Throughput)', choiceId: 'rcabuild_kpi_throughput' },
            { label: 'Load (PRB Utilization)', choiceId: 'rcabuild_kpi_load' },
          ],
        };
        setMessages((prev) => [...prev, msg]);
      })();
      return;
    }
    if (choiceId.startsWith('rcabuild_kpi_')) {
      const kpiKey = choiceId.replace('rcabuild_kpi_', '');
      const kpiLabels: Record<string, string> = {
        accessibility: 'Accessibility (RRC Setup Success Rate)',
        retainability: 'Retainability (Call Drop Rate)',
        throughput: 'Throughput (Avg DL Throughput)',
        load: 'Load (PRB Utilization)',
      };
      const kpiNames: Record<string, string> = {
        accessibility: 'rrc_setup_success_rate',
        retainability: 'call_drop_rate',
        throughput: 'avg_dl_throughput',
        load: 'prb_utilization',
      };
      echoUserChoice(kpiLabels[kpiKey] || kpiKey);
      const build = rcaAppgenBuildRef.current;
      if (build) build.triggerKpi = kpiNames[kpiKey] || kpiKey;
      const steeringLabels: Record<string, string> = {
        uniform: 'Uniformly distribute to neighbors',
        room: 'Identify neighbors with room for additional traffic',
        force: 'Force users to other cells',
      };
      void (async () => {
        await sleep(CHOICE_THINKING_MS);
        setIsLoading(false);
        const summaryMsg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content:
            `**AppGen Agent** » Here is the rApp configuration summary:\n\n` +
            `• **Cell scope:** ${build?.cellScope === '4g' ? '4G' : build?.cellScope === '5g' ? '5G' : '4G & 5G'}\n` +
            `• **Steering logic:** ${steeringLabels[build?.steeringLogic || 'uniform']}\n` +
            `• **Trigger KPI:** ${kpiLabels[kpiKey] || kpiKey}\n` +
            `• **Parameter:** eutrancellrelation.cellindividualoffset (default: 3)\n\n` +
            `Ready to generate. How would you like to proceed?`,
          timestamp: new Date(),
          choiceButtons: [
            { label: 'Authorize Build', choiceId: 'rcabuild_authorize' },
            { label: 'Edit steering logic', choiceId: 'rcabuild_edit_steer' },
            { label: 'Change KPI condition', choiceId: 'rcabuild_edit_kpi' },
            { label: 'Add KPI condition', choiceId: 'rcabuild_add_kpi' },
            { label: 'Cancel', choiceId: 'rcabuild_cancel' },
          ],
        };
        setMessages((prev) => [...prev, summaryMsg]);
      })();
      return;
    }
    if (choiceId === 'rcabuild_authorize') {
      echoUserChoice('Authorize Build');
      const build = rcaAppgenBuildRef.current;
      void (async () => {
        await sleep(CHOICE_THINKING_MS);
        setIsLoading(false);
        const genMsg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: '**AppGen Agent** » Build authorized. Generating rApp code...',
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, genMsg]);
        setIsLoading(true);
        try {
          const cellScope = build?.cellScope || '4g';
          const steeringLogic = build?.steeringLogic || 'uniform';
          const triggerKpi = build?.triggerKpi || 'rrc_setup_success_rate';
          const solutionRec = build?.solutionRec;
          const technique = solutionRec?.technique || 'TrafficSteering';
          const appName = `${technique.replace(/\s+/g, '_')}_${triggerKpi}_${Date.now().toString().slice(-6)}`;
          const code = buildRcaAppgenCode(cellScope, steeringLogic, triggerKpi, solutionRec);
          lastGeneratedCodeRef.current = code;
          if (code) {
            api.createAutomationApp({
              appName,
              generatedCode: code,
              description: solutionRec?.description || `RCA-driven rApp using ${triggerKpi}`,
              status: 'validated',
            }).then(() => {
              window.dispatchEvent(new CustomEvent('applet-saved'));
            }).catch(() => {});
          }
          await sleep(1500);
          setIsLoading(false);
          const doneMsg: ChatMessage = {
            id: (Date.now() + 2).toString(),
            role: 'assistant',
            content: `**AppGen Agent** » Build completed and saved as **${appName}** in Naavik AppGen. Review generated code below.`,
            timestamp: new Date(),
            visualization: { type: 'code', data: code },
            choiceButtons: [
              { label: 'Package as rApp', choiceId: 'appgen_package_rapp' },
              { label: 'Save as Applet', choiceId: 'appgen_save_applet' },
              { label: 'Open Naavik AppGen', choiceId: NAV_CHOICE_IDS.APPGEN },
            ],
          };
          setMessages((prev) => [...prev, doneMsg]);
        } catch {
          setIsLoading(false);
          const failMsg: ChatMessage = {
            id: (Date.now() + 2).toString(),
            role: 'assistant',
            content: 'Build failed. Please retry.',
            timestamp: new Date(),
          };
          setMessages((prev) => [...prev, failMsg]);
        }
        rcaAppgenBuildRef.current = null;
      })();
      return;
    }
    if (choiceId === 'rcabuild_edit_steer') {
      echoUserChoice('Edit steering logic');
      void (async () => {
        await sleep(CHOICE_THINKING_MS);
        setIsLoading(false);
        const msg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: '**AppGen Agent** » Select the updated traffic steering logic:',
          timestamp: new Date(),
          choiceButtons: [
            { label: 'Uniformly distribute to neighbors', choiceId: 'rcabuild_steer_uniform' },
            { label: 'Identify neighbors with room for additional traffic', choiceId: 'rcabuild_steer_room' },
            { label: 'Force users to other cells', choiceId: 'rcabuild_steer_force' },
          ],
        };
        setMessages((prev) => [...prev, msg]);
      })();
      return;
    }
    if (choiceId === 'rcabuild_edit_kpi' || choiceId === 'rcabuild_add_kpi') {
      echoUserChoice(choiceId === 'rcabuild_edit_kpi' ? 'Change KPI condition' : 'Add KPI condition');
      void (async () => {
        await sleep(CHOICE_THINKING_MS);
        setIsLoading(false);
        const msg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: '**AppGen Agent** » Select the KPI to use as trigger condition:',
          timestamp: new Date(),
          choiceButtons: [
            { label: 'Accessibility (RRC Setup Success Rate)', choiceId: 'rcabuild_kpi_accessibility' },
            { label: 'Retainability (Call Drop Rate)', choiceId: 'rcabuild_kpi_retainability' },
            { label: 'Throughput (Avg DL Throughput)', choiceId: 'rcabuild_kpi_throughput' },
            { label: 'Load (PRB Utilization)', choiceId: 'rcabuild_kpi_load' },
          ],
        };
        setMessages((prev) => [...prev, msg]);
      })();
      return;
    }
    if (choiceId === 'rcabuild_cancel') {
      echoUserChoice('Cancel');
      rcaAppgenBuildRef.current = null;
      void (async () => {
        await sleep(CHOICE_THINKING_MS);
        setIsLoading(false);
        const msg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: 'Build cancelled. No rApp was generated.',
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, msg]);
      })();
      return;
    }
    if (choiceId.startsWith('rca_balance_apply_')) {
      const siteId = choiceId.replace('rca_balance_apply_', '');
      echoUserChoice('Implement the parameter change per the Solution recommendation');
      const ctx = rcaFollowupContextRef.current[siteId];
      if (!ctx) return;
      pendingTrafficBalanceRef.current = null;
      void (async () => {
        await sleep(CHOICE_THINKING_MS);
        setIsLoading(false);
        const rec = ctx.solutionRec;
        const targetSite = rec?.targetSiteId || ctx.sourceSite.siteId;
        const parameter = rec?.parameter || 'cellIndividualOffset';
        const value = rec?.value ?? 2;
        const unit = rec?.unit || 'dB';
        const intentText = rec?.description
          || `Apply ${rec?.technique || 'traffic balancing'} on ${ctx.sourceSite.siteId} via ${parameter}`;
        const executionStatus = await api.startOssParameterChange({
          siteId: targetSite,
          parameter,
          value,
          unit,
          intentText,
        });
        const executionMessageId = (Date.now() + 1).toString();
        const assistantMessage: ChatMessage = {
          id: executionMessageId,
          role: 'assistant',
          content: `**Control Agent** » Executing OSS adapter: **${rec?.technique || 'Parameter Change'}** — set \`${parameter}\` to ${value} ${unit} on ${targetSite}...`,
          timestamp: new Date(),
          executionStatus,
          choiceButtons: [{ label: 'Open Naavik Provision', choiceId: NAV_CHOICE_IDS.PROVISION }],
        };
        setMessages((prev) => [...prev, assistantMessage]);
        void pollOssExecutionStatus(executionStatus.executionId, executionMessageId);
      })();
      return;
    }
    if (choiceId.startsWith('rca_offer_')) {
      const siteId = choiceId.replace('rca_offer_', '');
      echoUserChoice('Solution recommendation');
      const ctx = rcaFollowupContextRef.current[siteId];
      if (!ctx) {
        const msg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: 'Recommendation context is unavailable for this site. Please request the RCA again.',
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, msg]);
        return;
      }
      void (async () => {
        await sleep(CHOICE_THINKING_MS);
        setIsLoading(false);
        const story = await fetchRcaStory(siteId, ctx.dateId, {
          showRecommendations: true,
        });
        const msg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: '',
          timestamp: new Date(),
          visualization: { type: 'rca_story', data: story },
          choiceButtons: [
            { label: 'Implement Change', choiceId: `rca_balance_apply_${siteId}` },
            ...(story.outageNeighborSiteId ? [{ label: 'Escalate outage ticket', choiceId: `rca_escalate_${siteId}` }] : []),
            { label: 'Automate Solution via AppGen', choiceId: `rca_appgen_${siteId}` },
            { label: 'No further action', choiceId: `rca_no_action_${siteId}` },
          ],
        };
        setMessages((prev) => [...prev, msg]);
      })();
      return;
    }
    if (choiceId.startsWith('rca_balance_')) {
      const siteId = choiceId.replace('rca_balance_', '');
      echoUserChoice('Show traffic balancing options');
      const ctx = rcaFollowupContextRef.current[siteId];
      if (!ctx) {
        void (async () => {
          await sleep(CHOICE_THINKING_MS);
          setIsLoading(false);
          const msg: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: 'Unable to load traffic balancing options for this site. Please request the RCA again.',
            timestamp: new Date(),
          };
          setMessages((prev) => [...prev, msg]);
        })();
        return;
      }
      void (async () => {
        await sleep(CHOICE_THINKING_MS);
        setIsLoading(false);
        const absorbCandidates = ctx.relatedSites
          .filter((s) => s.siteId !== ctx.outageNeighborSiteId)
          .slice(0, 2);
        pendingTrafficBalanceRef.current = ctx;
        const msg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content:
            `Traffic balancing options identified for ${ctx.sourceSite.siteId}:\n` +
            absorbCandidates.map((s, idx) => `${idx + 1}. ${s.siteId}`).join('\n') +
            `\n\nWe can tune eutrancellrelation.cellindividualoffset on these relations to absorb load (excluding outage neighbor ${
              ctx.outageNeighborSiteId || 'N/A'
            }). Click "Implement Change" to execute via OSS adapter.`,
          timestamp: new Date(),
          choiceButtons: [{ label: 'Implement Change', choiceId: `rca_balance_apply_${siteId}` }],
        };
        setMessages((prev) => [...prev, msg]);
      })();
      return;
    }
    if (choiceId === 'single') {
      echoUserChoice('Single parameter change');
      void (async () => {
        await sleep(CHOICE_THINKING_MS);
        setIsLoading(false);
        const msg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: 'Single parameter change is not set up yet. Coming soon.',
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, msg]);
      })();
      return;
    }
    if (choiceId === 'site') {
      echoUserChoice('Site provisioning');
      void (async () => {
        await sleep(CHOICE_THINKING_MS);
        setIsLoading(false);
        if (onNavigate) onNavigate('provision');
        const msg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: 'Taking you to Naavik Provision where you can select and provision sites.',
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, msg]);
      })();
    }
  };

  const handleActionExecute = async (action: import('../types').ActionButton): Promise<import('../types').ExecutionStatus> => {
    const result = await api.executeAction(
      action.actionId,
      action.actionName,
      action.context
    );
    return {
      executionId: result.executionId,
      status: result.success ? 'completed' : 'failed',
      message: result.message,
      affectedSites: result.affectedSites,
      affectedCells: result.affectedCells,
      results: result.results,
      duration: result.duration,
    };
  };

  const streamConfig = STREAM_CONFIG[activeStream];
  // Always show the 4 default suggestions on welcome screen, regardless of context
  const suggestedQueries = DEFAULT_SUGGESTIONS;

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-ghost-bg dark:bg-transparent transition-colors duration-200">
      <input
        ref={attachmentInputRef}
        type="file"
        accept=".csv,text/csv,image/*"
        multiple
        className="hidden"
        onChange={handleAttachmentInputChange}
      />
      {/* Chat content - Left side (flex-1) */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
      {/* Chat Messages Area - min-h-0 allows flex child to shrink and scroll */}
      <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain">
        <div className={`w-full max-w-[860px] sm:max-w-[1000px] lg:max-w-[1200px] 2xl:max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8 xl:px-10 pt-6 pb-6 flex flex-col${messages.length === 0 ? ' min-h-full' : ''}`}>
          {messages.length === 0 ? (
            // Conditional rendering: Full welcome on homepage, minimal elsewhere
            currentView === 'home' ? (
              // HOMEPAGE: Full welcome screen with logo, title, and buttons
              <div className="flex flex-col items-center text-center flex-1 justify-center pt-4 pb-6 px-4 relative overflow-hidden">
                <FluidBackground theme={theme} className="absolute inset-0 rounded-xl" />
                {/* Logo */}
                <div className="w-20 h-20 mb-6 relative z-10 group">
                  <div className="absolute inset-0 bg-white/10 rounded-full blur-lg opacity-20 group-hover:opacity-35 transition duration-300" />
                  <img src="/aira-logo.png" alt="Aira" className="w-full h-full object-contain relative z-10 drop-shadow-2xl group-hover:scale-110 transition duration-300" />
                </div>

                {/* Title */}
                <h1 className="relative z-10 text-6xl md:text-7xl font-black text-text-primary dark:text-white mb-3 drop-shadow-lg animate-fade-in">
                  Aira Naavik
                </h1>

                {/* Subtitle */}
                <p className="relative z-10 text-lg md:text-xl text-text-secondary dark:text-gray-300 mb-16 leading-relaxed font-light tracking-wide animate-fade-in whitespace-nowrap" style={{ animationDelay: '0.2s' }}>
                  Your <span className="font-semibold text-text-primary dark:text-white">Agentic Network Co-Pilot</span>, converting Intent to Outcomes with Intelligence
                </p>

                {/* Centered Chat Input with Glassmorphism */}
                <form onSubmit={handleSubmit} className="relative z-10 w-full max-w-3xl mb-12 animate-fade-in" style={{ animationDelay: '0.4s' }}>
                  <div className="relative group">
                    {/* Input container - Compact design like Claude */}
                    <div
                      className="chat-input-box relative flex items-center gap-3 rounded-2xl px-4 py-3.5 transition-all duration-200"
                    >
                      {/* Attach (+) button removed for v1.0 — multi-modal not supported. */}

	                      {/* Saved Dashboards button */}
	                      <button
	                        type="button"
	                        onClick={() => {
	                          const msg: ChatMessage = {
	                            id: `saved-dashboards-${Date.now()}`,
	                            role: 'assistant',
	                            content: '',
	                            timestamp: new Date(),
	                            visualization: { type: 'saved_dashboards', data: {} },
	                          };
	                          setMessages((prev) => [...prev, msg]);
	                        }}
	                        className="flex-shrink-0 p-1.5 text-text-muted dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors rounded hover:bg-indigo-50 dark:hover:bg-indigo-500/10 relative"
	                        title="Saved Dashboards"
	                      >
	                        <LayoutDashboard className="w-5 h-5" />
	                        {savedDashboardsList.length > 0 && (
	                          <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-text-primary text-[8px] text-cream-surface dark:text-[#0A0A0A] font-bold flex items-center justify-center leading-none">
	                            {savedDashboardsList.length > 9 ? '9+' : savedDashboardsList.length}
	                          </span>
	                        )}
	                      </button>

	                      <textarea
	                        key={placeholderIndex}
	                        ref={inputRef as unknown as React.Ref<HTMLTextAreaElement>}
	                        value={inputValue}
	                        onChange={(e) => setInputValue(e.target.value)}
                        onPaste={handlePaste}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSubmit(e);
                          }
	                        }}
	                        placeholder={ACTION_TAGS[placeholderIndex].label}
	                        className="flex-1 bg-transparent text-text-primary dark:text-white placeholder-gray-500 dark:placeholder-gray-400 text-base font-semibold leading-6 focus:outline-none resize-none min-h-[48px] max-h-[120px] py-3 animate-placeholder-rotate text-left"
	                        disabled={isLoading}
	                        rows={1}
	                      />

                      {isLoading ? (
                        <button
                          type="button"
                          onClick={handleStopRequest}
                          title="Stop"
                          aria-label="Stop"
                          className="relative flex-shrink-0 p-2 rounded-lg bg-text-primary text-cream-surface dark:text-[#0A0A0A] hover:opacity-90 shadow-sm cursor-pointer active:scale-95 transition-all duration-200 transform"
                        >
                          <span className="pointer-events-none absolute inset-0 rounded-lg border-2 border-current border-t-transparent animate-spin opacity-70" aria-hidden />
                          <Square className="w-3.5 h-3.5 fill-current relative" strokeWidth={0} />
                        </button>
                      ) : (
                        <button
                          type="submit"
                          disabled={!inputValue.trim()}
                          className={`flex-shrink-0 p-2 rounded-lg transition-all duration-200 transform ${
                            !inputValue.trim()
                              ? 'text-text-muted dark:text-slate-500 cursor-not-allowed opacity-50'
                              : 'bg-text-primary text-cream-surface dark:text-[#0A0A0A] hover:opacity-90 shadow-sm cursor-pointer active:scale-95'
                          }`}
                          title="Send"
                        >
                          <Send className="w-5 h-5" />
                        </button>
                      )}
	                    </div>
	                    {(pendingAttachments.length > 0 || attachmentError) && (
	                      <div className="mt-2 space-y-1 text-left">
	                        {pendingAttachments.length > 0 && (
	                          <div className="flex flex-wrap gap-2">
	                            {pendingAttachments.map((att) => (
	                              <div
	                                key={att.id}
	                                className="flex items-center gap-2 rounded-full border border-slate-200/80 dark:border-white/12 bg-white/85 dark:bg-white/6 px-3 py-1.5 text-xs text-text-secondary dark:text-slate-200 shadow-sm"
	                                title={att.kind === 'csv' && att.text ? buildCsvPreview(att.text.slice(0, 4000)) : att.name}
	                              >
	                                {att.kind === 'image' ? (
	                                  <span className="inline-flex items-center gap-1">
	                                    {att.dataUrl ? (
	                                      <img src={att.dataUrl} alt="" className="w-4 h-4 rounded object-cover" />
	                                    ) : (
	                                      <ImageIcon className="w-4 h-4" />
	                                    )}
	                                    <span className="max-w-[220px] truncate">{att.name}</span>
	                                  </span>
	                                ) : (
	                                  <span className="inline-flex items-center gap-1">
	                                    <FileText className="w-4 h-4" />
	                                    <span className="max-w-[220px] truncate">{att.name}</span>
	                                  </span>
	                                )}
	                                <span className="text-text-muted dark:text-slate-400">{formatBytes(att.sizeBytes)}</span>
	                                <button
	                                  type="button"
	                                  onClick={() => removePendingAttachment(att.id)}
	                                  className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-white/10 text-text-muted hover:text-slate-700 dark:hover:text-white transition"
	                                  title="Remove"
	                                >
	                                  <X className="w-3.5 h-3.5" />
	                                </button>
	                              </div>
	                            ))}
	                          </div>
	                        )}
	                        {attachmentError && (
	                          <div className="text-xs text-red-600 dark:text-red-400">{attachmentError}</div>
	                        )}
	                      </div>
	                    )}
	                  </div>
	                </form>

                {/* Action Buttons - Horizontal Pill Layout */}
                <div className="relative z-10 flex flex-wrap gap-2 w-full max-w-3xl justify-center animate-fade-in" style={{ animationDelay: '0.6s' }}>
                  {suggestedQueries.map((question, index) => {
                    const icons = [Eye, Code2, BookOpen, Zap];
                    const Icon = icons[index] || ArrowRight;

                    return (
                      <button
                        key={index}
                        onClick={() => handleSuggestionClick(question)}
                        disabled={isLoading}
                        className="group relative flex items-center gap-2 px-4 py-2.5 rounded-full border border-white/15 bg-white/7 hover:bg-white/12 hover:border-white/25 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white/7 disabled:hover:border-white/15"
                      >
                        <Icon className="w-4 h-4 text-white/55 group-hover:text-white/80 transition-colors" />
                        <span className="text-xs font-medium text-white/55 group-hover:text-white/80 whitespace-nowrap transition-colors">
                          {question}
                        </span>
                      </button>
                    );
                  })}
                </div>

              </div>
            ) : (
              // OTHER PAGES: Minimal chat interface with just input and logo
              <div className="flex flex-col items-center justify-center flex-1 px-4 py-8 gap-6">
                {/* Aira Logo - Small */}
                <img src="/aira-logo.png" alt="Aira" className="w-8 h-8 opacity-60" />

                {/* Chat Input - Focused and minimal */}
                <form onSubmit={handleSubmit} className="w-full max-w-xl">
                  <div className="chat-input-box relative flex items-start gap-3 rounded-xl px-4 py-3 transition-all duration-200">
                    <textarea
                      key={placeholderIndex}
                      ref={inputRef as unknown as React.Ref<HTMLTextAreaElement>}
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                        onPaste={handlePaste}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSubmit(e);
                        }
                      }}
                      placeholder="Ask about your network..."
                      className="flex-1 bg-transparent text-text-primary dark:text-white placeholder-gray-500 dark:placeholder-gray-400 text-sm focus:outline-none resize-none min-h-[40px] max-h-[100px] font-medium"
                      disabled={isLoading}
                      rows={1}
                    />

                    {isLoading ? (
                      <button
                        type="button"
                        onClick={handleStopRequest}
                        title="Stop"
                        aria-label="Stop"
                        className="relative flex-shrink-0 p-2 rounded-lg bg-text-primary text-cream-surface dark:text-[#0A0A0A] hover:opacity-90 hover:shadow-md cursor-pointer active:scale-95 transition-all duration-200"
                      >
                        <span className="pointer-events-none absolute inset-0 rounded-lg border-2 border-current border-t-transparent animate-spin opacity-70" aria-hidden />
                        <Square className="w-3 h-3 fill-current relative" strokeWidth={0} />
                      </button>
                    ) : (
                      <button
                        type="submit"
                        disabled={!inputValue.trim()}
                        className={`flex-shrink-0 p-2 rounded-lg transition-all duration-200 ${
                          !inputValue.trim()
                            ? 'bg-slate-200/60 dark:bg-gray-700/30 text-text-muted dark:text-gray-600 cursor-not-allowed'
                            : 'bg-text-primary text-cream-surface dark:text-[#0A0A0A] hover:opacity-90 hover:shadow-md cursor-pointer active:scale-95'
                        }`}
                        title="Send"
                      >
                        <Send className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </form>
              </div>
            )
          ) : (
            // Messages
            <div className="space-y-4 lg:space-y-5">
              {messages.map((message, idx) => {
                const lastIdx = messages.length - 1;
                const lastMsg = messages[lastIdx];
                // If the last assistant message renders a tall payload
                // (dashboard / diagnosis card / multi-tab report / grid /
                // long RCA story), anchor the SCROLL on that message so the
                // user lands at its TOP — header + filters first, charts
                // below as they scroll down. Otherwise fall back to the
                // existing behaviour (anchor on the user's question above).
                const lastIsTall = isTallAssistantMessage(lastMsg);
                const scrollTargetIdx = lastIsTall
                  ? lastIdx
                  : (lastMsg?.role === 'assistant' && lastIdx > 0 && messages[lastIdx - 1]?.role === 'user'
                    ? lastIdx - 1
                    : lastIdx);
                return (
                  <div
                    key={message.id}
                    ref={idx === scrollTargetIdx ? lastAnswerRef : undefined}
                    data-tall-anchor={idx === scrollTargetIdx && lastIsTall ? 'true' : undefined}
                    style={{ scrollMarginTop: '1rem' }}
                  >
                    <ChatMessageComponent
                      message={message}
                      onActionExecute={handleActionExecute}
                      onChoiceClick={handleChoiceClick}
                      onRowAction={handleRowAction}
                      onOpenSavedDashboard={(db) => {
                        const msg: ChatMessage = {
                          id: `${Date.now() + 1}`,
                          role: 'assistant',
                          content: `**Observation Agent** » Opening saved dashboard: **${db.name}**`,
                          timestamp: new Date(),
                          visualization: {
                            type: 'chat_kpi_dashboard',
                            data: {
                              siteId: db.siteIds[0],
                              availableSiteIds: db.siteIds,
                              endDate: db.endDate,
                              kpiNames: db.kpiNames,
                              timeframe: db.timeframe,
                              daysBack: db.daysBack,
                            },
                          },
                        };
                        setMessages((prev) => [...prev, msg]);
                      }}
                      onOpenQueryDashboard={(qdb) => {
                        const msg: ChatMessage = {
                          id: `${Date.now() + 1}`,
                          role: 'assistant',
                          content: `**Dashboard** » ${qdb.name}`,
                          timestamp: new Date(),
                          visualization: {
                            type: 'open_query_dashboard',
                            data: { blocks: qdb.blocks, name: qdb.name },
                          },
                        };
                        setMessages((prev) => [...prev, msg]);
                      }}
                    />
                  </div>
                );
              })}
              
              {/* Live agent activity (SSE) — shows running tool calls.
                  When SSE is active this REPLACES the legacy TypingIndicator
                  so we don't double up loading UIs. */}
              {(agentStream.isStreaming || agentStream.activityItems.length > 0) ? (
                <AgentActivityCard
                  items={agentStream.activityItems}
                  isStreaming={agentStream.isStreaming}
                  stalled={agentStream.stalled}
                  progressMessage={agentStream.progressMessage}
                />
              ) : (
                isLoading && <TypingIndicator />
              )}

              {/* Clarification card — pauses the chat until the user answers. */}
              {agentStream.clarification && (
                <ClarificationCard
                  clarification={agentStream.clarification}
                  onAnswer={agentStream.answerClarification}
                />
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </div>

      {/* Fixed Input Bar + Action tags + Feedback */}
      {messages.length > 0 && (
      <div className="shrink-0 pt-1">
        <div className="w-full max-w-[860px] sm:max-w-[1000px] lg:max-w-[1200px] 2xl:max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8 xl:px-10 py-3 pb-4 space-y-2.5">
          {/* Intent feedback banner - only for errors/incomplete, not success */}
          {feedback && feedback !== 'success' && (
            <div
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm ${
                feedback === 'incomplete'
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                  : 'bg-red-500/10 border-red-500/30 text-red-300'
              }`}
            >
              {feedback === 'incomplete' && <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
              {feedback === 'error' && <XCircle className="w-4 h-4 flex-shrink-0" />}
              <span className="text-xs">
                {feedback === 'incomplete' && 'Intent unclear — please clarify what you want to achieve.'}
                {feedback === 'error' && 'Something went wrong. Try rephrasing your request.'}
              </span>
            </div>
          )}

	          <div className="flex gap-2 items-center">
	            <form onSubmit={handleSubmit} className="relative flex-1">
	              {(pendingAttachments.length > 0 || attachmentError) && (
	                <div className="mb-2 space-y-1">
	                  {pendingAttachments.length > 0 && (
	                    <div className="flex flex-wrap gap-2">
	                      {pendingAttachments.map((att) => (
	                        <div
	                          key={att.id}
	                          className="flex items-center gap-2 rounded-full border border-slate-200/80 dark:border-white/12 bg-white/85 dark:bg-white/6 px-3 py-1.5 text-xs text-text-secondary dark:text-slate-200 shadow-sm"
	                          title={att.kind === 'csv' && att.text ? buildCsvPreview(att.text.slice(0, 4000)) : att.name}
	                        >
	                          {att.kind === 'image' ? (
	                            <span className="inline-flex items-center gap-1">
	                              {att.dataUrl ? (
	                                <img src={att.dataUrl} alt="" className="w-4 h-4 rounded object-cover" />
	                              ) : (
	                                <ImageIcon className="w-4 h-4" />
	                              )}
	                              <span className="max-w-[220px] truncate">{att.name}</span>
	                            </span>
	                          ) : (
	                            <span className="inline-flex items-center gap-1">
	                              <FileText className="w-4 h-4" />
	                              <span className="max-w-[220px] truncate">{att.name}</span>
	                            </span>
	                          )}
	                          <span className="text-text-muted dark:text-slate-400">{formatBytes(att.sizeBytes)}</span>
	                          <button
	                            type="button"
	                            onClick={() => removePendingAttachment(att.id)}
	                            className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-white/10 text-text-muted hover:text-slate-700 dark:hover:text-white transition"
	                            title="Remove"
	                          >
	                            <X className="w-3.5 h-3.5" />
	                          </button>
	                        </div>
	                      ))}
	                    </div>
	                  )}
	                  {attachmentError && (
	                    <div className="text-xs text-red-600 dark:text-red-400">{attachmentError}</div>
	                  )}
	                </div>
	              )}
	            <div className="chat-input-box flex items-center gap-3 rounded-2xl px-4 py-4 transition-all duration-200">
	              {/* Attach (+) button removed for v1.0 — multi-modal not supported. */}
	              <button
	                type="button"
	                onClick={() => {
	                  const msg: ChatMessage = {
	                    id: `saved-dashboards-${Date.now()}`,
	                    role: 'assistant',
	                    content: '',
	                    timestamp: new Date(),
	                    visualization: { type: 'saved_dashboards', data: {} },
	                  };
	                  setMessages((prev) => [...prev, msg]);
	                }}
	                className="flex-shrink-0 p-1.5 text-text-muted dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors rounded hover:bg-indigo-50 dark:hover:bg-indigo-500/10 relative"
	                title="Saved Dashboards"
	              >
	                <LayoutDashboard className="w-5 h-5" />
	                {savedDashboardsList.length > 0 && (
	                  <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-text-primary text-[8px] text-cream-surface dark:text-[#0A0A0A] font-bold flex items-center justify-center leading-none">
	                    {savedDashboardsList.length > 9 ? '9+' : savedDashboardsList.length}
	                  </span>
	                )}
	              </button>
	              <textarea
	                key={placeholderIndex}
	                ref={inputRef as unknown as React.Ref<HTMLTextAreaElement>}
	                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                        onPaste={handlePaste}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e);
                  }
                }}
                placeholder={messages.length === 0 && inputValue.length === 0 && currentView === 'home' ? ACTION_TAGS[placeholderIndex].label : streamConfig.placeholder}
                className="flex-1 bg-transparent text-text-primary dark:text-text-primary placeholder-text-muted dark:placeholder-text-muted text-base leading-6 focus:outline-none resize-none min-h-[48px] max-h-[120px] py-3 animate-placeholder-rotate"
                disabled={isLoading}
                rows={1}
              />

              <div className="flex items-center space-x-2 ml-3">
                {isLoading ? (
                  <button
                    type="button"
                    onClick={handleStopRequest}
                    title="Stop"
                    aria-label="Stop"
                    className="relative p-2 rounded-full bg-text-primary text-cream-surface dark:text-[#0A0A0A] hover:opacity-90 cursor-pointer shadow-sm active:scale-95 transition-all duration-150"
                  >
                    <span className="pointer-events-none absolute inset-0 rounded-full border-2 border-current border-t-transparent animate-spin opacity-70" aria-hidden />
                    <Square className="w-3.5 h-3.5 fill-current relative" strokeWidth={0} />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!inputValue.trim()}
                    className={`p-2 rounded-full transition-all duration-150 ${
                      !inputValue.trim()
                        ? 'bg-slate-200/60 dark:bg-white/8 text-text-muted dark:text-slate-500 cursor-not-allowed'
                        : 'bg-text-primary text-cream-surface dark:text-[#0A0A0A] hover:opacity-90 cursor-pointer shadow-sm active:scale-95'
                    }`}
                    title="Send"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                )}

                <div className={`w-2 h-2 rounded-full ${isLoading ? 'bg-warning-600 animate-pulse' : 'bg-emerald-600'}`} aria-hidden />

                {messages.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearChat}
                    disabled={isLoading}
                    className="p-2 text-text-muted dark:text-text-muted hover:text-red-500 dark:hover:text-red-400 transition rounded-full hover:bg-slate-700/50 dark:hover:bg-slate-800-light disabled:opacity-50"
                    title="Clear chat"
                  >
                    <RotateCcw className="w-5 h-5" />
                  </button>
                )}
              </div>
            </div>
          </form>
          </div>

        </div>
      </div>
      )}
      </div>

      {/* Right side - Recent Activity Panel - HIDDEN (moved to left sidebar) */}
      <div className={`hidden border-l border-slate-700/70 dark:border-slate-700/70 bg-slate-800 dark:bg-slate-900 transition-all duration-300 overflow-hidden flex flex-col`}>
        {/* Toggle Button */}
        <div className="shrink-0 flex items-center justify-center h-16 border-b border-slate-700/70 dark:border-slate-700/70">
          <button
            onClick={() => setShowActivityPanel(!showActivityPanel)}
            className="flex items-center justify-center w-10 h-10 rounded-lg hover:bg-slate-700/30 dark:hover:bg-slate-800 transition text-text-secondary dark:text-text-secondary hover:text-text-primary dark:hover:text-text-primary"
            title={showActivityPanel ? 'Hide recent activity' : 'Show recent activity'}
            aria-label="Toggle activity panel"
          >
            {showActivityPanel ? (
              <ChevronDown className="w-5 h-5 rotate-90" />
            ) : (
              <ChevronDown className="w-5 h-5 -rotate-90" />
            )}
          </button>
        </div>

        {/* Activity Content */}
        {showActivityPanel && (
          <div className="flex-1 overflow-y-auto min-h-0 px-3 py-4 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-text-secondary dark:text-text-secondary px-2 py-2">
              Recent Activity
            </div>

            {messages.length === 0 ? (
              <p className="text-xs text-text-muted dark:text-text-muted px-2 py-3">
                No messages yet. Start chatting to see activity.
              </p>
            ) : (
              <div className="space-y-2">
                {messages.slice().reverse().slice(0, 10).map((msg, _idx) => (
                  <div
                    key={msg.id}
                    className="group p-2.5 rounded-lg bg-slate-700/30 dark:bg-slate-800/50 hover:bg-slate-700/50 dark:hover:bg-slate-800 border border-slate-700/50 dark:border-slate-700/30 hover:border-slate-700 dark:hover:border-slate-700 transition cursor-pointer"
                    onClick={() => {
                      // Could scroll to message or perform other action
                      if (msg.role === 'assistant') {
                        msg.id && scrollToBottom('smooth');
                      }
                    }}
                  >
                    <div className="flex items-start gap-2">
                      <div
                        className={`flex-shrink-0 w-2 h-2 rounded-full mt-1.5 ${
                          msg.role === 'user'
                            ? 'bg-sky-500'
                            : 'bg-emerald-600'
                        }`}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-text-primary dark:text-text-primary mb-1 capitalize">
                          {msg.role}
                        </p>
                        <p className="text-xs text-text-secondary dark:text-text-secondary line-clamp-2 break-words">
                          {msg.content || (msg.visualization?.type === 'kpi_dashboard' ? '📊 KPI Dashboard' : msg.visualization?.type === 'map_inset' ? '🗺️ Network Map' : msg.visualization?.type === 'knowledge_report' ? '📚 Knowledge Report' : msg.visualization?.type === 'rca_story' ? '🔍 RCA Analysis' : 'Visualization')}
                        </p>
                        <p className="text-xs text-text-muted dark:text-text-muted mt-1">
                          {new Date(msg.timestamp).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>


      {currentView === 'home' && showHomeIntroModal && (
        <div className={`absolute inset-0 z-40 flex items-center justify-center px-4 sm:px-6 backdrop-blur-[18px] ${theme === 'dark' ? 'bg-black/82' : 'bg-black/38'}`}>
          <div className={`relative w-full max-w-6xl min-h-[460px] md:min-h-[520px] rounded-3xl backdrop-blur-2xl overflow-hidden intro-modal-fade-in ${theme === 'dark' ? 'bg-[#1e1e1e]/92 shadow-[0_30px_80px_rgba(0,0,0,0.60)]' : 'bg-cream-surface/[0.96] shadow-[0_30px_80px_rgba(80,60,20,0.22)]'}`}>
            <div className="absolute inset-0 opacity-60 dark:opacity-70 pointer-events-none intro-modal-gradient-shift" />
            <div className="absolute inset-0 opacity-45 dark:opacity-60 pointer-events-none">
              <div className="h-[2px] w-full bg-gradient-to-r from-transparent via-red-400/70 to-transparent intro-modal-scanline" />
            </div>
            <div className="px-5 py-8 md:px-8 md:py-12 intro-future-modal">
              <div className="intro-future-head">
                <img
                  src="/naavik-full-logo-transparent.png"
                  alt="Aira Naavik"
                  className="intro-future-logo"
                />
                <div className="intro-future-title-pill">Welcome to the Future of Network Operations</div>
              </div>

              <div className="intro-future-step-rail">
                <div className="intro-future-step-track" aria-hidden>
                  <span className="intro-future-travel-dot" />
                </div>
                <div className="intro-future-step-grid">
                  {INTRO_FUTURE_STEPS.map((step) => (
                    <div className="intro-future-step" key={step.id}>
                      {'stepNumber' in step && (
                        <span className="intro-future-step-index">{step.stepNumber}</span>
                      )}
                      <div className="intro-future-step-icon">
                        <step.Icon className="w-5 h-5" />
                      </div>
                      <span className="intro-future-step-label">{step.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="intro-future-duo-copy">
                Naavik AI Agent Orchestra - a Multi Agent Intelligence System to drive operators from intent to outcome
              </div>

              <div className="intro-future-cta-wrap">
                <button type="button" className="intro-future-enter-btn" onClick={dismissHomeIntroModal}>
                  Enter Naavik
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={dismissHomeIntroModal}
              className="absolute top-4 right-4 z-[50] rounded-lg p-2 text-text-muted hover:text-slate-700 hover:bg-slate-900/5 dark:text-white/80 dark:hover:text-white dark:hover:bg-white/10 transition"
              aria-label="Close intro"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
