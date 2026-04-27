import { useState } from 'react';
import RCAReasoningPanel from '../RCAReasoningPanel';

interface RcaChatCardData {
  siteId: string;
  date: string;
  bucket: string;
  summary: string;
  chainOfThought?: string;
}

const BUCKET_STYLES: Record<string, string> = {
  congestion:  'bg-amber-100  text-amber-800  border-amber-200  dark:bg-amber-500/15  dark:text-amber-300  dark:border-amber-500/30',
  outage:      'bg-red-100    text-red-800    border-red-200    dark:bg-red-500/15    dark:text-red-300    dark:border-red-500/30',
  interference:'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-500/15 dark:text-purple-300 dark:border-purple-500/30',
  unknown:     'bg-slate-100  text-slate-700  border-slate-200  dark:bg-white/8       dark:text-slate-300  dark:border-white/10',
};

function bucketStyle(bucket: string): string {
  const b = bucket.toLowerCase();
  for (const [key, cls] of Object.entries(BUCKET_STYLES)) {
    if (b.includes(key)) return cls;
  }
  return 'bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/30';
}

export default function RcaChatCard({ data }: { data: RcaChatCardData }) {
  const [showCot, setShowCot] = useState(false);
  const [showPanel, setShowPanel] = useState(false);

  const { siteId, date, bucket, summary, chainOfThought } = data;
  const badgeCls = bucketStyle(bucket);

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/6 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-100 dark:border-white/10 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-300 mb-1">
            RCA · {siteId} · {date}
          </div>
          <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold border ${badgeCls}`}>
            {bucket}
          </span>
        </div>
      </div>

      {/* Summary */}
      <div className="px-4 py-3 text-sm text-text-primary dark:text-slate-200 leading-relaxed">
        {summary}
      </div>

      {/* Chain of thought (collapsible) */}
      {chainOfThought && (
        <div className="px-4 pb-3">
          <button
            onClick={() => setShowCot((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            <svg className={`w-3.5 h-3.5 transition-transform ${showCot ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            {showCot ? 'Hide' : 'Show'} AI reasoning
          </button>
          {showCot && (
            <div className="mt-2 p-3 rounded-xl bg-slate-50 dark:bg-white/6 border border-slate-200 dark:border-white/10 text-xs text-slate-700 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">
              {chainOfThought}
            </div>
          )}
        </div>
      )}

      {/* Footer actions */}
      <div className="px-4 py-2.5 border-t border-slate-100 dark:border-white/10 flex items-center gap-2">
        <button
          onClick={() => setShowPanel(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.347.347a3.75 3.75 0 01-5.303-5.303l.347-.347z" />
          </svg>
          Explain Intuitions
        </button>
      </div>

      {/* RCAReasoningPanel modal */}
      {showPanel && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowPanel(false); }}
        >
          <div className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-white/10">
            <button
              onClick={() => setShowPanel(false)}
              className="absolute top-3 right-3 z-10 w-7 h-7 flex items-center justify-center rounded-full bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/20 text-slate-500 dark:text-slate-300 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <div className="p-4">
              <RCAReasoningPanel siteId={siteId} dateId={date} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
