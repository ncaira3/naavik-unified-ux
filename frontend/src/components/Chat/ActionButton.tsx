/**
 * Action Button Component
 * Displays actionable buttons in chat messages with execution feedback
 */
import { useState } from 'react';
import {
  Loader2,
} from 'lucide-react';
import { ActionButton as ActionButtonType, ExecutionStatus } from '../../types';

interface ActionButtonProps {
  action: ActionButtonType;
  onExecute: (action: ActionButtonType) => Promise<ExecutionStatus>;
  disabled?: boolean;
}

export const ActionButton: React.FC<ActionButtonProps> = ({ action, onExecute, disabled }) => {
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionResult, setExecutionResult] = useState<ExecutionStatus | null>(null);

  if (!action || typeof action !== 'object') return null;

  const actionId = action.actionId ?? (action as any).action_id;
  const actionName = action.actionName ?? (action as any).action_name;
  const label = action.label ?? (action as any).button_label ?? 'Run';
  const style = action.style ?? 'secondary';
  const handleClick = async () => {
    if (isExecuting || executionResult) return;
    if (!actionId || !actionName) return;

    setIsExecuting(true);

    try {
      const result = await onExecute(action);
      setExecutionResult(result);
    } catch (error: any) {
      setExecutionResult({
        executionId: 'error',
        status: 'failed',
        message: error?.message || 'Execution failed'
      });
    } finally {
      setIsExecuting(false);
    }
  };
  
  // Style based on button style and state
  const getButtonClass = () => {
    const baseClass = 'naavik-btn';

    if (executionResult) {
      if (executionResult.status === 'completed') {
        return `${baseClass} naavik-btn-success cursor-default`;
      } else if (executionResult.status === 'failed') {
        return `${baseClass} naavik-btn-danger cursor-default`;
      }
    }

    if (isExecuting) {
      return `${baseClass} naavik-btn-info cursor-wait`;
    }

    if (disabled) {
      return `${baseClass} naavik-btn-secondary`;
    }

    switch (style) {
      case 'primary':
        return `${baseClass} naavik-btn-primary`;
      case 'warning':
        return `${baseClass} naavik-btn-info`;
      case 'danger':
        return `${baseClass} naavik-btn-danger`;
      case 'secondary':
      default:
        return `${baseClass} naavik-btn-secondary`;
    }
  };
  
  // Risk level indicator
  const getRiskBadge = () => {
    if (!action.riskLevel || action.riskLevel === 'low') return null;
    
    return (
      <span className={`text-xs px-2 py-0.5 rounded ${
        action.riskLevel === 'high' 
          ? 'bg-red-500/20 text-red-600 dark:text-red-400'
          : 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
      }`}>
        {action.riskLevel} risk
      </span>
    );
  };
  
  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={handleClick}
        disabled={disabled || isExecuting || !!executionResult}
        className={getButtonClass()}
      >
        <span>
          {executionResult
            ? executionResult.status === 'completed'
              ? 'Executed'
              : 'Failed'
            : isExecuting
              ? 'Executing'
              : label}
        </span>

        {isExecuting && (
          <Loader2 className="w-4 h-4 animate-spin" />
        )}

        {!executionResult && !isExecuting && (action.estimatedDuration ?? (action as any).estimated_duration_minutes) && (
          <span className="text-xs opacity-70">
            ~{action.estimatedDuration ?? (action as any).estimated_duration_minutes}m
          </span>
        )}
      </button>
      
      {/* Additional info */}
      <div className="flex items-center gap-2 text-xs text-text-muted dark:text-gray-400">
        {getRiskBadge()}
        
        {executionResult && executionResult.message && (
          <span className="truncate">{executionResult.message}</span>
        )}
      </div>
    </div>
  );
};
