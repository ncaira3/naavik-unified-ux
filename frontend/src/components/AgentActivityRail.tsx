import {
  Brain,
  Bot,
  Compass,
  Lightbulb,
  Radar,
  Search,
  ShieldCheck,
  Sparkles,
  Wand2,
} from 'lucide-react';
import type { AppSpaceView } from './AppSpaceLayout';

type AgentStatus = 'active' | 'standby';

interface AgentItem {
  name: string;
  role: string;
  status: AgentStatus;
  icon: any;
}

const AGENTS_BY_VIEW: Record<AppSpaceView, AgentItem[]> = {
  home: [
    { name: 'Agentic Chatbot', role: 'Intent dialogue', status: 'active', icon: Bot },
    { name: 'Sensing Agent', role: 'Signal ingestion', status: 'active', icon: Radar },
    { name: 'Reasoning Agent', role: 'Root-cause reasoning', status: 'active', icon: Brain },
    { name: 'AppGen Agent', role: 'rApp synthesis', status: 'standby', icon: Wand2 },
    { name: 'Control Agent', role: 'Execution guardrails', status: 'standby', icon: ShieldCheck },
  ],
  observe: [
    { name: 'Observation Agent', role: 'Data collection', status: 'active', icon: Search },
    { name: 'Sensing Agent', role: 'Spatio-temporal correlation', status: 'active', icon: Radar },
    { name: 'Reasoning Agent', role: 'RCA + offender attribution', status: 'active', icon: Brain },
    { name: 'Recommendation Agent', role: 'Corrective actions', status: 'active', icon: Lightbulb },
    { name: 'Forecasting Agent', role: 'Risk anticipation', status: 'standby', icon: Compass },
  ],
  appstore: [
    { name: 'Agentic Chatbot', role: 'Intent refinement', status: 'active', icon: Bot },
    { name: 'AppGen Agent', role: 'EIAP code generation', status: 'active', icon: Wand2 },
    { name: 'Control Agent', role: 'Build validation', status: 'active', icon: ShieldCheck },
    { name: 'Reasoning Agent', role: 'Logic consistency checks', status: 'standby', icon: Brain },
  ],
  myapps: [
    { name: 'Observation Agent', role: 'Live data collection', status: 'active', icon: Search },
    { name: 'Sensing Agent', role: 'Real-time dashboard updates', status: 'active', icon: Radar },
  ],
  provision: [
    { name: 'Control Agent', role: 'Zero-touch orchestration', status: 'active', icon: ShieldCheck },
    { name: 'Observation Agent', role: 'Pipeline telemetry', status: 'active', icon: Search },
    { name: 'Recommendation Agent', role: 'Rollback guidance', status: 'standby', icon: Lightbulb },
  ],
  settings: [
    { name: 'Platform Agent Mesh', role: 'Configuration health', status: 'standby', icon: Sparkles },
  ],
};

function statusPillClass(status: AgentStatus): string {
  if (status === 'active') {
    return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30';
  }
  return 'bg-gray-500/10 text-text-secondary dark:text-white/60 border-gray-400/20';
}

function statusDotClass(status: AgentStatus): string {
  return status === 'active'
    ? 'bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.15)] animate-pulse'
    : 'bg-gray-400 dark:bg-white/40';
}

export default function AgentActivityRail({ activeView }: { activeView: AppSpaceView }) {
  const items = AGENTS_BY_VIEW[activeView] || [];
  if (!items.length) return null;

  return (
    <div className="sticky top-0 z-30 px-5 pt-3 pb-2 bg-gradient-to-b from-[#faf8f5] to-[#faf8f5]/85 dark:from-[#1a1a1f] dark:to-[#1a1a1f]/85 backdrop-blur-xl border-b border-gray-200/70 dark:border-white/10">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="w-4 h-4 text-[#4a7ccc] dark:text-aira-accent" />
        <p className="text-xs font-semibold tracking-wide uppercase text-text-secondary dark:text-white/60">
          Active Agent Mesh
        </p>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
        {items.map((item, idx) => {
          const Icon = item.icon;
          return (
            <div
              key={`${item.name}-${idx}`}
              className="min-w-fit group rounded-xl px-3 py-2 border border-border dark:border-white/10 bg-white/80 dark:bg-white/5 hover:bg-white dark:hover:bg-white/10 transition-all"
            >
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-[#4a7ccc]/15 dark:bg-aira-accent/20 flex items-center justify-center">
                  <Icon className="w-3.5 h-3.5 text-[#4a7ccc] dark:text-aira-accent" />
                </div>
                <div className="leading-tight">
                  <p className="text-xs font-medium text-text-primary dark:text-white">{item.name}</p>
                  <p className="text-[11px] text-text-secondary dark:text-white/60">{item.role}</p>
                </div>
                <span className={`ml-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold ${statusPillClass(item.status)}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${statusDotClass(item.status)}`} />
                  {item.status}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
