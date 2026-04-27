/**
 * Unified Flowchart Theme Configuration - Modern & Translucent
 * Applies consistent styling across all Mermaid diagrams in Naavik
 * Inspired by modern workflow tools like Zapier - subtle, elegant, sophisticated
 *
 * Modern Color Palette (Light Mode):
 * - Start: Emerald (#059669) with soft fill
 * - Process: Rioo Purple (#6347EB) with translucent bg
 * - Decision: Slate (#475569) with subtle fill
 * - End: Rose (#e11d48) with soft fill
 * - Loop: Violet (#7c3aed) with translucent bg
 * - Error: Amber (#b45309) with warm fill
 */

export const naavikMermaidTheme = {
  // Light mode (default) — warm glassmorphism palette
  primaryColor: '#FFFDFA',            // card (surface-1)
  primaryBorderColor: 'rgba(45,42,38,0.18)', // warm translucent border
  primaryTextColor: '#2D2A26',        // text-primary
  tertiaryColor: '#F5F1ED',           // surface-2
  tertiaryBorderColor: 'rgba(45,42,38,0.22)',
  tertiaryTextColor: '#2D2A26',
  notBkgColor: '#FAF8F5',             // page
  notBorderColor: 'rgba(45,42,38,0.12)',
  notTextColor: '#2D2A26',
  lineColor: 'rgba(45,42,38,0.30)',
  fontSize: '13px',
  fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto',
  padding: '15px',
  textPosition: '0.5',
};

export const naavikMermaidConfig = {
  startOnLoad: false,
  theme: 'default',
  flowchart: {
    useMaxWidth: true,
    htmlLabels: true,
    curve: 'catmullRom', // Smooth curves like Zapier
    padding: 35,
    nodeSpacing: 60,
    rankSpacing: 90,
    diagramMarginX: 20,
    diagramMarginY: 20,
  },
  securityLevel: 'loose',
  logLevel: 'error',
};

/**
 * Node style definitions - Modern, translucent design
 * Subtle colors with transparency and soft shadows
 */
export const nodeStyles = {
  start: {
    stroke: '#059669', // Emerald
    fill: '#ecfdf5', // Very light emerald (nearly white)
    text: '#065f46',
    strokeWidth: 1.5,
  },
  end: {
    stroke: '#e11d48', // Rose
    fill: '#ffe4e9', // Very light rose
    text: '#831843',
    strokeWidth: 1.5,
  },
  process: {
    stroke: '#0EA5E9',
    fill: '#EEEBFF', // Very light purple (nearly white)
    text: '#290849',
    strokeWidth: 1.5,
  },
  condition: {
    stroke: '#475569', // Slate
    fill: '#f1f5f9', // Very light slate (nearly white)
    text: '#1e293b',
    strokeWidth: 1.5,
  },
  error: {
    stroke: '#b45309', // Amber
    fill: '#fffbeb', // Very light amber (nearly white)
    text: '#78350f',
    strokeWidth: 1.5,
  },
  loop: {
    stroke: '#7c3aed', // Violet
    fill: '#faf5ff', // Very light violet (nearly white)
    text: '#4c1d95',
    strokeWidth: 1.5,
  },
};

/**
 * Generate Mermaid initialization config with modern, translucent Naavik theme
 */
export function getMermaidConfig(isDarkMode: boolean): any {
  return {
    ...naavikMermaidConfig,
    theme: isDarkMode ? 'dark' : 'default' as const,
    themeVariables: isDarkMode
      ? {
          // Dark mode - subtle and sophisticated
          primaryColor: '#0f172a', // Very dark slate
          primaryBorderColor: '#334155', // Subtle border
          primaryTextColor: '#f1f5f9', // Light text
          tertiaryColor: '#1e1b4b', // Dark violet bg
          tertiaryBorderColor: '#6366f1', // Indigo border
          tertiaryTextColor: '#e0e7ff',
          notBkgColor: '#1e293b',
          notBorderColor: '#475569',
          notTextColor: '#cbd5e1',
          lineColor: '#475569',
          fontSize: '13px',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          primaryBorderWidth: '1.5px',
          tertiaryBorderWidth: '1.5px',
          notBorderWidth: '1.5px',
        }
      : {
          // Light mode — warm glassmorphism
          primaryColor: '#FFFDFA',
          primaryBorderColor: 'rgba(45,42,38,0.18)',
          primaryTextColor: '#2D2A26',
          tertiaryColor: '#F5F1ED',
          tertiaryBorderColor: 'rgba(45,42,38,0.22)',
          tertiaryTextColor: '#2D2A26',
          notBkgColor: '#FAF8F5',
          notBorderColor: 'rgba(45,42,38,0.12)',
          notTextColor: '#2D2A26',
          lineColor: 'rgba(45,42,38,0.30)',
          fontSize: '13px',
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto',
          primaryBorderWidth: '1.5px',
          tertiaryBorderWidth: '1.5px',
          notBorderWidth: '1.5px',
        },
  };
}

/**
 * Modern CSS styling for Mermaid diagrams
 * Inspired by Zapier's clean, translucent aesthetic
 */
export const mermaidStylesheet = `
  /* Container styling */
  .mermaid-diagram {
    display: flex;
    justify-content: center;
    align-items: flex-start;
    width: 100%;
    overflow-x: auto;
    padding: 1.5rem;
    position: relative;
  }

  /* SVG styling */
  .mermaid-diagram svg {
    max-width: 100%;
    height: auto;
    filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.05));
  }

  /* Node styling - Modern and subtle */
  .mermaid-diagram .flowchart-node {
    transition: all 0.2s ease-out;
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.05));
  }

  .mermaid-diagram .flowchart-node:hover {
    filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.1));
    opacity: 1;
  }

  /* Node text styling */
  .mermaid-diagram .node text,
  .mermaid-diagram .flowchart-node text {
    font-size: 13px;
    font-weight: 500;
    letter-spacing: 0.3px;
  }

  /* Start/End nodes - Emphasis */
  .mermaid-diagram .node.start text,
  .mermaid-diagram .node.end text {
    font-weight: 600;
  }

  /* Process nodes - Regular weight */
  .mermaid-diagram .node.process text {
    font-weight: 500;
  }

  /* Decision nodes - Diamond style */
  .mermaid-diagram .node.condition {
    stroke-dasharray: none;
  }

  .mermaid-diagram .node.condition text {
    font-weight: 500;
  }

  /* Edge styling - Subtle and smooth */
  .mermaid-diagram .edgePath path {
    stroke-width: 1.5px;
    transition: all 0.2s ease;
    opacity: 0.8;
  }

  .mermaid-diagram .edgePath path:hover {
    stroke-width: 2px;
    opacity: 1;
    filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.1));
  }

  /* Edge labels - Subtle styling */
  .mermaid-diagram .edgeLabel {
    background-color: transparent;
    font-size: 11px;
    font-weight: 500;
    color: #64748b;
    letter-spacing: 0.2px;
  }

  .dark .mermaid-diagram .edgeLabel {
    color: #94a3b8;
  }

  /* Cluster styling (if used) */
  .mermaid-diagram .cluster {
    stroke-width: 1px;
    opacity: 0.8;
  }

  .mermaid-diagram .cluster text {
    font-size: 12px;
    font-weight: 600;
  }

  /* Dark mode adjustments */
  .dark .mermaid-diagram svg {
    filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.3));
  }

  .dark .mermaid-diagram .flowchart-node:hover {
    filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.4));
  }

  .dark .mermaid-diagram .edgePath path {
    opacity: 0.7;
  }

  .dark .mermaid-diagram .edgePath path:hover {
    opacity: 1;
  }

  /* Responsive and accessible */
  @media (max-width: 768px) {
    .mermaid-diagram {
      padding: 1rem;
    }

    .mermaid-diagram svg {
      filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.03));
    }

    .mermaid-diagram .node text,
    .mermaid-diagram .flowchart-node text {
      font-size: 12px;
    }

    .mermaid-diagram .edgeLabel {
      font-size: 10px;
    }
  }

  /* Focus states for accessibility */
  .mermaid-diagram .flowchart-node:focus {
    outline: 2px solid #0EA5E9;
    outline-offset: 2px;
  }

  /* Animation for initial render */
  @keyframes flowchartNodeFadeIn {
    from {
      opacity: 0;
      transform: scale(0.95);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  .mermaid-diagram .flowchart-node {
    animation: flowchartNodeFadeIn 0.3s ease-out;
  }
`;
