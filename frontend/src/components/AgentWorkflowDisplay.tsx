import { CheckCircle2, Loader2, Eye, Brain, Scan, Activity } from 'lucide-react';
import { AgentWorkflow, AgentName } from '../types';

interface AgentWorkflowDisplayProps {
  workflow: AgentWorkflow;
}

const agentIcons: Record<AgentName, React.ComponentType<any>> = {
  OBSERVATION: Eye,
  REASONING: Brain,
  PERCEPTION: Scan,
  SENSING: Activity,
};

const agentConfig: Record<AgentName, { color: string; bgClass: string; borderClass: string; textClass: string }> = {
  OBSERVATION: { 
    color: 'primary-600',
    bgClass: 'bg-sky-500/10',
    borderClass: 'border-sky-500/30',
    textClass: 'text-sky-500'
  },
  REASONING: { 
    color: 'purple',
    bgClass: 'bg-sky-500/10',
    borderClass: 'border-purple-500/30',
    textClass: 'text-sky-400'
  },
  PERCEPTION: { 
    color: 'green',
    bgClass: 'bg-emerald-600/10',
    borderClass: 'border-success-600/30',
    textClass: 'text-emerald-600'
  },
  SENSING: { 
    color: 'orange',
    bgClass: 'bg-naavik-secondary/10',
    borderClass: 'border-naavik-secondary/30',
    textClass: 'text-naavik-secondary'
  },
};

export default function AgentWorkflowDisplay({ workflow }: AgentWorkflowDisplayProps) {
  return (
    <div className="mt-3 bg-cream-surface dark:bg-pulse-surface/80 backdrop-blur-sm border border-cream-border dark:border-pulse-border rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-text-light-primary dark:text-text-primary">Agent Workflow</h4>
        <span className="badge-live">{workflow.totalDuration}ms</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {workflow.agents.map((agent) => {
          const Icon = agentIcons[agent.agentName];
          const config = agentConfig[agent.agentName];
          const isComplete = agent.status === 'COMPLETE';

          return (
            <div
              key={agent.agentName}
              className={`p-3 rounded-lg border transition-all duration-200 ${
                isComplete
                  ? `${config.bgClass} ${config.borderClass}`
                  : 'bg-cream-surface-light border-border dark:bg-pulse-surface-light dark:border-pulse-border'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Icon className={`w-4 h-4 ${isComplete ? config.textClass : 'text-text-light-muted dark:text-text-muted'}`} />
                  <span className="text-xs font-medium text-text-light-primary dark:text-text-primary">
                    {agent.agentName}
                  </span>
                </div>
                {isComplete ? (
                  <CheckCircle2 className={`w-4 h-4 ${config.textClass}`} />
                ) : (
                  <Loader2 className="w-4 h-4 text-text-light-muted dark:text-text-muted animate-spin" />
                )}
              </div>

              {/* Progress bar */}
              <div className="w-full bg-cream-border dark:bg-pulse-border rounded-full h-1.5 mb-2 overflow-hidden">
                <div
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    isComplete ? 'bg-sky-500 dark:bg-sky-500' : 'bg-text-light-muted dark:bg-text-muted'
                  }`}
                  style={{ width: `${agent.progress}%` }}
                />
              </div>

              {/* Findings */}
              {agent.findings.length > 0 && (
                <div className="space-y-1">
                  {agent.findings.slice(0, 2).map((finding, i) => (
                    <p key={i} className="text-xs text-text-light-secondary dark:text-text-secondary line-clamp-1">
                      • {finding}
                    </p>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Final Result Summary */}
      {workflow.finalResult && workflow.finalResult.summary && (
        <div className="pt-3 border-t border-cream-border dark:border-pulse-border">
          <p className="text-xs text-text-light-secondary dark:text-text-secondary">{workflow.finalResult.summary}</p>
        </div>
      )}
    </div>
  );
}
