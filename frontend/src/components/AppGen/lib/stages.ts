import type { ComponentType } from 'react'
import {
  ClipboardCheck,
  FileCode2,
  LayoutList,
  Package,
  Sparkles,
} from 'lucide-react'

export type StageTabId =
  | 'planning'
  | 'code_generation'
  | 'code_audit'
  | 'test'
  | 'app_assembly'

export const STAGE_TAB_ORDER: StageTabId[] = [
  'planning',
  'code_generation',
  'code_audit',
  'test',
  'app_assembly',
]

export const STAGE_TAB_CONFIG: Record<
  StageTabId,
  {
    label: string
    description: string
    icon: ComponentType<{ className?: string }>
  }
> = {
  planning: {
    label: 'Plan',
    description: 'Refine the intent, plan, and telecom flow.',
    icon: LayoutList,
  },
  code_generation: {
    label: 'Code',
    description: 'Generate and inspect the app implementation.',
    icon: FileCode2,
  },
  code_audit: {
    label: 'Audit',
    description: 'Run lightweight code checks and autofixes.',
    icon: Sparkles,
  },
  test: {
    label: 'Test',
    description: 'Review unit, functional, and validation results.',
    icon: ClipboardCheck,
  },
  app_assembly: {
    label: 'Assembly',
    description: 'Package the app for preview and delivery.',
    icon: Package,
  },
}

export const AGENT_MODE_CONFIG = [
  { id: 'planning', label: 'Planning' },
  { id: 'code_generation', label: 'Code Generation' },
  { id: 'code_audit', label: 'Code Audit' },
  { id: 'testing', label: 'Testing' },
  { id: 'app_assembly', label: 'App Assembly' },
] as const

export const AGENT_STAGE_DESCRIPTIONS: Record<string, string> = {
  planning: 'Capture the RF engineer intent, refine the plan, and maintain the flowchart.',
  code_generation: 'Generate code from the approved plan and align it with the selected domain strategy.',
  coding: 'Inspect and edit generated source files directly.',
  code_audit: 'Run lightweight quality checks, fix safe issues, and summarize remaining findings.',
  testing: 'Generate and run unit and functional tests.',
  app_assembly: 'Prepare packaging, runtime configuration, and handoff artifacts.',
}

export const STAGE_NEXT_ACTIONS: Record<StageTabId, string> = {
  planning: 'Refine the written plan and flowchart, then approve it to unlock code generation.',
  code_generation: 'Inspect generated files, adjust via chat if needed, and continue once the scaffold looks correct.',
  code_audit: 'Review remaining findings, apply safe fixes, and confirm the codebase is clean enough to test.',
  test: 'Check failing cases first, rerun targeted scenarios, and confirm the generated app behavior matches the intent.',
  app_assembly: 'Verify the packaged files and launch the preview runtime before handing off the artifact.',
}

export interface ChatQuickAction {
  label: string
  prompt?: string
  stageId?: string
}

export const CHAT_QUICK_ACTIONS: Record<string, ChatQuickAction[]> = {
  planning: [
    { label: 'Summarize plan', prompt: 'Summarize the current plan and highlight any missing assumptions.' },
    { label: 'Regenerate flowchart', prompt: 'Read the saved plan and regenerate the flowchart to match it exactly.' },
    { label: 'Start codegen', stageId: 'code_generation' },
  ],
  code_generation: [
    { label: 'Review scaffold', prompt: 'Summarize the generated scaffold and explain the current file layout.' },
    { label: 'What is missing?', prompt: 'Review the generated implementation and identify the highest-priority missing pieces before audit.' },
    { label: 'Run audit', stageId: 'code_audit' },
  ],
  coding: [
    { label: 'Explain current file', prompt: 'Explain the current implementation and call out risky areas.' },
    { label: 'Find next fix', prompt: 'Identify the next concrete code change needed to improve this app.' },
    { label: 'Run audit', stageId: 'code_audit' },
  ],
  code_audit: [
    { label: 'Summarize findings', prompt: 'Summarize the audit findings by severity and explain what still blocks testing.' },
    { label: 'Apply safe fixes', prompt: 'Apply any remaining safe autofixes and report what changed.' },
    { label: 'Run tests', stageId: 'testing' },
  ],
  testing: [
    { label: 'Explain failures', prompt: 'Explain the current failing tests and identify the likely root cause.' },
    { label: 'Improve coverage', prompt: 'Identify the best next tests to improve coverage for the current app behavior.' },
    { label: 'Assemble app', stageId: 'app_assembly' },
  ],
  app_assembly: [
    { label: 'Summarize package', prompt: 'Summarize the assembly output and explain what is ready for delivery.' },
    { label: 'Check preview readiness', prompt: 'Explain whether the current assembled app is ready to be launched in preview.' },
    { label: 'Validate runtime config', prompt: 'Review the packaged runtime configuration and call out anything likely to break preview.' },
  ],
}
