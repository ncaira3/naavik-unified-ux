import { useState, useEffect, useRef } from 'react';
import {
  CheckCircle,
  Loader2,
  Play,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Info,
  X,
  Activity
} from 'lucide-react';
import api from '../services/api';
import { usePlatformBus } from '../platform/PlatformBusContext';
import type { ProvisioningCandidateSite } from '../types';

// Fallback dummy sites used when backend returns no candidates (e.g. dummifier off)
const DUMMY_PROVISIONING_CANDIDATES: ProvisioningCandidateSite[] = [
  { siteId: 'SITE_NEW_0001', siteName: 'Planned Site 0001', latitude: 37.5935, longitude: -122.0522, quarter: 'Q1', status: 'READY', anchorSiteA: '9817', anchorSiteB: '9818', technology: '4G+5G', bandPlan: 'N41+N71', oem: 'Ericsson', softwareVersion: '26Q1' },
  { siteId: 'SITE_NEW_0002', siteName: 'Planned Site 0002', latitude: 37.6012, longitude: -122.0634, quarter: 'Q1', status: 'READY', anchorSiteA: '9818', anchorSiteB: '9820', technology: '4G+5G', bandPlan: 'N41+N71', oem: 'Ericsson', softwareVersion: '26Q1' },
  { siteId: 'SITE_NEW_0003', siteName: 'Planned Site 0003', latitude: 37.5878, longitude: -122.0410, quarter: 'Q1', status: 'READY', anchorSiteA: '9820', anchorSiteB: '9821', technology: '5G', bandPlan: 'N41', oem: 'Nokia', softwareVersion: '26Q1' },
  { siteId: 'SITE_NEW_0004', siteName: 'Planned Site 0004', latitude: 37.6089, longitude: -122.0298, quarter: 'Q2', status: 'READY', anchorSiteA: '9821', anchorSiteB: '9822', technology: '4G+5G', bandPlan: 'N71+B13', oem: 'Ericsson', softwareVersion: '26Q1' },
  { siteId: 'SITE_NEW_0005', siteName: 'Planned Site 0005', latitude: 37.5810, longitude: -122.0556, quarter: 'Q2', status: 'READY', anchorSiteA: '9822', anchorSiteB: '9817', technology: '4G+5G', bandPlan: 'N41+N71', oem: 'Nokia', softwareVersion: '26Q1' },
  { siteId: 'SITE_NEW_0006', siteName: 'Planned Site 0006', latitude: 37.5750, longitude: -122.0670, quarter: 'Q2', status: 'READY', anchorSiteA: '9817', anchorSiteB: '9820', technology: '5G', bandPlan: 'N41', oem: 'Ericsson', softwareVersion: '26Q1' },
  { siteId: 'SITE_NEW_0007', siteName: 'Planned Site 0007', latitude: 37.6150, longitude: -122.0480, quarter: 'Q3', status: 'READY', anchorSiteA: '9820', anchorSiteB: '9822', technology: '4G+5G', bandPlan: 'N41+N71', oem: 'Ericsson', softwareVersion: '26Q2' },
  { siteId: 'SITE_NEW_0008', siteName: 'Planned Site 0008', latitude: 37.5690, longitude: -122.0385, quarter: 'Q3', status: 'READY', anchorSiteA: '9821', anchorSiteB: '9818', technology: '4G+5G', bandPlan: 'N71+B13', oem: 'Nokia', softwareVersion: '26Q2' },
  { siteId: 'SITE_NEW_0009', siteName: 'Planned Site 0009', latitude: 37.6200, longitude: -122.0600, quarter: 'Q4', status: 'READY', anchorSiteA: '9818', anchorSiteB: '9821', technology: '5G', bandPlan: 'N41', oem: 'Ericsson', softwareVersion: '26Q2' },
  { siteId: 'SITE_NEW_0010', siteName: 'Planned Site 0010', latitude: 37.5630, longitude: -122.0730, quarter: 'Q4', status: 'READY', anchorSiteA: '9822', anchorSiteB: '9820', technology: '4G+5G', bandPlan: 'N41+N71', oem: 'Nokia', softwareVersion: '26Q2' },
];

interface Site {
  siteId: string;
  siteName: string;
  latitude: number;
  longitude: number;
  quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4';
  zone: string;
  area: string;
  technology: string;
  band: string;
  softwareVersion: string;
  oemVendor: string;
  status: 'Planned' | 'InProgress' | 'Provisioned' | 'Monitoring' | 'Failed';
}

interface ProvisioningStep {
  id: string;
  name: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  progress?: number;
  subTasks?: Array<{ name: string; progress: number }>;
  files?: Array<{ name: string; status: 'completed' | 'failed' | 'pending' }>;
  logs?: string[];
  errorMessage?: string;
}

interface SiteProvisioningState {
  siteId: string;
  steps: ProvisioningStep[];
  status: Site['status'];
}

interface RecentlyProvisionedSite {
  siteId: string;
  siteName: string;
  latitude?: number;
  longitude?: number;
  quarter: Site['quarter'];
  zone: string;
  technology: string;
  band: string;
  status: 'Provisioned' | 'Monitoring';
  provisionedAt: string;
}

interface LogModal {
  isOpen: boolean;
  title: string;
  content: string[];
}

interface CancelModalState {
  isOpen: boolean;
  siteIds: string[];
}

function candidateToSite(candidate: ProvisioningCandidateSite): Site {
  return {
    siteId: candidate.siteId,
    siteName: candidate.siteName,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    quarter: candidate.quarter,
    zone: 'Planned Zone',
    area: 'Expansion',
    technology: candidate.technology,
    band: candidate.bandPlan,
    softwareVersion: candidate.softwareVersion,
    oemVendor: candidate.oem,
    status: 'Planned',
  };
}

function readProvisioningQueue(): ProvisioningCandidateSite[] {
  const raw = localStorage.getItem('provisioning_queue_v1');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const RECENT_PROVISIONED_KEY = 'ztp_recent_provisioned_v1';

function readRecentProvisionedSites(): RecentlyProvisionedSite[] {
  const raw = localStorage.getItem(RECENT_PROVISIONED_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function upsertRecentProvisionedSites(records: RecentlyProvisionedSite[]) {
  if (!records.length) return;
  const existing = readRecentProvisionedSites();
  const bySite = new Map<string, RecentlyProvisionedSite>();
  existing.forEach((r) => bySite.set(r.siteId, r));
  records.forEach((r) => bySite.set(r.siteId, r));
  const merged = Array.from(bySite.values()).sort((a, b) => b.provisionedAt.localeCompare(a.provisionedAt));
  localStorage.setItem(RECENT_PROVISIONED_KEY, JSON.stringify(merged.slice(0, 500)));
}

export default function ProvisioningView() {
  const { publish, subscribe } = usePlatformBus();
  const [activeTab, setActiveTab] = useState<'provision' | 'recent'>('provision');
  const [selectedSites, setSelectedSites] = useState<Set<string>>(new Set());
  const [isProvisioning, setIsProvisioning] = useState(false);
  const [initialSites, setInitialSites] = useState<ProvisioningCandidateSite[]>([]);
  const [autoMonitor, setAutoMonitor] = useState(true);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [logModal, setLogModal] = useState<LogModal>({ isOpen: false, title: '', content: [] });
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedQuarter, setSelectedQuarter] = useState<'ALL' | 'Q1' | 'Q2' | 'Q3' | 'Q4'>('Q1');
  const [isLoadingSites, setIsLoadingSites] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [bulkMode, setBulkMode] = useState(initialSites.length === 0);
  const [showLoadAllSelector, setShowLoadAllSelector] = useState(false);
  const [cancelModal, setCancelModal] = useState<CancelModalState>({ isOpen: false, siteIds: [] });
  const [showProgressPanel, setShowProgressPanel] = useState(false);
  const provisioningIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recentSyncRef = useRef<string>('');
  const [queueCount, setQueueCount] = useState(0);
  const [recentProvisionedSites, setRecentProvisionedSites] = useState<RecentlyProvisionedSite[]>([]);

  const [siteProvisioningStates, setSiteProvisioningStates] = useState<Map<string, SiteProvisioningState>>(new Map());
  const [expandedSiteCards, setExpandedSiteCards] = useState<Set<string>>(new Set());
  const ongoingSiteIds = Array.from(siteProvisioningStates.entries())
    .filter(([, state]) => state.status === 'InProgress')
    .map(([siteId]) => siteId);
  const isProvisioningLocked = isProvisioning || ongoingSiteIds.length > 0;
  const canShowProgress = activeTab === 'provision' && showProgressPanel;

  useEffect(() => {
    if (isProvisioning) {
      setShowProgressPanel(true);
    }
  }, [isProvisioning]);

  useEffect(() => {
    if (initialSites.length === 0) return;
    const mapped = initialSites.map(candidateToSite);
    setSites(mapped);
    setSelectedSites(new Set(mapped.map((s) => s.siteId)));
    setExpandedSiteCards(new Set([mapped[0].siteId]));
    setBulkMode(false);
    setShowLoadAllSelector(false);
    if (mapped.length > 0) {
      publish({ type: 'MAP_PROVISIONING_LAYER_ENABLED' });
    }
  }, [initialSites, publish]);

  useEffect(() => {
    setQueueCount(readProvisioningQueue().length);
    setRecentProvisionedSites(readRecentProvisionedSites());
  }, [initialSites]);

  useEffect(() => {
    if (!bulkMode) return;
    let cancelled = false;
    const loadDefault = async () => {
      try {
        setIsLoadingSites(true);
        const response = await api.getProvisioningCandidates(selectedQuarter, undefined, 3);
        if (!cancelled) {
          let candidates = response.success ? (response.data?.candidates ?? []) : [];
          // Fall back to demo sites when backend returns nothing (e.g. dummifier off)
          if (candidates.length === 0) {
            candidates = selectedQuarter === 'ALL'
              ? DUMMY_PROVISIONING_CANDIDATES
              : DUMMY_PROVISIONING_CANDIDATES.filter(c => c.quarter === selectedQuarter);
          }
          setSites(candidates.map(candidateToSite));
          setSelectedSites(new Set());
          setSiteProvisioningStates(new Map());
          setExpandedSiteCards(new Set());
        }
      } catch {
        if (!cancelled) {
          const fallback = selectedQuarter === 'ALL'
            ? DUMMY_PROVISIONING_CANDIDATES
            : DUMMY_PROVISIONING_CANDIDATES.filter(c => c.quarter === selectedQuarter);
          setSites(fallback.map(candidateToSite));
        }
      } finally {
        if (!cancelled) setIsLoadingSites(false);
      }
    };
    loadDefault();
    return () => {
      cancelled = true;
    };
  }, [selectedQuarter, reloadToken, bulkMode]);

  const handleLoadAllSites = () => {
    setShowLoadAllSelector((prev) => !prev);
  };

  const handleLoadQuarterList = () => {
    setBulkMode(true);
    setShowLoadAllSelector(false);
    setReloadToken((v) => v + 1);
  };

  const handleLoadQueue = () => {
    if (isProvisioningLocked) return;
    const queued = readProvisioningQueue();
    if (!queued.length) return;
    const mapped = queued.map(candidateToSite);
    setBulkMode(false);
    setShowLoadAllSelector(false);
    setSites(mapped);
    setSelectedSites(new Set(mapped.map((s) => s.siteId)));
    setSiteProvisioningStates(new Map());
    setExpandedSiteCards(new Set(mapped.length ? [mapped[0].siteId] : []));
    setQueueCount(mapped.length);
  };

  // Keep left table in sync with provisioning state (Monitoring, Provisioned, Failed)
  useEffect(() => {
    const finalStatuses = new Map<string, Site['status']>();
    siteProvisioningStates.forEach((state, siteId) => {
      if (state.status === 'Failed' || state.status === 'Provisioned' || state.status === 'Monitoring') {
        finalStatuses.set(siteId, state.status);
      }
    });
    if (finalStatuses.size === 0) return;
    setSites(prev => prev.map(site => {
      const status = finalStatuses.get(site.siteId);
      return status ? { ...site, status } : site;
    }));
  }, [siteProvisioningStates]);

  useEffect(() => {
    const now = new Date().toISOString();
    const completed = sites
      .filter((s) => s.status === 'Provisioned' || s.status === 'Monitoring')
      .map((s) => ({
        siteId: s.siteId,
        siteName: s.siteName,
        latitude: s.latitude,
        longitude: s.longitude,
        quarter: s.quarter,
        zone: s.zone,
        technology: s.technology,
        band: s.band,
        status: s.status as 'Provisioned' | 'Monitoring',
        provisionedAt: now,
      }));
    const signature = completed
      .map((c) => `${c.siteId}:${c.status}`)
      .sort()
      .join('|');
    if (completed.length && signature !== recentSyncRef.current) {
      recentSyncRef.current = signature;
      upsertRecentProvisionedSites(completed);
      setRecentProvisionedSites(readRecentProvisionedSites());
    }
  }, [sites]);

  const createInitialSteps = (siteId: string): ProvisioningStep[] => {
    const numericPart = parseInt(siteId.replace(/\D/g, '').slice(-2) || '0', 10);
    const hasConnectivityIssue = numericPart % 11 === 0;
    
    return [
      { 
        id: 'ciq-ingestion', 
        name: 'CIQ Ingestion', 
        status: 'pending',
        logs: ['📥 Starting CIQ data ingestion...', 'Connecting to CIQ repository', 'Parsing site configuration data']
      },
      { 
        id: 'ciq-validation', 
        name: 'CIQ Validation', 
        status: 'pending',
        logs: ['✓ Validating CIQ data structure', '✓ Checking required parameters', '✓ Verifying site coordinates']
      },
      { 
        id: 'config-generation', 
        name: 'Config Generation', 
        status: 'pending',
        subTasks: [{ name: 'Script Generation', progress: 0 }],
        files: [
          { name: '01_SiteBasic_CarrierAdd_NR_3GPP.xml', status: 'pending' },
          { name: '02_SiteEquipment_CarrierAdd_NR_3GPP.xml', status: 'pending' },
          { name: '03_TN_NR_Template_3GPP.xml', status: 'pending' },
          { name: '04_RN_GNBCUCP_5G.xml', status: 'pending' },
          { name: '05_RN_NRCELL_5G.xml', status: 'pending' },
        ],
      },
      { 
        id: 'enm-access', 
        name: 'EIAP access', 
        status: 'pending',
        logs: ['🔐 Establishing EIAP connection...', 'Authenticating with EIAP server']
      },
      { 
        id: 'site-config-pre-checks', 
        name: 'Site Config pre checks', 
        status: 'pending',
        logs: ['✓ Executing pre-checks', '✓ Node sync verification', '✓ Cell status check']
      },
      { 
        id: 'site-provisioning', 
        name: 'Site Provisioning', 
        status: 'pending',
        logs: ['📤 Uploading configuration...', 'Executing provisioning jobs']
      },
      { 
        id: 'parameters-audit', 
        name: 'Parameters Audit', 
        status: 'pending',
        logs: ['🔍 Auditing parameters...']
      },
      { 
        id: 'features-audit', 
        name: 'Features Audit', 
        status: 'pending',
        logs: ['🔍 Auditing features...']
      },
      { 
        id: 'config-validation', 
        name: 'Config Validation', 
        status: 'pending',
        logs: ['✓ Validating configuration...']
      },
      { 
        id: 'post-site-config-check', 
        name: 'Post Site Config Check', 
        status: 'pending',
        logs: hasConnectivityIssue 
          ? ['🧪 Running post-config tests...', '❌ Site connectivity check failed'] 
          : ['🧪 Running post-config tests...', '✓ All checks passed'],
        errorMessage: hasConnectivityIssue 
          ? `Site ${siteId} connectivity error: Unable to reach base station. Network timeout after 30s.` 
          : undefined
      },
      { 
        id: 'site-onair', 
        name: 'Site OnAir', 
        status: 'pending',
        logs: ['✓ Site activation complete', '✓ Ready for traffic']
      },
    ];
  };

  const handleToggleSite = (siteId: string) => {
    setSelectedSites(prev => {
      const newSet = new Set(prev);
      if (newSet.has(siteId)) {
        newSet.delete(siteId);
      } else {
        newSet.add(siteId);
      }
      return newSet;
    });
  };

  const handleStartZTP = () => {
    if (selectedSites.size === 0 || isProvisioningLocked) return;
    setActiveTab('provision');
    setShowProgressPanel(true);
    setIsProvisioning(true);
    
    // Initialize provisioning states for all selected sites
    const newStates = new Map<string, SiteProvisioningState>();
    selectedSites.forEach(siteId => {
      newStates.set(siteId, {
        siteId,
        steps: createInitialSteps(siteId),
        status: 'InProgress'
      });
    });
    setSiteProvisioningStates(newStates);

    // Auto-expand the first selected site card
    setExpandedSiteCards(new Set([Array.from(selectedSites)[0]]));

    // Update site statuses
    setSites(prev => prev.map(site => 
      selectedSites.has(site.siteId) ? { ...site, status: 'InProgress' } : site
    ));
    
    // Build a randomized schedule per site: each site gets a random start delay
    // and each step takes 2-5 ticks (simulating real NE script execution times).
    const numSteps = 11;
    const siteSchedules = new Map<string, number[]>();
    selectedSites.forEach(siteId => {
      const startDelay = Math.floor(Math.random() * 4); // 0-3 tick delay
      const schedule: number[] = [];
      let t = startDelay;
      for (let i = 0; i < numSteps; i++) {
        schedule.push(t);
        t += 1 + Math.floor(Math.random() * 2); // each step takes 1-2 ticks
      }
      siteSchedules.set(siteId, schedule);
    });

    // Total ticks needed = max schedule end + 2 (for finalization pass)
    const maxTick = Math.max(...Array.from(siteSchedules.values()).map(s => s[s.length - 1])) + 2;
    let tick = 0;

    const interval = setInterval(() => {
      const completedThisTick = new Map<string, Site['status']>();

      setSiteProvisioningStates(prevStates => {
        const newStates = new Map(prevStates);

        selectedSites.forEach(siteId => {
          const state = newStates.get(siteId);
          if (!state) return;

          // Skip already finalized sites
          if (state.status === 'Failed' || state.status === 'Provisioned' || state.status === 'Monitoring') return;

          const schedule = siteSchedules.get(siteId);
          if (!schedule) return;

          // Determine which step is active for this site at this tick
          let activeStepIdx = -1;
          for (let i = schedule.length - 1; i >= 0; i--) {
            if (tick >= schedule[i]) {
              activeStepIdx = i;
              break;
            }
          }

          if (activeStepIdx < 0) return; // site hasn't started yet

          const hasFailedStep = state.steps.some(s => s.status === 'failed');

          // Check if all steps have been reached (activeStepIdx was the last step on a previous tick)
          const lastStepTick = schedule[numSteps - 1];
          const isFinished = tick > lastStepTick;

          if (isFinished) {
            // Finalize this site
            const updatedSteps = state.steps.map(step => {
              if (step.status === 'failed') return step;
              if (step.status === 'pending' && hasFailedStep) return step;
              if (step.errorMessage) return { ...step, status: 'failed' as const };
              return {
                ...step,
                status: 'completed' as const,
                files: step.files?.map(f => ({ ...f, status: 'completed' as const })),
                subTasks: step.subTasks?.map(t => ({ ...t, progress: 100 }))
              };
            });
            const hasFailed = updatedSteps.some(s => s.status === 'failed');
            const finalStatus = hasFailed ? 'Failed' as const : (autoMonitor ? 'Monitoring' as const : 'Provisioned' as const);
            completedThisTick.set(siteId, finalStatus);
            newStates.set(siteId, { ...state, steps: updatedSteps, status: finalStatus });
            return;
          }

          // Normal step progression
          const updatedSteps = state.steps.map((step, idx) => {
            if (idx === activeStepIdx) {
              if (hasFailedStep) return step;
              const isFailed = !!step.errorMessage;
              return {
                ...step,
                status: isFailed ? 'failed' as const : 'in-progress' as const,
                files: step.files?.map(f => ({ ...f, status: 'completed' as const })),
                subTasks: step.subTasks?.map(t => ({ ...t, progress: isFailed ? 0 : 100 }))
              };
            }
            if (idx < activeStepIdx) {
              if (step.errorMessage) return { ...step, status: 'failed' as const };
              return {
                ...step,
                status: 'completed' as const,
                files: step.files?.map(f => ({ ...f, status: 'completed' as const })),
                subTasks: step.subTasks?.map(t => ({ ...t, progress: 100 }))
              };
            }
            return step;
          });

          newStates.set(siteId, { ...state, steps: updatedSteps });
        });

        return newStates;
      });

      // Update site table for any sites that completed this tick
      if (completedThisTick.size > 0) {
        setSites(prev => prev.map(site => {
          const finalStatus = completedThisTick.get(site.siteId);
          return finalStatus ? { ...site, status: finalStatus } : site;
        }));
      }

      tick++;

      if (tick >= maxTick) {
        clearInterval(interval);
        provisioningIntervalRef.current = null;
        setIsProvisioning(false);

        // Final sync: ensure any site with all steps done has final status in both state and sites table
        setSiteProvisioningStates(prevStates => {
          const newStates = new Map(prevStates);
          const syncStatus = new Map<string, Site['status']>();

          selectedSites.forEach(siteId => {
            const state = newStates.get(siteId);
            if (!state || state.status === 'Failed' || state.status === 'Provisioned' || state.status === 'Monitoring') return;

            const allDone = state.steps.every(s => s.status === 'completed' || s.status === 'failed');
            if (!allDone) return;

            const hasFailed = state.steps.some(s => s.status === 'failed');
            const finalStatus = hasFailed ? 'Failed' as const : (autoMonitor ? 'Monitoring' as const : 'Provisioned' as const);
            syncStatus.set(siteId, finalStatus);
            newStates.set(siteId, { ...state, status: finalStatus });
          });

          if (syncStatus.size > 0) {
            setSites(prev => prev.map(site => {
              const s = syncStatus.get(site.siteId);
              return s ? { ...site, status: s } : site;
            }));
          }
          return newStates;
        });
      }
    }, 1500);
    provisioningIntervalRef.current = interval;
  };

  const requestCancel = (siteIds: string[]) => {
    if (!siteIds.length) return;
    setCancelModal({ isOpen: true, siteIds });
  };

  const confirmCancel = () => {
    const targetIds = cancelModal.siteIds;
    if (targetIds.length === 0) {
      setCancelModal({ isOpen: false, siteIds: [] });
      return;
    }

    if (provisioningIntervalRef.current) {
      clearInterval(provisioningIntervalRef.current);
      provisioningIntervalRef.current = null;
    }
    setIsProvisioning(false);
    setShowProgressPanel(false);

    setSiteProvisioningStates((prev) => {
      const next = new Map(prev);
      targetIds.forEach((siteId) => {
        const state = next.get(siteId);
        if (!state) return;
        let marked = false;
        const updatedSteps = state.steps.map((step) => {
          if (!marked && (step.status === 'in-progress' || step.status === 'pending')) {
            marked = true;
            return {
              ...step,
              status: 'failed' as const,
              errorMessage:
                step.errorMessage ||
                'Provisioning cancelled by user. Hard reset may be required before reprovisioning.',
            };
          }
          return step;
        });
        next.set(siteId, {
          ...state,
          steps: updatedSteps,
          status: 'Failed',
        });
      });
      return next;
    });

    setSites((prev) =>
      prev.map((site) =>
        targetIds.includes(site.siteId) ? { ...site, status: 'Failed' } : site
      )
    );

    setCancelModal({ isOpen: false, siteIds: [] });
  };

  const handleStartMonitoring = (siteId: string) => {
    setSites(prev => prev.map(site => 
      site.siteId === siteId ? { ...site, status: 'Monitoring' } : site
    ));
    setSiteProvisioningStates(prev => {
      const newStates = new Map(prev);
      const state = newStates.get(siteId);
      if (state) {
        newStates.set(siteId, { ...state, status: 'Monitoring' });
      }
      return newStates;
    });
  };

  const handleReset = () => {
    if (isProvisioningLocked) return;
    setSiteProvisioningStates(new Map());
    setIsProvisioning(false);
    setShowProgressPanel(false);
    setSites(prev => prev.map(site => 
      selectedSites.has(site.siteId) ? { ...site, status: 'Planned' } : site
    ));
  };

  const toggleStep = (siteId: string, stepId: string) => {
    const key = `${siteId}-${stepId}`;
    setExpandedSteps(prev => {
      const newSet = new Set(prev);
      if (newSet.has(key)) {
        newSet.delete(key);
      } else {
        newSet.add(key);
      }
      return newSet;
    });
  };

  const showLogs = (stepName: string, logs: string[]) => {
    setLogModal({ isOpen: true, title: `${stepName} - logs`, content: logs });
  };

  const toggleSiteCard = (siteId: string) => {
    setExpandedSiteCards(prev => {
      const newSet = new Set(prev);
      if (newSet.has(siteId)) {
        newSet.delete(siteId);
      } else {
        newSet.add(siteId);
      }
      return newSet;
    });
  };

  const getProgressSummary = (steps: ProvisioningStep[]) => {
    const completed = steps.filter(s => s.status === 'completed').length;
    const failed = steps.filter(s => s.status === 'failed').length;
    const inProgress = steps.filter(s => s.status === 'in-progress').length;
    const total = steps.length;
    return { completed, failed, inProgress, total };
  };

  const getStatusIcon = (status: ProvisioningStep['status'], small = false) => {
    const size = small ? 'w-4 h-4' : 'w-6 h-6';
    const iconSize = small ? 'w-3 h-3' : 'w-4 h-4';
    
    switch (status) {
      case 'completed':
        return <div className={`${size} bg-green-500 rounded-full flex items-center justify-center`}><CheckCircle className={`${iconSize} text-white`} /></div>;
      case 'in-progress':
        return <div className={`${size} bg-orange-500 rounded-full flex items-center justify-center`}><Loader2 className={`${iconSize} text-white animate-spin`} /></div>;
      case 'failed':
        return <div className={`${size} bg-red-500 rounded-full flex items-center justify-center`}><X className={`${iconSize} text-white`} /></div>;
      default:
        return <div className={`${size} bg-gray-300 dark:bg-gray-600 rounded-full`} />;
    }
  };

  const getStatusBadge = (status: Site['status']) => {
    const colors = {
      'Planned': 'bg-cream-surface-light dark:bg-gray-700 text-text-secondary dark:text-gray-300',
      'InProgress': 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
      'Provisioned': 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
      'Monitoring': 'bg-tenant-light/80 text-tenant-primary',
      'Failed': 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
    };
    return colors[status];
  };

  // Subscribe to platform bus events
  useEffect(() => {
    const unsubscribeSites = subscribe('PROVISION_SITES_SELECTED', (payload: { sites: ProvisioningCandidateSite[] }) => {
      setInitialSites(payload.sites);
      setActiveTab('provision');
    });

    return () => {
      unsubscribeSites();
    };
  }, [subscribe]);

  return (
    <div className="relative flex-1 flex overflow-hidden bg-cream-bg dark:bg-pulse-bg">
      {/* Left Panel - Sites Table */}
      <div
        className={`overflow-y-auto transition-all duration-500 ease-out ${
          canShowProgress
            ? 'w-1/2 border-r border-slate-700 dark:border-pulse-border'
            : 'w-full border-r-0'
        }`}
      >
        <div className="p-4">
          <div className="mb-3">
            <h1 className="text-xl font-bold text-text-light-primary dark:text-text-primary">Naavik Zero Touch Provisioning</h1>
          </div>

          <div className="mb-4 inline-flex rounded-xl border border-white/12 dark:border-white/12 overflow-hidden backdrop-blur-sm bg-white/4 dark:bg-white/4">
            <button
              onClick={() => setActiveTab('provision')}
              className={`px-4 py-2 text-sm font-semibold transition-all ${
                activeTab === 'provision'
                  ? 'bg-white/18 dark:bg-white/18 text-text-primary dark:text-white shadow-sm'
                  : 'text-text-muted dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-white/8 dark:hover:bg-white/8'
              }`}
            >
              Sites to Provision
            </button>
            <button
              onClick={() => setActiveTab('recent')}
              className={`px-4 py-2 text-sm font-semibold transition-all ${
                activeTab === 'recent'
                  ? 'bg-white/18 dark:bg-white/18 text-text-primary dark:text-white shadow-sm'
                  : 'text-text-muted dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-white/8 dark:hover:bg-white/8'
              }`}
            >
              Recently Provisioned
            </button>
          </div>

          {activeTab === 'provision' ? (
            <>
          {/* Controls */}
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              {bulkMode ? (
                <span className="text-sm text-text-light-primary dark:text-text-primary font-medium">
                  Multi-site provisioning list: {selectedQuarter}
                </span>
              ) : (
                <span className="text-sm text-text-light-primary dark:text-text-primary font-medium">
                  Single-site provisioning context from map
                </span>
              )}
              <button
                onClick={handleLoadAllSites}
                disabled={isProvisioningLocked}
                className="px-3 py-2 text-sm font-medium rounded-lg border border-white/15 dark:border-white/15 bg-white/6 dark:bg-white/6 hover:bg-white/12 dark:hover:bg-white/12 text-text-primary dark:text-slate-100 disabled:opacity-40 disabled:cursor-not-allowed backdrop-blur-sm transition-all"
              >
                Load all sites
              </button>
              <button
                onClick={handleLoadQueue}
                disabled={isProvisioningLocked || queueCount === 0}
                className="px-3 py-2 text-sm font-medium rounded-lg border border-white/15 dark:border-white/15 bg-white/6 dark:bg-white/6 hover:bg-white/12 dark:hover:bg-white/12 text-text-primary dark:text-slate-100 disabled:opacity-35 disabled:cursor-not-allowed backdrop-blur-sm transition-all"
              >
                Load provisioning queue ({queueCount})
              </button>
              {showLoadAllSelector && (
                <div className="flex items-center gap-2">
                  <select
                    value={selectedQuarter}
                    onChange={(e) => setSelectedQuarter(e.target.value as 'ALL' | 'Q1' | 'Q2' | 'Q3' | 'Q4')}
                    disabled={isProvisioningLocked}
                    className="px-3 py-2 text-sm rounded-lg border border-slate-700 dark:border-pulse-border bg-slate-800 dark:bg-pulse-surface text-text-light-primary dark:text-text-primary"
                  >
                    <option value="ALL">All quarters</option>
                    <option value="Q1">Q1 provisioning list</option>
                    <option value="Q2">Q2 provisioning list</option>
                    <option value="Q3">Q3 provisioning list</option>
                    <option value="Q4">Q4 provisioning list</option>
                  </select>
                  <button
                    onClick={handleLoadQuarterList}
                    disabled={isProvisioningLocked}
                    className="px-3 py-2 text-sm rounded-lg bg-ui-btn text-ui-btn-fg hover:bg-ui-btn-hover transition"
                  >
                    Load list
                  </button>
                </div>
              )}
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoMonitor}
                  onChange={(e) => setAutoMonitor(e.target.checked)}
                  disabled={isProvisioningLocked}
                  className="w-4 h-4 rounded border-slate-700 dark:border-pulse-border text-tenant-primary focus:ring-tenant-primary"
                />
                <span className="text-sm text-text-light-primary dark:text-text-primary">Auto Monitor</span>
              </label>
              <span className="text-sm text-text-light-secondary dark:text-text-secondary">
                {selectedSites.size} site{selectedSites.size !== 1 ? 's' : ''} selected
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={handleReset}
                disabled={isProvisioningLocked}
                className="px-4 py-2 text-sm border border-slate-700 dark:border-pulse-border text-text-light-primary dark:text-text-primary rounded-lg hover:bg-white/6 dark:hover:bg-white/6 transition disabled:bg-gray-100 dark:disabled:bg-slate-800 disabled:text-gray-500 dark:disabled:text-slate-500 disabled:cursor-not-allowed"
              >
                Reset
              </button>
              {ongoingSiteIds.length > 0 && (
                <button
                  onClick={() => requestCancel(ongoingSiteIds)}
                  className="inline-flex items-center justify-center min-w-[104px] px-4 py-2 text-sm leading-none border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition whitespace-nowrap"
                >
                  {ongoingSiteIds.length > 1 ? 'Cancel All' : 'Cancel'}
                </button>
              )}
              <button
                onClick={handleStartZTP}
                disabled={selectedSites.size === 0 || isProvisioningLocked}
                className="px-4 py-2 text-sm bg-ui-btn text-ui-btn-fg rounded-lg hover:bg-ui-btn-hover transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
              >
                <Play className="w-4 h-4" />
                <span>Start</span>
              </button>
            </div>
          </div>

          {/* Sites Table */}
          <div className="bg-white/4 dark:bg-white/4 border border-white/10 dark:border-white/10 rounded-xl overflow-hidden backdrop-blur-sm">
            <table className="w-full">
              <thead className="bg-white/6 dark:bg-white/6 border-b border-white/10 dark:border-white/10">
                <tr>
                  <th className="px-4 py-3 text-left w-12">
                    <input
                      type="checkbox"
                      checked={selectedSites.size === sites.length}
                      disabled={isProvisioningLocked}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedSites(new Set(sites.map(s => s.siteId)));
                        } else {
                          setSelectedSites(new Set());
                        }
                      }}
                      className="w-4 h-4 rounded border-slate-700 dark:border-pulse-border"
                    />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-light-secondary dark:text-text-secondary uppercase">Site ID</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-light-secondary dark:text-text-secondary uppercase">Quarter</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-light-secondary dark:text-text-secondary uppercase">Zone</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-light-secondary dark:text-text-secondary uppercase">Technology</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-light-secondary dark:text-text-secondary uppercase">Band</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-light-secondary dark:text-text-secondary uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-light-secondary dark:text-text-secondary uppercase">Map</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/8 dark:divide-white/8">
                {isLoadingSites ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-6 text-center text-sm text-text-light-secondary dark:text-text-secondary">
                      Loading provisioning candidates...
                    </td>
                  </tr>
                ) : sites.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-6 text-center text-sm text-text-light-secondary dark:text-text-secondary">
                      No provisioning candidates found for this list.
                    </td>
                  </tr>
                ) : sites.map((site) => (
                  <tr
                    key={site.siteId}
                    className="hover:bg-white/6 dark:hover:bg-white/6 transition"
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedSites.has(site.siteId)}
                        disabled={isProvisioningLocked}
                        onChange={() => handleToggleSite(site.siteId)}
                        className="w-4 h-4 rounded border-slate-700 dark:border-pulse-border"
                      />
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-red-500 dark:text-red-400">{site.siteId}</td>
                    <td className="px-4 py-3 text-sm text-text-light-primary dark:text-text-primary">{site.quarter}</td>
                    <td className="px-4 py-3 text-sm text-text-light-primary dark:text-text-primary">{site.zone}</td>
                    <td className="px-4 py-3 text-sm text-text-light-primary dark:text-text-primary">{site.technology}</td>
                    <td className="px-4 py-3 text-sm text-text-light-primary dark:text-text-primary">{site.band}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusBadge(site.status)}`}>
                        {site.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => {
                          publish({
                            type: 'MAP_FOCUS_SITE',
                            payload: { siteId: site.siteId },
                          });
                          publish({
                            type: 'NAVIGATE_TO_APP',
                            payload: { appId: 'observe' },
                          });
                        }}
                        className="px-2.5 py-1 text-xs rounded-md border border-slate-700 dark:border-pulse-border hover:bg-slate-800-light dark:hover:bg-pulse-surface-light"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
            </>
          ) : (
            <div className="bg-slate-800 dark:bg-pulse-surface border border-slate-700 dark:border-pulse-border rounded-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-slate-800-light dark:bg-pulse-surface-light border-b border-slate-700 dark:border-pulse-border">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-text-light-secondary dark:text-text-secondary uppercase">Site ID</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-text-light-secondary dark:text-text-secondary uppercase">Quarter</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-text-light-secondary dark:text-text-secondary uppercase">Technology</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-text-light-secondary dark:text-text-secondary uppercase">Band</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-text-light-secondary dark:text-text-secondary uppercase">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-text-light-secondary dark:text-text-secondary uppercase">Time</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-text-light-secondary dark:text-text-secondary uppercase">Map</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/8 dark:divide-white/8">
                  {recentProvisionedSites.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-sm text-text-light-secondary dark:text-text-secondary">
                        No sites provisioned with ZTP yet.
                      </td>
                    </tr>
                  ) : (
                    recentProvisionedSites.map((site) => (
                      <tr key={`${site.siteId}-${site.provisionedAt}`} className="hover:bg-white/6 dark:hover:bg-white/6 transition">
                        <td className="px-4 py-3 text-sm font-medium text-red-500 dark:text-red-400">{site.siteId}</td>
                        <td className="px-4 py-3 text-sm text-text-light-primary dark:text-text-primary">{site.quarter}</td>
                        <td className="px-4 py-3 text-sm text-text-light-primary dark:text-text-primary">{site.technology}</td>
                        <td className="px-4 py-3 text-sm text-text-light-primary dark:text-text-primary">{site.band}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusBadge(site.status)}`}>
                            {site.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-text-light-secondary dark:text-text-secondary">{new Date(site.provisionedAt).toLocaleString()}</td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => {
                              publish({
                                type: 'MAP_FOCUS_SITE',
                                payload: { siteId: site.siteId },
                              });
                              publish({
                                type: 'NAVIGATE_TO_APP',
                                payload: { appId: 'observe' },
                              });
                            }}
                            className="px-2.5 py-1 text-xs rounded-md border border-slate-700 dark:border-pulse-border hover:bg-slate-800-light dark:hover:bg-pulse-surface-light"
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Right Panel - Provisioning Steps */}
      <div
        className={`overflow-y-auto transition-all duration-500 ease-out ${
          canShowProgress ? 'w-1/2 opacity-100' : 'w-0 opacity-0 pointer-events-none'
        }`}
      >
        {canShowProgress && selectedSites.size === 0 && siteProvisioningStates.size === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-text-light-secondary dark:text-text-secondary">
              <Info className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>Select one or more sites to begin provisioning</p>
            </div>
          </div>
        ) : canShowProgress ? (
          <div className="p-6 pt-[7.5rem] space-y-3 animate-view-enter">
            <h2 className="text-lg font-bold text-text-light-primary dark:text-text-primary mb-4">Provisioning Progress</h2>

            {Array.from(siteProvisioningStates.size > 0 ? siteProvisioningStates.keys() : selectedSites).map(siteId => {
              const state = siteProvisioningStates.get(siteId);
              const site = sites.find(s => s.siteId === siteId);
              const isExpanded = expandedSiteCards.has(siteId);

              const progress = state ? getProgressSummary(state.steps) : null;
              const allCompleted = state?.steps.every(s => s.status === 'completed' || s.status === 'failed');
              const hasFailed = state?.steps.some(s => s.status === 'failed');
              const canMonitor = allCompleted && !hasFailed && state?.status === 'Provisioned' && !autoMonitor;
              const progressPercent = progress ? Math.round(((progress.completed + progress.failed) / progress.total) * 100) : 0;

              // Derive display status from steps when all done, so we never show InProgress after completion
              const displayStatus: Site['status'] = (state && allCompleted)
                ? (state.status !== 'InProgress' && state.status !== 'Planned'
                    ? state.status
                    : hasFailed ? 'Failed' : (autoMonitor ? 'Monitoring' : 'Provisioned'))
                : (site?.status || 'Planned');

              return (
                <div key={siteId} className="bg-slate-800 dark:bg-pulse-surface border border-slate-700 dark:border-pulse-border rounded-lg overflow-hidden animate-slide-in">
                  {/* Compact Site Header - always visible */}
                  <button
                    onClick={() => toggleSiteCard(siteId)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/6 dark:hover:bg-white/6 transition text-left"
                  >
                    <div className="flex items-center space-x-3 min-w-0">
                      {/* Status dot */}
                      {state ? (
                        hasFailed ? (
                          <div className="w-3 h-3 bg-red-500 rounded-full flex-shrink-0" />
                        ) : allCompleted ? (
                          <div className="w-3 h-3 bg-green-500 rounded-full flex-shrink-0" />
                        ) : (
                          <div className="w-3 h-3 bg-orange-500 rounded-full animate-pulse flex-shrink-0" />
                        )
                      ) : (
                        <div className="w-3 h-3 bg-gray-300 dark:bg-gray-600 rounded-full flex-shrink-0" />
                      )}

                      <span className="text-sm font-bold text-text-light-primary dark:text-text-primary">{siteId}</span>

                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full flex-shrink-0 ${getStatusBadge(displayStatus)}`}>
                        {displayStatus}
                      </span>
                    </div>

                    <div className="flex items-center space-x-3 flex-shrink-0">
                      {/* Progress bar (compact) */}
                      {progress && (
                        <div className="flex items-center space-x-2">
                          <div className="w-24 h-1.5 bg-slate-700 dark:bg-pulse-border rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${hasFailed ? 'bg-red-500' : 'bg-green-500'}`}
                              style={{ width: `${progressPercent}%` }}
                            />
                          </div>
                          <span className="text-xs text-text-light-muted dark:text-text-muted w-16 text-right">
                            {progress.completed}/{progress.total} steps
                          </span>
                        </div>
                      )}

                      {canMonitor && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleStartMonitoring(siteId); }}
                          className="flex items-center space-x-1.5 px-2.5 py-1 bg-ui-btn text-ui-btn-fg rounded-md hover:bg-ui-btn-hover transition text-xs"
                        >
                          <Activity className="w-3 h-3" />
                          <span>Monitor</span>
                        </button>
                      )}

                      <ChevronDown className={`w-4 h-4 text-text-light-secondary dark:text-text-secondary transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                    </div>
                  </button>

                  {/* Expandable Steps Detail */}
                  <div
                    className={`transition-all duration-300 ease-in-out overflow-hidden ${isExpanded ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'}`}
                  >
                    {state && (
                      <div className="px-4 pb-4 pt-1 border-t border-slate-700 dark:border-pulse-border">
                        {/* Steps Timeline */}
                        <div className="relative space-y-2 mt-2">
                          {/* Vertical line */}
                          <div className="absolute left-[7px] top-1 bottom-1 w-0.5 bg-slate-700 dark:bg-pulse-border" />

                          {state.steps.map((step) => (
                            <div key={step.id} className="relative pl-8">
                              {/* Step icon */}
                              <div className="absolute left-0 top-0.5">
                                {getStatusIcon(step.status, true)}
                              </div>

                              {/* Step content */}
                              <div>
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-medium text-text-light-primary dark:text-text-primary">
                                    {step.name}
                                  </span>
                                  <div className="flex items-center space-x-2">
                                    {step.logs && (
                                      <button
                                        onClick={() => showLogs(`${siteId} - ${step.name}`, step.logs!)}
                                        className="text-xs text-tenant-primary hover:underline"
                                      >
                                        Show logs
                                      </button>
                                    )}
                                    {(step.files || step.subTasks) && (
                                      <button
                                        onClick={() => toggleStep(siteId, step.id)}
                                        className="text-text-light-secondary dark:text-text-secondary"
                                      >
                                        {expandedSteps.has(`${siteId}-${step.id}`) ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                      </button>
                                    )}
                                  </div>
                                </div>

                                {/* Error message */}
                                {step.status === 'failed' && step.errorMessage && (
                                  <div className="mt-1.5 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-xs text-red-700 dark:text-red-400">
                                    {step.errorMessage}
                                  </div>
                                )}

                                {/* Expanded content */}
                                {expandedSteps.has(`${siteId}-${step.id}`) && (
                                  <div className="mt-1.5 space-y-1.5">
                                    {step.subTasks && step.subTasks.map((task, idx) => (
                                      <div key={idx} className="space-y-1">
                                        <div className="flex justify-between text-xs">
                                          <span className="text-text-light-secondary dark:text-text-secondary">{task.name}</span>
                                          <span className="text-text-light-muted dark:text-text-muted">{task.progress}/100</span>
                                        </div>
                                        <div className="h-1.5 bg-slate-700 dark:bg-pulse-border rounded-full overflow-hidden">
                                          <div
                                            className="h-full bg-green-500 transition-all duration-300"
                                            style={{ width: `${task.progress}%` }}
                                          />
                                        </div>
                                      </div>
                                    ))}

                                    {step.files && (
                                      <div className="space-y-1">
                                        {step.files.map((file, idx) => (
                                          <div key={idx} className="flex items-center space-x-2 text-xs">
                                            {file.status === 'completed' && <CheckCircle className="w-3 h-3 text-green-500 flex-shrink-0" />}
                                            {file.status === 'failed' && <X className="w-3 h-3 text-red-500 flex-shrink-0" />}
                                            {file.status === 'pending' && <div className="w-3 h-3 rounded-full border-2 border-border dark:border-gray-600 flex-shrink-0" />}
                                            <span className="text-tenant-primary hover:underline cursor-pointer text-xs">
                                              {file.name}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      {!canShowProgress && activeTab === 'provision' && siteProvisioningStates.size > 0 && (
        <button
          onClick={() => setShowProgressPanel(true)}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-20 flex items-center gap-1 rounded-l-lg border border-slate-700 dark:border-pulse-border bg-slate-800/95 dark:bg-pulse-surface/95 px-2 py-2 text-xs text-text-light-secondary dark:text-text-secondary hover:bg-slate-800-light dark:hover:bg-pulse-surface-light shadow-md"
          title="Show provisioning progress"
        >
          <ChevronLeft className="w-3 h-3" />
          <span>Progress</span>
        </button>
      )}

      {canShowProgress && siteProvisioningStates.size > 0 && !isProvisioning && (
        <button
          onClick={() => setShowProgressPanel(false)}
          className="absolute right-[calc(50%-1.75rem)] top-3 z-20 flex items-center gap-1 rounded-md border border-slate-700 dark:border-pulse-border bg-slate-800/95 dark:bg-pulse-surface/95 px-2 py-1.5 text-xs text-text-light-secondary dark:text-text-secondary hover:bg-slate-800-light dark:hover:bg-pulse-surface-light shadow-md"
          title="Collapse provisioning progress"
        >
          <ChevronRight className="w-3 h-3" />
          <span>Collapse</span>
        </button>
      )}

      {/* Log Modal */}
      {logModal.isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setLogModal({ isOpen: false, title: '', content: [] })}>
          <div className="bg-slate-800 dark:bg-pulse-surface border border-slate-700 dark:border-pulse-border rounded-lg max-w-3xl w-full max-h-[80vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-slate-700 dark:border-pulse-border">
              <h3 className="font-semibold text-text-light-primary dark:text-text-primary">{logModal.title}</h3>
              <button
                onClick={() => setLogModal({ isOpen: false, title: '', content: [] })}
                className="text-text-light-secondary dark:text-text-secondary hover:text-text-light-primary dark:hover:text-text-primary"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto font-mono text-xs space-y-1 bg-slate-800-light dark:bg-pulse-surface-light">
              {logModal.content.map((log, idx) => (
                <div key={idx} className="text-text-light-primary dark:text-text-primary">
                  <span className="text-text-light-muted dark:text-text-muted mr-3">{idx + 1}</span>
                  {log}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Cancel confirmation modal */}
      {cancelModal.isOpen && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setCancelModal({ isOpen: false, siteIds: [] })}
        >
          <div
            className="bg-slate-800 dark:bg-pulse-surface border border-slate-700 dark:border-pulse-border rounded-lg max-w-lg w-full p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-text-light-primary dark:text-text-primary mb-2">
              Confirm Cancellation
            </h3>
            <p className="text-sm text-text-light-secondary dark:text-text-secondary mb-4">
              Cancelling provisioning may cause unintended consequences on sites currently being provisioned and may require a hard reset before provisioning them again.
            </p>
            <p className="text-xs text-text-light-muted dark:text-text-muted mb-5">
              Target sites: {cancelModal.siteIds.join(', ')}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setCancelModal({ isOpen: false, siteIds: [] })}
                className="px-3 py-2 text-sm rounded-lg border border-slate-700 dark:border-pulse-border hover:bg-slate-800-light dark:hover:bg-pulse-surface-light"
              >
                Go Back
              </button>
              <button
                onClick={confirmCancel}
                className="px-3 py-2 text-sm rounded-lg bg-ui-btn text-ui-btn-fg hover:bg-ui-btn-hover"
              >
                Confirm Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
