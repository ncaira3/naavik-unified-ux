import { CheckCircle, XCircle, Loader2, Clock3, CircleDashed } from 'lucide-react';
import { ExecutionStatus } from '../../../types';
interface WorkflowExecutionStatusProps {
  status: ExecutionStatus;
}

export function WorkflowExecutionStatus({ status }: WorkflowExecutionStatusProps) {
  if (!status || typeof status !== 'object') return null;

  const statusStr = status.status ?? 'running';
  const isRunning = statusStr === 'running';
  const isCompleted = statusStr === 'completed';
  const isFailed = statusStr === 'failed';
  const isQueued = statusStr === 'queued';
  const totalSteps = status.steps?.length ?? 0;
  const doneSteps = status.steps?.filter((step) => ['completed', 'queued'].includes(step.status)).length ?? 0;

  return (
    <div className="mt-3 p-4 rounded-xl border border-border dark:border-slate-700 bg-white/75 dark:bg-slate-900/35">
      <div className="flex items-center gap-3">
        {isRunning && <Loader2 className="w-5 h-5 animate-spin text-sky-500 dark:text-sky-500" />}
        {isCompleted && <CheckCircle className="w-5 h-5 text-green-500" />}
        {isFailed && <XCircle className="w-5 h-5 text-red-500" />}
        {isQueued && <Clock3 className="w-5 h-5 text-amber-500" />}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-text-primary dark:text-white">
            {isRunning && 'Executing...'}
            {isCompleted && 'Execution completed'}
            {isFailed && 'Execution failed'}
            {isQueued && 'Execution queued'}
          </p>
          {status.message && (
            <p className="text-sm text-text-secondary dark:text-slate-300 mt-0.5 truncate">
              {status.message}
            </p>
          )}
        </div>
      </div>
      {isCompleted && (status.affectedSites != null || status.affectedCells != null) && (
        <div className="flex gap-4 mt-2 text-xs text-text-muted dark:text-slate-400">
          {status.affectedSites != null && <span>Sites: {status.affectedSites}</span>}
          {status.affectedCells != null && <span>Cells: {status.affectedCells}</span>}
          {status.duration != null && <span>Duration: {status.duration}ms</span>}
        </div>
      )}
      {status.steps && status.steps.length > 0 && (
        <div className="mt-3 border border-border dark:border-slate-700 rounded-lg bg-white/80 dark:bg-slate-900/45 p-3 space-y-2">
          <div className="text-xs text-text-muted dark:text-slate-400 flex items-center justify-between">
            <span>OSS Adapter Flow</span>
            <span>{doneSteps}/{totalSteps} stages</span>
          </div>
          <div className="space-y-1.5">
            {status.steps.map((step) => (
              <div key={step.key} className="flex items-start gap-2">
                {step.status === 'completed' && <CheckCircle className="w-4 h-4 mt-0.5 text-green-500" />}
                {step.status === 'failed' && <XCircle className="w-4 h-4 mt-0.5 text-red-500" />}
                {step.status === 'queued' && <Clock3 className="w-4 h-4 mt-0.5 text-amber-500" />}
                {step.status === 'in_progress' && <Loader2 className="w-4 h-4 mt-0.5 animate-spin text-sky-500 dark:text-sky-500" />}
                {step.status === 'pending' && <CircleDashed className="w-4 h-4 mt-0.5 text-text-muted dark:text-slate-400" />}
                <div className="min-w-0">
                  <p className="text-xs text-text-primary dark:text-slate-100">{step.label}</p>
                  {step.detail && <p className="text-xs text-text-muted dark:text-slate-400">{step.detail}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
