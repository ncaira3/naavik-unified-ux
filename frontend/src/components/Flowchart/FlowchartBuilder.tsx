/**
 * Flowchart Builder Component
 * High-level API for creating professional, streamlined flowcharts
 * Uses unified Naavik theme
 *
 * Usage:
 * <FlowchartBuilder
 *   nodes={[
 *     { id: '1', label: 'Start', type: 'start' },
 *     { id: '2', label: 'Process', type: 'process' },
 *     { id: '3', label: 'Decision', type: 'condition' },
 *   ]}
 *   edges={[
 *     { source: '1', target: '2' },
 *     { source: '2', target: '3', label: 'Yes' },
 *   ]}
 * />
 */

import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { getMermaidConfig, mermaidStylesheet } from '../../utils/flowchartTheme';
import { useTheme } from '../../context/ThemeContext';

export type FlowchartNodeType = 'start' | 'end' | 'process' | 'condition' | 'loop' | 'error';

export interface FlowchartNode {
  id: string;
  label: string;
  type: FlowchartNodeType;
  description?: string;
}

export interface FlowchartEdge {
  source: string;
  target: string;
  label?: string;
}

interface FlowchartBuilderProps {
  nodes: FlowchartNode[];
  edges: FlowchartEdge[];
  className?: string;
  title?: string;
  showLegend?: boolean;
  interactive?: boolean;
  onNodeClick?: (nodeId: string) => void;
}

/**
 * Generate Mermaid diagram code from nodes and edges
 */
function generateMermaidCode(nodes: FlowchartNode[], edges: FlowchartEdge[]): string {
  if (!nodes.length) {
    return 'flowchart TD\n  A[["Add Nodes"]]';
  }

  const lines: string[] = ['flowchart TD'];
  const nodeMap = new Map<string, FlowchartNode>();

  // Define nodes with appropriate shapes
  nodes.forEach((node) => {
    nodeMap.set(node.id, node);
    const label = node.label.replace(/"/g, "'").slice(0, 100);

    switch (node.type) {
      case 'start':
        lines.push(`  ${node.id}(["${label}"])`);
        break;
      case 'end':
        lines.push(`  ${node.id}(["${label}"])`);
        break;
      case 'condition':
        lines.push(`  ${node.id}{"${label}"}`);
        break;
      case 'loop':
        lines.push(`  ${node.id}["${label}"]`);
        break;
      case 'error':
        lines.push(`  ${node.id}["⚠️ ${label}"]`);
        break;
      case 'process':
      default:
        lines.push(`  ${node.id}["${label}"]`);
        break;
    }
  });

  // Define edges
  edges.forEach((edge) => {
    if (nodeMap.has(edge.source) && nodeMap.has(edge.target)) {
      const label = edge.label ? `|${edge.label}|` : '';
      lines.push(`  ${edge.source} -->${label} ${edge.target}`);
    }
  });

  // Add styling
  const styleLines: string[] = [];
  nodes.forEach((node) => {
    switch (node.type) {
      case 'start':
        styleLines.push(`  style ${node.id} fill:#d1fae5,stroke:#10b981,stroke-width:2px,color:#065f46`);
        break;
      case 'end':
        styleLines.push(`  style ${node.id} fill:#fee2e2,stroke:#ef4444,stroke-width:2px,color:#7f1d1d`);
        break;
      case 'condition':
        styleLines.push(`  style ${node.id} fill:#f1f5f9,stroke:#1e293b,stroke-width:2px,color:#0f172a`);
        break;
      case 'loop':
        styleLines.push(`  style ${node.id} fill:#ede9fe,stroke:#8b5cf6,stroke-width:2px,color:#4c1d95`);
        break;
      case 'error':
        styleLines.push(`  style ${node.id} fill:#f3f4f6,stroke:#6b7280,stroke-width:2px,color:#374151`);
        break;
      case 'process':
      default:
        styleLines.push(`  style ${node.id} fill:#dbeafe,stroke:#3b82f6,stroke-width:2px,color:#1e40af`);
        break;
    }
  });

  return lines.concat(styleLines).join('\n');
}

/**
 * Legend showing node types with modern color palette
 */
function FlowchartLegend() {
  return (
    <div className="mt-4 p-4 rounded-lg bg-cream-surface dark:bg-pulse-surface/50 border border-cream-border/70 dark:border-pulse-border/50">
      <p className="text-xs font-semibold uppercase tracking-wider text-text-light-secondary dark:text-text-secondary mb-3">
        Node Types
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {[
          { type: 'start', label: 'Start', color: 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-400 dark:border-emerald-600' },
          { type: 'process', label: 'Process', color: 'bg-sky-50 dark:bg-sky-950/20 border-sky-400 dark:border-sky-600' },
          { type: 'condition', label: 'Decision', color: 'bg-cream-surface-light dark:bg-slate-950/30 border-slate-500 dark:border-slate-600' },
          { type: 'loop', label: 'Loop', color: 'bg-teal-50 dark:bg-violet-950/30 border-teal-400 dark:border-violet-600' },
          { type: 'error', label: 'Error', color: 'bg-amber-50 dark:bg-amber-950/30 border-amber-500 dark:border-amber-600' },
          { type: 'end', label: 'End', color: 'bg-rose-50 dark:bg-rose-950/30 border-rose-400 dark:border-rose-600' },
        ].map(({ type, label, color }) => (
          <div key={type} className="flex items-center gap-2.5">
            <div className={`w-5 h-5 rounded border-1.5 ${color} shadow-sm`} />
            <span className="text-xs font-medium text-text-light-secondary dark:text-text-secondary">
              {label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function FlowchartBuilder({
  nodes,
  edges,
  className = '',
  title,
  showLegend = false,
  interactive = true,
  onNodeClick,
}: FlowchartBuilderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const styleRef = useRef<HTMLStyleElement | null>(null);
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const { theme } = useTheme();
  const isDarkMode = theme === 'dark';

  // Inject stylesheet once
  useEffect(() => {
    if (!styleRef.current) {
      const style = document.createElement('style');
      style.textContent = mermaidStylesheet;
      document.head.appendChild(style);
      styleRef.current = style;
    }
  }, []);

  // Generate and render diagram
  useEffect(() => {
    if (!nodes.length) {
      setSvg('');
      setError(null);
      return;
    }

    const config = getMermaidConfig(isDarkMode);
    mermaid.initialize(config);

    const diagram = generateMermaidCode(nodes, edges);

    mermaid
      .render(`flowchart-${Date.now()}`, diagram)
      .then(({ svg: s }) => {
        setSvg(s);
        setError(null);

        // Add click handlers if interactive
        if (interactive && containerRef.current) {
          setTimeout(() => {
            const svgElement = containerRef.current?.querySelector('svg');
            if (svgElement) {
              nodes.forEach((node) => {
                const element = svgElement.querySelector(`[id="${node.id}"]`)?.closest('g');
                if (element && onNodeClick) {
                  element.style.cursor = 'pointer';
                  element.addEventListener('click', () => onNodeClick(node.id));
                }
              });
            }
          }, 0);
        }
      })
      .catch((err) => {
        setError(err.message ?? 'Failed to render flowchart');
        setSvg('');
      });
  }, [nodes, edges, isDarkMode, interactive, onNodeClick]);

  return (
    <div className={`space-y-4 ${className}`}>
      {title && (
        <div>
          <h3 className="text-lg font-semibold text-text-light-primary dark:text-text-primary">
            {title}
          </h3>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-300 text-sm">
          <strong>Flowchart Error:</strong> {error}
        </div>
      )}

      {svg && (
        <div
          ref={containerRef}
          className="rounded-lg border border-cream-border dark:border-pulse-border bg-cream-surface dark:bg-pulse-surface/50 overflow-auto p-4"
        >
          <div className="mermaid-diagram" dangerouslySetInnerHTML={{ __html: svg }} />
        </div>
      )}

      {!svg && !error && (
        <div className="p-8 rounded-lg border-2 border-dashed border-cream-border dark:border-pulse-border text-center text-text-light-muted dark:text-text-muted">
          <p className="text-sm">No nodes provided. Create nodes to display flowchart.</p>
        </div>
      )}

      {showLegend && <FlowchartLegend />}
    </div>
  );
}
