/**
 * Re-export from ChatPanel module so requests for ChatPanel.tsx (e.g. dev
 * tooling, source maps) succeed. The real implementation lives in ChatPanel/.
 */
export { ChatPanel } from './ChatPanel/index'
export type { ChatPanelProps } from './ChatPanel/index'
