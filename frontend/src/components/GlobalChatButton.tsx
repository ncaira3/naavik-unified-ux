/**
 * Global Chat Button
 * Floating chat button accessible from all screens
 * Red Aira icon on white (dark theme) or dark gray (light theme) background
 */
import { X } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

interface GlobalChatButtonProps {
  onClick: () => void;
  isOpen: boolean;
  unreadCount?: number;
}

export default function GlobalChatButton({ onClick, isOpen, unreadCount = 0 }: GlobalChatButtonProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      onClick={onClick}
      className={`fixed bottom-6 right-6 z-40 group transition-all duration-300 ${
        isOpen ? 'scale-95' : 'hover:scale-110'
      }`}
      title={isOpen ? 'Close Aira Assistant' : 'Open Aira Assistant'}
    >
      {/* Main button */}
      <div className="relative">
        {/* Glow effect */}
        <div className={`absolute inset-0 rounded-full blur-xl opacity-40 group-hover:opacity-60 transition-opacity ${
          isDark ? 'bg-cream-surface' : 'bg-gray-600'
        }`} />
        
        {/* Button content: white bg in dark theme, dark gray in light theme */}
        <div className={`relative w-16 h-16 rounded-full shadow-2xl flex items-center justify-center ${
          isDark ? 'bg-cream-surface' : 'bg-gray-700'
        }`}>
          {isOpen ? (
            <X className={`w-7 h-7 ${isDark ? 'text-text-primary' : 'text-white'}`} />
          ) : (
            <>
              <img src="/aira-logo.png" alt="Aira" className="w-9 h-9 object-contain" />
              
              {/* Unread badge */}
              {unreadCount > 0 && (
                <div className="absolute -top-1 -right-1 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center text-xs font-bold border-2 border-white dark:border-gray-900">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      
      {/* Pulsing indicator when closed */}
      {!isOpen && (
        <div className={`absolute inset-0 rounded-full animate-ping opacity-20 ${
          isDark ? 'bg-cream-surface' : 'bg-gray-600'
        }`} />
      )}
    </button>
  );
}
