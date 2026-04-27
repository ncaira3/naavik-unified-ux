import { useState, useEffect, useRef } from 'react';

const PHASES = [
  { label: 'Reasoning about your request', color: '#818cf8', bars: [0.9, 0.6, 0.8] },
  { label: 'Searching knowledge base',     color: '#38bdf8', bars: [0.5, 0.9, 0.5] },
  { label: 'Processing network data',      color: '#a78bfa', bars: [0.7, 0.5, 0.9] },
  { label: 'Generating response',          color: '#34d399', bars: [0.8, 0.8, 0.6] },
];

export default function TypingIndicator() {
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [barWidths, setBarWidths] = useState([0.4, 0.6, 0.3]);
  const startRef = useRef(Date.now());

  useEffect(() => {
    const t = setInterval(() => {
      setPhaseIdx((i) => (i + 1) % PHASES.length);
    }, 1600);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const animate = () => {
      const t = Date.now() / 1000;
      setBarWidths([
        0.35 + 0.55 * ((Math.sin(t * 1.7) + 1) / 2),
        0.25 + 0.65 * ((Math.sin(t * 2.3 + 1) + 1) / 2),
        0.40 + 0.50 * ((Math.sin(t * 1.1 + 2) + 1) / 2),
      ]);
    };
    const id = setInterval(animate, 80);
    return () => clearInterval(id);
  }, []);

  const phase = PHASES[phaseIdx];

  return (
    <div className="flex gap-3 items-start animate-slide-in py-2">
      {/* Avatar */}
      <div className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center bg-white/10 border border-white/10 shadow-sm mt-0.5">
        <img src="/aira-logo.png" alt="Aira" className="w-4 h-4 object-contain" />
      </div>

      {/* Content */}
      <div className="flex flex-col gap-2 min-w-0 pt-0.5">
        {/* Phase label + timer */}
        <div className="flex items-center gap-2.5">
          {/* Animated waveform bars */}
          <div className="flex items-end gap-[3px] h-4">
            {barWidths.map((w, i) => (
              <div
                key={i}
                className="w-[3px] rounded-full transition-all duration-75"
                style={{
                  height: `${Math.round(w * 16)}px`,
                  backgroundColor: phase.color,
                  opacity: 0.75 + w * 0.25,
                }}
              />
            ))}
          </div>

          <span
            className="text-sm font-medium transition-all duration-500"
            style={{ color: phase.color }}
          >
            {phase.label}
            <span className="inline-flex ml-0.5 gap-[2px] items-end mb-[1px]">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="inline-block w-[3px] h-[3px] rounded-full animate-bounce"
                  style={{
                    backgroundColor: phase.color,
                    opacity: 0.7,
                    animationDelay: `${i * 0.15}s`,
                    animationDuration: '0.8s',
                  }}
                />
              ))}
            </span>
          </span>

          {elapsed > 0 && (
            <span className="text-xs text-text-muted tabular-nums ml-auto">
              {elapsed}s
            </span>
          )}
        </div>

        {/* Progress track */}
        <div className="w-48 h-[2px] rounded-full bg-white/6 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-1600 ease-in-out"
            style={{
              width: `${(phaseIdx + 1) * 25}%`,
              backgroundColor: phase.color,
              opacity: 0.6,
            }}
          />
        </div>
      </div>
    </div>
  );
}
