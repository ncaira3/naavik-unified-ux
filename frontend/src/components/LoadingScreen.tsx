interface LoadingScreenProps {
  message?: string;
}

export default function LoadingScreen({ message = 'Loading...' }: LoadingScreenProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ghost-bg dark:bg-pulse-bg transition-colors">
      <div className="flex flex-col items-center gap-6">
        {/* Animated Aira Logo */}
        <div className="relative">
          {/* Pulsing outer ring */}
          <div
            className="absolute inset-0 rounded-full animate-ping"
            style={{
              backgroundColor: `rgba(100, 116, 139, 0.2)`,
            }}
          />

          {/* Rotating ring */}
          <div
            className="absolute inset-0 rounded-full border-4 border-transparent animate-spin"
            style={{
              borderTopColor: `rgba(148, 163, 184, 0.9)`,
            }}
          />

          {/* Logo container */}
          <div className="relative w-24 h-24 rounded-full bg-cream-surface dark:bg-white/10 shadow-lg flex items-center justify-center animate-pulse-slow">
            <img
              src="/aira-logo.png"
              alt="Aira"
              className="w-16 h-16 object-contain"
            />
          </div>
        </div>

        {/* Loading text */}
        <div className="flex flex-col items-center gap-2">
          <p className="text-sm font-medium text-text-secondary dark:text-white/70">
            {message}
          </p>
          <div className="flex gap-1">
            <div
              className="w-2 h-2 rounded-full animate-bounce"
              style={{
                backgroundColor: `rgba(148, 163, 184, 0.9)`,
                animationDelay: '0ms',
              }}
            />
            <div
              className="w-2 h-2 rounded-full animate-bounce"
              style={{
                backgroundColor: `rgba(148, 163, 184, 0.9)`,
                animationDelay: '150ms',
              }}
            />
            <div
              className="w-2 h-2 rounded-full animate-bounce"
              style={{
                backgroundColor: `rgba(148, 163, 184, 0.9)`,
                animationDelay: '300ms',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
