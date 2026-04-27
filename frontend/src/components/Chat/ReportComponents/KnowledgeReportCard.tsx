import { useState } from 'react';
import { BookOpen, ChevronDown } from 'lucide-react';

interface KnowledgeReportCardProps {
  question: string;
  answer: string;
  topic?: string;
}

interface ParsedSection {
  type: 'heading' | 'paragraph' | 'numbered_list' | 'bullet_list';
  title?: string;
  body?: string;
  items?: string[];
}

/**
 * Parse answer text into structured sections
 * Handles markdown bold headings (**Title:**), numbered/bullet lists, and paragraphs
 */
function parseAnswerIntoSections(answer: string): ParsedSection[] {
  const blocks = answer.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);

  return blocks.map((block): ParsedSection => {
    // Bold heading pattern: **Title:** or **Title**
    const boldHeadingMatch = block.match(/^\*\*(.+?)\*\*:?\s*([\s\S]*)/);
    if (boldHeadingMatch) {
      const title = boldHeadingMatch[1].trim();
      const rest = boldHeadingMatch[2]?.trim() || '';
      return {
        type: 'heading',
        title,
        body: rest || undefined,
      };
    }

    // Markdown heading: # Title or ## Title
    const mdHeadingMatch = block.match(/^#{1,3}\s+(.+)/);
    if (mdHeadingMatch) {
      const lines = block.split('\n');
      const title = mdHeadingMatch[1].trim();
      const rest = lines.slice(1).join('\n').trim() || '';
      return {
        type: 'heading',
        title,
        body: rest || undefined,
      };
    }

    // Numbered list (2+ items)
    const numberedLines = block.split('\n').filter((l) => /^\d+\.\s/.test(l.trim()));
    if (numberedLines.length >= 2) {
      return {
        type: 'numbered_list',
        items: numberedLines.map((l) => l.replace(/^\d+\.\s+/, '').trim()),
      };
    }

    // Bullet list (2+ items with -, *, or •)
    const bulletLines = block.split('\n').filter((l) => /^[-*•]\s/.test(l.trim()));
    if (bulletLines.length >= 2) {
      return {
        type: 'bullet_list',
        items: bulletLines.map((l) => l.replace(/^[-*•]\s+/, '').trim()),
      };
    }

    // Default: plain paragraph
    return { type: 'paragraph', body: block };
  });
}

export default function KnowledgeReportCard({
  question,
  answer,
  topic,
}: KnowledgeReportCardProps) {
  const [expanded, setExpanded] = useState(false);
  const sections = parseAnswerIntoSections(answer);
  const showMore = sections.length > 3;
  const visibleSections = expanded ? sections : sections.slice(0, 3);

  return (
    <div className="w-full rounded-2xl border border-border dark:border-slate-700 overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-800 to-slate-700 dark:from-slate-900 dark:to-slate-800 px-6 py-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 bg-amber-400/10">
            <BookOpen className="w-5 h-5 text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-bold text-white">{topic || 'Knowledge'}</h3>
            <p className="text-xs text-text-muted mt-1 line-clamp-2">{question}</p>
          </div>
        </div>
      </div>

      {/* Sections */}
      <div className="divide-y divide-gray-100 dark:divide-slate-700/50">
        {visibleSections.map((section, idx) => (
          <div key={idx} className="px-6 py-4">
            {section.type === 'heading' && (
              <>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted dark:text-gray-400 mb-2">
                  {section.title}
                </h4>
                {section.body && (
                  <p className="text-sm text-text-secondary dark:text-gray-300 leading-relaxed">
                    {section.body}
                  </p>
                )}
              </>
            )}

            {section.type === 'paragraph' && (
              <p className="text-sm text-text-secondary dark:text-gray-300 leading-relaxed">
                {section.body}
              </p>
            )}

            {section.type === 'bullet_list' && (
              <ul className="space-y-2">
                {section.items?.map((item, itemIdx) => (
                  <li key={itemIdx} className="flex gap-2 items-start text-sm text-text-secondary dark:text-gray-300">
                    <span className="text-text-muted flex-shrink-0 mt-0.5">→</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            )}

            {section.type === 'numbered_list' && (
              <ol className="space-y-2 list-decimal list-inside">
                {section.items?.map((item, itemIdx) => (
                  <li key={itemIdx} className="text-sm text-text-secondary dark:text-gray-300">
                    {item}
                  </li>
                ))}
              </ol>
            )}
          </div>
        ))}
      </div>

      {/* Show More Button */}
      {showMore && (
        <div className="px-6 py-3 bg-cream-bg dark:bg-slate-800/30 border-t border-border dark:border-slate-700/50">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-2 text-xs font-medium text-text-secondary dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition"
          >
            <span>{expanded ? 'Show less' : `Show ${sections.length - 3} more section${sections.length - 3 > 1 ? 's' : ''}`}</span>
            <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        </div>
      )}
    </div>
  );
}
