import { useState } from 'react';
import { Check, MapPin, Lock } from 'lucide-react';
import { useMarket } from '../context/MarketContext';
import { useTheme } from '../context/ThemeContext';

interface MarketSelectorProps {
  /** When true the modal is dismissable (X / overlay click). False on first-login prompt. */
  dismissable?: boolean;
}

export default function MarketSelector({ dismissable = false }: MarketSelectorProps) {
  const { market, available, setMarket, closeSelector } = useMarket();
  const { theme } = useTheme();
  const [picked, setPicked] = useState<string | null>(market?.id ?? null);

  const isDark = theme === 'dark';
  const handleConfirm = () => {
    if (!picked) return;
    setMarket(picked);
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={dismissable ? closeSelector : undefined}
    >
      <div
        className="w-full max-w-lg rounded-2xl border shadow-2xl overflow-hidden"
        style={{
          borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(45,42,38,0.12)',
          background: isDark ? '#1a1a1a' : '#FFFDFA',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="px-6 py-5 border-b"
          style={{ borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(45,42,38,0.08)' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="rounded-lg p-2"
              style={{
                background: isDark ? 'rgba(99,102,241,0.18)' : 'rgba(99,102,241,0.10)',
                color: isDark ? '#a5b4fc' : '#4f46e5',
              }}
            >
              <MapPin className="h-5 w-5" />
            </div>
            <div>
              <div className="text-[15px] font-semibold" style={{ color: isDark ? '#FBFBFB' : '#2D2A26' }}>
                {market ? 'Switch Market' : 'Select Your Market'}
              </div>
              <div className="text-[12px]" style={{ color: isDark ? '#8C8C8C' : '#6B6762' }}>
                {market
                  ? 'Pick a different market — your views will refresh.'
                  : 'Choose the market you want to monitor. You can change this later from the header.'}
              </div>
            </div>
          </div>
        </div>

        {/* Options */}
        <div className="px-6 py-5 space-y-2 max-h-[60vh] overflow-auto">
          {available.map((m) => {
            const selected = picked === m.id;
            const disabled = !m.available;
            return (
              <button
                key={m.id}
                type="button"
                disabled={disabled}
                onClick={() => !disabled && setPicked(m.id)}
                className="flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed"
                style={{
                  borderColor: selected
                    ? (isDark ? '#a5b4fc' : '#6366f1')
                    : (isDark ? 'rgba(255,255,255,0.10)' : 'rgba(45,42,38,0.10)'),
                  background: selected
                    ? (isDark ? 'rgba(99,102,241,0.12)' : 'rgba(99,102,241,0.06)')
                    : (isDark ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.5)'),
                  opacity: disabled ? 0.5 : 1,
                }}
              >
                <div
                  className="flex h-6 w-6 items-center justify-center rounded-full border"
                  style={{
                    borderColor: selected
                      ? (isDark ? '#a5b4fc' : '#6366f1')
                      : (isDark ? 'rgba(255,255,255,0.20)' : 'rgba(45,42,38,0.20)'),
                    background: selected ? (isDark ? '#a5b4fc' : '#6366f1') : 'transparent',
                  }}
                >
                  {selected && <Check className="h-3.5 w-3.5" style={{ color: isDark ? '#1a1a1a' : '#ffffff' }} />}
                </div>
                <div className="flex-1">
                  <div className="text-[13px] font-medium" style={{ color: isDark ? '#FBFBFB' : '#2D2A26' }}>
                    {m.label}
                  </div>
                  {m.dbValues.length > 0 && (
                    <div className="text-[10px] font-mono mt-0.5" style={{ color: isDark ? '#8C8C8C' : '#8F8B85' }}>
                      {m.dbValues.join(' · ')}
                    </div>
                  )}
                </div>
                {disabled && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider"
                    style={{
                      background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(45,42,38,0.06)',
                      color: isDark ? '#8C8C8C' : '#8F8B85',
                    }}
                  >
                    <Lock className="h-3 w-3" /> Coming soon
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-2 px-6 py-4 border-t"
          style={{ borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(45,42,38,0.08)' }}
        >
          {dismissable && (
            <button
              type="button"
              onClick={closeSelector}
              className="rounded-lg px-4 py-2 text-[12px] font-medium uppercase tracking-[0.08em] transition-colors"
              style={{
                color: isDark ? '#B3B3B3' : '#6B6762',
                background: 'transparent',
              }}
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!picked}
            className="rounded-lg px-4 py-2 text-[12px] font-semibold uppercase tracking-[0.08em] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              background: isDark ? '#a5b4fc' : '#4f46e5',
              color: isDark ? '#1a1a1a' : '#ffffff',
            }}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
