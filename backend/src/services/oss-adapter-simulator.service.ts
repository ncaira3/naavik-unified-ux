import { v4 as uuidv4 } from 'uuid';

export type OssChangeStatus = 'running' | 'completed' | 'failed' | 'queued';
export type OssStepStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'queued';

export interface OssAdapterStep {
  key: string;
  label: string;
  status: OssStepStatus;
  detail?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface StartOssParameterChangeInput {
  siteId?: string;
  parameter?: string;
  value?: string | number;
  unit?: string;
  moClass?: string;
  intentText?: string;
}

export interface OssAdapterSimulation {
  requestId: string;
  status: OssChangeStatus;
  siteId: string;
  parameter: string;
  value: string;
  unit?: string;
  moClass?: string;
  handshakeRequired: boolean;
  script: string;
  steps: OssAdapterStep[];
  message: string;
  createdAt: string;
  updatedAt: string;
}

const STEP_LABELS = [
  'Invoking OSS adapter',
  'Validating parameter change',
  'Confirming connectivity',
  'Sending Parameter Change Script',
  'Awaiting change confirmation',
  'Change result',
];

type TerminalOssChangeStatus = Exclude<OssChangeStatus, 'running'>;
const TERMINAL_STATUSES: TerminalOssChangeStatus[] = ['completed', 'failed', 'queued'];

export class OSSAdapterSimulatorService {
  private static readonly requests = new Map<string, OssAdapterSimulation>();

  static startParameterChange(input: StartOssParameterChangeInput): OssAdapterSimulation {
    const parsed = this.resolveInput(input);
    const requestId = uuidv4();
    const createdAt = new Date().toISOString();

    const steps: OssAdapterStep[] = STEP_LABELS.map((label, index) => ({
      key: `step_${index + 1}`,
      label,
      status: index === 0 ? 'in_progress' : 'pending',
      detail: index === 0 ? 'Initializing session handshake with OSS endpoint.' : undefined,
      startedAt: index === 0 ? createdAt : undefined,
    }));

    const script = this.buildScript(parsed.siteId, parsed.parameter, parsed.value, parsed.unit, parsed.moClass);

    const simulation: OssAdapterSimulation = {
      requestId,
      status: 'running',
      siteId: parsed.siteId,
      parameter: parsed.parameter,
      value: parsed.value,
      unit: parsed.unit,
      moClass: parsed.moClass,
      handshakeRequired: true,
      script,
      steps,
      message: `Handshake started. Preparing change for ${parsed.siteId}.`,
      createdAt,
      updatedAt: createdAt,
    };

    this.requests.set(requestId, simulation);
    this.scheduleProgression(requestId);

    return simulation;
  }

  static getRequest(requestId: string): OssAdapterSimulation | null {
    return this.requests.get(requestId) ?? null;
  }

  private static resolveInput(input: StartOssParameterChangeInput): {
    siteId: string;
    parameter: string;
    value: string;
    unit?: string;
    moClass?: string;
  } {
    const directSiteId = `${input.siteId ?? ''}`.trim();
    const directParameter = `${input.parameter ?? ''}`.trim();
    const directValue = `${input.value ?? ''}`.trim();
    const directUnit = `${input.unit ?? ''}`.trim();
    const directMoClass = `${input.moClass ?? ''}`.trim();

    const parsedIntent = this.parseIntentText(input.intentText ?? '');

    const siteId = directSiteId || parsedIntent.siteId;
    const parameter = directParameter || parsedIntent.parameter;
    const value = directValue || parsedIntent.value;
    const unit = directUnit || parsedIntent.unit;
    const moClass = directMoClass || parsedIntent.moClass;

    if (!siteId || !parameter || !value) {
      throw new Error('Missing required input. Provide siteId, parameter, and value.');
    }

    return { siteId, parameter, value, unit: unit || undefined, moClass: moClass || undefined };
  }

  private static parseIntentText(intentText: string): {
    siteId: string;
    parameter: string;
    value: string;
    unit: string;
    moClass: string;
  } {
    const text = intentText.trim();
    if (!text) {
      return { siteId: '', parameter: '', value: '', unit: '', moClass: '' };
    }

    const siteMatch = text.match(/(?:site|on)\s+([a-zA-Z0-9_-]+)/i);
    const parameterMatch = text.match(/(?:change|set|update)\s+([a-zA-Z_][a-zA-Z0-9_]*)/i);
    const valueMatch = text.match(/(?:to|=)\s*(-?\d+(?:\.\d+)?)/i);
    const moClassMatch = text.match(/(?:mo|moclass|managed\s*object)\s*[:=]?\s*([a-zA-Z0-9_.-]+)/i);

    let unit = '';
    if (valueMatch) {
      const suffix = text.slice(valueMatch.index! + valueMatch[0].length).trim();
      const tokenMatch = suffix.match(/^([a-zA-Z%]+)/);
      unit = tokenMatch?.[1] ?? '';
    }

    return {
      siteId: siteMatch?.[1] ?? '',
      parameter: parameterMatch?.[1] ?? '',
      value: valueMatch?.[1] ?? '',
      unit,
      moClass: moClassMatch?.[1] ?? '',
    };
  }

  private static scheduleProgression(requestId: string): void {
    const delays = [900, 1100, 1000, 1200, 1400];

    delays.forEach((delay, stageIndex) => {
      setTimeout(() => {
        this.progressToNextStage(requestId, stageIndex);
      }, delays.slice(0, stageIndex + 1).reduce((acc, curr) => acc + curr, 0));
    });
  }

  private static progressToNextStage(requestId: string, currentStageIndex: number): void {
    const request = this.requests.get(requestId);
    if (!request || request.status !== 'running') {
      return;
    }

    const now = new Date().toISOString();
    const currentStep = request.steps[currentStageIndex];
    if (!currentStep || currentStep.status === 'completed') {
      return;
    }

    currentStep.status = 'completed';
    currentStep.completedAt = now;

    if (currentStep.label === 'Invoking OSS adapter') {
      currentStep.detail = 'Handshake acknowledged by OSS adapter.';
      request.message = 'Handshake complete. Validation started.';
    } else if (currentStep.label === 'Validating parameter change') {
      currentStep.detail = 'Parameter payload validation passed.';
      request.message = 'Parameter validation passed.';
    } else if (currentStep.label === 'Confirming connectivity') {
      currentStep.detail = 'Connectivity to OSS confirmed.';
      request.message = 'Connectivity confirmed, preparing script dispatch.';
    } else if (currentStep.label === 'Sending Parameter Change Script') {
      currentStep.detail = `Script dispatched: ${request.script}`;
      request.message = 'Change script sent to OSS adapter.';
    } else if (currentStep.label === 'Awaiting change confirmation') {
      currentStep.detail = `Awaiting acknowledgement from OSS and target cells in target site ${request.siteId}.`;
      request.message = 'Waiting for final confirmation.';
    }

    const nextStep = request.steps[currentStageIndex + 1];

    if (!nextStep) {
      this.finalizeRequest(request);
      request.updatedAt = now;
      return;
    }

    if (nextStep.label === 'Change result') {
      this.finalizeRequest(request);
    } else {
      nextStep.status = 'in_progress';
      nextStep.startedAt = now;
      nextStep.detail = this.inProgressDetail(nextStep.label);
    }

    request.updatedAt = now;
    this.requests.set(requestId, request);
  }

  private static finalizeRequest(request: OssAdapterSimulation): void {
    const finalStep = request.steps[request.steps.length - 1];
    const now = new Date().toISOString();
    const terminal = this.determineTerminalStatus(request.requestId);

    request.status = terminal;
    finalStep.startedAt = finalStep.startedAt ?? now;
    finalStep.completedAt = now;
    finalStep.status = terminal;

    if (terminal === 'completed') {
      finalStep.detail = 'OSS confirmed parameter update successfully.';
      request.message = `Change completed on ${request.siteId}: ${request.parameter}=${request.value}${request.unit ? ` ${request.unit}` : ''}.`;
    } else if (terminal === 'queued') {
      finalStep.detail = 'OSS accepted request and queued for maintenance window.';
      request.message = `Change queued on ${request.siteId}. Awaiting maintenance window.`;
    } else {
      finalStep.detail = 'OSS rejected the update due to a transient adapter error.';
      request.message = `Change failed on ${request.siteId}. Retry after connectivity check.`;
    }
  }

  private static retryCount = new Map<string, number>();

  private static determineTerminalStatus(requestId: string): TerminalOssChangeStatus {
    const attempt = this.retryCount.get(requestId) || 0;
    if (attempt > 0) return 'completed';

    const hash = requestId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    const mod = hash % 10;
    if (mod <= 6) return 'completed';
    if (mod <= 8) {
      this.retryCount.set(requestId, attempt + 1);
      return 'queued';
    }
    this.retryCount.set(requestId, attempt + 1);
    return 'failed';
  }

  static retryRequest(requestId: string): OssAdapterSimulation | null {
    const original = this.requests.get(requestId);
    if (!original) return null;

    original.status = 'running';
    original.message = 'Automated retry initiated by Control Agent...';
    original.updatedAt = new Date().toISOString();
    const newSteps: OssAdapterStep[] = STEP_LABELS.map((label, index) => ({
      key: `step-retry-${index}`,
      label,
      status: index === 0 ? 'in_progress' : 'pending',
      startedAt: index === 0 ? original.updatedAt : undefined,
    }));
    original.steps = newSteps;
    this.requests.set(requestId, original);
    this.scheduleProgression(requestId);
    return original;
  }

  private static inProgressDetail(label: string): string {
    switch (label) {
      case 'Validating parameter change':
        return 'Checking parameter bounds, unit compatibility, and script safety.';
      case 'Confirming connectivity':
        return 'Performing control-plane heartbeat with OSS adapter endpoint.';
      case 'Sending Parameter Change Script':
        return 'Pushing parameter-change script to OSS execution queue.';
      case 'Awaiting change confirmation':
        return 'Awaiting ACK from OSS and target site nodes.';
      default:
        return 'In progress.';
    }
  }

  private static buildScript(siteId: string, parameter: string, value: string, _unit?: string, _moClass?: string): string {
    const moPath = `SubNetwork=ONRM_ROOT_MO,MeContext=${siteId},ManagedElement=1,ENodeBFunction=1,EUtranCellFDD=${siteId}-1,EUtranFreqRelation=1,EUtranCellRelation=1`;
    return `cmedit set ${moPath} eutrancellrelation.${parameter.toLowerCase()} ${value}`;
  }

  static isTerminalStatus(status: OssChangeStatus): boolean {
    return status !== 'running';
  }
}
