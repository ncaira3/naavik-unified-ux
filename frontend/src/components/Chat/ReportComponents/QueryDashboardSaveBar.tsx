import { useState } from 'react';
import { Bookmark, Check, X } from 'lucide-react';
import { useSavedQueryDashboards } from '../../../hooks/useSavedQueryDashboards';

interface QueryDashboardSaveBarProps {
  blocks: any[];
  prompt?: string;
}

export default function QueryDashboardSaveBar({ blocks, prompt }: QueryDashboardSaveBarProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [saved, setSaved] = useState(false);
  const { save } = useSavedQueryDashboards();

  const commit = () => {
    if (!name.trim()) return;
    save(name.trim(), blocks, prompt);
    setSaved(true);
    setTimeout(() => { setOpen(false); setSaved(false); setName(''); }, 2000);
  };

  if (saved) {
    return (
      <div className="flex items-center gap-1.5 mt-3 text-xs font-medium text-emerald-600 dark:text-emerald-400">
        <Check className="w-3.5 h-3.5" /> Dashboard saved
      </div>
    );
  }

  return (
    <div className="mt-3 flex items-center gap-2 flex-wrap">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-indigo-300/70 dark:border-indigo-500/40 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition-colors"
        >
          <Bookmark className="w-3.5 h-3.5" />
          Save as Dashboard
        </button>
      ) : (
        <>
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setOpen(false); }}
            placeholder="Dashboard name…"
            className="w-52 rounded-lg px-3 py-1.5 text-xs border border-indigo-300/70 dark:border-indigo-500/40 bg-white dark:bg-white/5 text-text-primary dark:text-white placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
          />
          <button
            onClick={commit}
            disabled={!name.trim()}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors"
          >
            Save
          </button>
          <button
            onClick={() => setOpen(false)}
            className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/8 text-text-muted transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </>
      )}
    </div>
  );
}
