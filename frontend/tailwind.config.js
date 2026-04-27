/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      // ============================================
      // MODERNIZED COLOR SYSTEM
      // Enterprise SaaS + Dark-First Design
      // ============================================
      colors: {
        // PRIMARY: Modern Sky Blue (interactive elements)
        'sky': {
          50:  'rgb(var(--brand-sky-50-rgb) / <alpha-value>)',
          100: 'rgb(var(--brand-sky-100-rgb) / <alpha-value>)',
          200: 'rgb(var(--brand-sky-200-rgb) / <alpha-value>)',
          300: 'rgb(var(--brand-sky-300-rgb) / <alpha-value>)',
          400: 'rgb(var(--brand-sky-400-rgb) / <alpha-value>)',
          500: 'rgb(var(--brand-sky-500-rgb) / <alpha-value>)',
          600: 'rgb(var(--brand-sky-600-rgb) / <alpha-value>)',
          700: 'rgb(var(--brand-sky-700-rgb) / <alpha-value>)',
          800: 'rgb(var(--brand-sky-800-rgb) / <alpha-value>)',
          900: 'rgb(var(--brand-sky-900-rgb) / <alpha-value>)',
        },

        // SECONDARY: Cyan (accents, secondary actions)
        'cyan': {
          50:  '#F0FDFA',
          100: '#CCFBF1',
          200: '#99F6E4',
          300: '#5EEAD4',
          400: '#2DD4BF',
          500: '#06B6D4',   // ← SECONDARY
          600: '#0891B2',
          700: '#0E7490',
          800: '#155E75',
          900: '#164E63',
        },

        // SEMANTIC: Success, Warning, Error
        'emerald': {
          50:  '#F0FDF4',
          100: '#DBEAFE',
          600: '#059669',
          700: '#047857',
        },
        'amber': {
          50:  '#FFFBEB',
          100: '#FEF3C7',
          600: '#D97706',
          700: '#B45309',
        },
        'red': {
          50:  '#FEF2F2',
          100: '#FEE2E2',
          600: '#DC2626',
          700: '#B91C1C',
        },

        // NEUTRAL: Gray scale for light & dark modes
        'slate': {
          50:  '#F8FAFC',
          100: '#F1F5F9',
          200: '#E2E8F0',
          300: '#CBD5E1',
          400: '#94A3B8',
          500: '#64748B',
          600: '#475569',
          700: '#334155',
          800: '#1E293B',
          900: '#0F172A',   // ← DARK MODE PRIMARY BG
        },

        // ============================================================
        // SEMANTIC TOKENS (Theme-aware via CSS variables)
        // ------------------------------------------------------------
        // These power shared classnames across the codebase:
        // - text-text-primary / secondary / muted
        // - bg-bg-primary / secondary / tertiary (AppGen + shared UI)
        // - bg-cream-* and border-cream-border (legacy naming)
        // - border-border
        // ============================================================
        'text': {
          primary:   'rgb(var(--naavik-text-primary-rgb) / <alpha-value>)',
          secondary: 'rgb(var(--naavik-text-secondary-rgb) / <alpha-value>)',
          muted:     'rgb(var(--naavik-text-muted-rgb) / <alpha-value>)',
          // Optional semantic signals (kept as constants for now)
          error:     '#FCA5A5',
          success:   '#86EFAC',
          warning:   '#FCD34D',

          // Light-prefixed tokens used widely in existing components.
          // They resolve to the same theme-aware values to prevent "missing class" bugs.
          light: {
            primary:   'rgb(var(--naavik-text-primary-rgb) / <alpha-value>)',
            secondary: 'rgb(var(--naavik-text-secondary-rgb) / <alpha-value>)',
            muted:     'rgb(var(--naavik-text-muted-rgb) / <alpha-value>)',
          },
        },

        // AppGen + shared surface tokens (theme-aware)
        'bg': {
          primary:   'rgb(var(--naavik-surface-0-rgb) / <alpha-value>)',
          secondary: 'rgb(var(--naavik-surface-1-rgb) / <alpha-value>)',
          tertiary:  'rgb(var(--naavik-surface-2-rgb) / <alpha-value>)',
        },
        'border': 'rgb(var(--naavik-border-rgb) / <alpha-value>)',

        // Legacy "cream" naming used throughout light surfaces.
        'cream': {
          bg:            'rgb(var(--naavik-surface-0-rgb) / <alpha-value>)',
          surface:       'rgb(var(--naavik-surface-1-rgb) / <alpha-value>)',
          'surface-light': 'rgb(var(--naavik-surface-2-rgb) / <alpha-value>)',
          border:        'rgb(var(--naavik-border-rgb) / <alpha-value>)',
        },
        'accent':      'rgb(var(--tenant-accent-rgb) / <alpha-value>)',
        'accent-hover': 'rgb(var(--tenant-accent-hover-rgb) / <alpha-value>)',
        /* Fixed neutral button accent — not operator-driven */
        'ui-btn':      'rgb(var(--ui-btn-rgb) / <alpha-value>)',
        'ui-btn-hover': 'rgb(var(--ui-btn-hover-rgb) / <alpha-value>)',
        'ui-btn-fg':   'rgb(var(--ui-btn-fg-rgb) / <alpha-value>)',

        'tenant': {
          'raw':        'rgb(var(--tenant-primary-rgb) / <alpha-value>)',
          'primary':    'rgb(var(--tenant-accent-rgb) / <alpha-value>)',
          'on-primary': 'rgb(var(--tenant-accent-foreground-rgb) / <alpha-value>)',
          'light':      'rgb(var(--tenant-accent-soft-rgb) / <alpha-value>)',
          'muted':      'rgb(var(--tenant-accent-muted-rgb) / <alpha-value>)',
        },

        'aira': {
          'bg':               '#111111',
          'surface':          '#1c1c1e',
          'surface-elevated': '#242424',
          'border':           'rgba(255,255,255,0.10)',
          'border-focus':     'rgba(255,255,255,0.24)',
          'primary':          '#F1F5F9',
          'muted':            '#94A3B8',
          'muted-light':      '#CBD5E1',
          'accent':           'rgb(var(--tenant-accent-rgb) / <alpha-value>)',
          'accent-hover':     'rgb(var(--tenant-accent-hover-rgb) / <alpha-value>)',
          'accent-light':     'rgb(var(--tenant-accent-soft-rgb) / <alpha-value>)',
          'accent-green':     '#34D399',
          'card':             '#1c1c1e',
          'card-hover':       '#282828',
        },

        // Legacy: Light theme (rarely used, keep for compatibility)
        'ghost': {
          'bg':            '#F8FAFC',
          'surface':       '#FFFFFF',
          'surface-alt':   '#F1F5F9',
          'border':        '#E2E8F0',
          'border-strong': '#CBD5E1',
        },

        // Dark theme — Glassmorphism (matches uploaded theme spec)
        'pulse': {
          'bg':             '#0A0A0A',    // Near-black page background
          'surface':        '#141414',    // Glass panel base (solid eq of rgba(20,20,20,0.7))
          'surface-light':  '#232323',    // Elevated / muted surface
          'border':         '#333333',    // rgba(255,255,255,0.10) solid equivalent
          'border-light':   '#4d4d4d',    // Emphasized border
        },
      },

      // TYPOGRAPHY: Refined hierarchy
      fontSize: {
        // Display/Hero (rarely used, for landing pages or major titles)
        'display-lg': ['48px', { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '700' }],
        'display-md': ['36px', { lineHeight: '1.2', letterSpacing: '-0.02em', fontWeight: '700' }],

        // Headings
        'heading-lg': ['32px', { lineHeight: '1.2', letterSpacing: '-0.01em', fontWeight: '600' }],
        'heading-md': ['24px', { lineHeight: '1.3', fontWeight: '600' }],
        'heading-sm': ['20px', { lineHeight: '1.4', fontWeight: '600' }],

        // Subheadings/Card titles
        'subhead-lg': ['18px', { lineHeight: '1.4', fontWeight: '600' }],
        'subhead-md': ['16px', { lineHeight: '1.5', fontWeight: '600' }],
        'subhead-sm': ['14px', { lineHeight: '1.5', fontWeight: '600' }],

        // Body text
        'body-lg': ['16px', { lineHeight: '1.6', fontWeight: '400' }],
        'body-md': ['14px', { lineHeight: '1.6', fontWeight: '400' }],
        'body-sm': ['13px', { lineHeight: '1.5', fontWeight: '400' }],

        // Captions/Metadata
        'caption-lg': ['13px', { lineHeight: '1.5', fontWeight: '500' }],
        'caption-md': ['12px', { lineHeight: '1.4', fontWeight: '500' }],
        'caption-sm': ['11px', { lineHeight: '1.4', fontWeight: '500' }],

        // Monospace (data, code, timestamps)
        'mono-lg': ['14px', { lineHeight: '1.5', fontFamily: '"SF Mono", "Fira Code", monospace', fontWeight: '400' }],
        'mono-md': ['13px', { lineHeight: '1.5', fontFamily: '"SF Mono", "Fira Code", monospace', fontWeight: '400' }],
        'mono-sm': ['12px', { lineHeight: '1.4', fontFamily: '"SF Mono", "Fira Code", monospace', fontWeight: '400' }],
      },

      // SPACING: 8dp rhythm system
      spacing: {
        'gutter-xs':  '4px',
        'gutter-sm':  '8px',
        'gutter-md':  '16px',
        'gutter-lg':  '24px',
        'gutter-xl':  '32px',
        'gutter-2xl': '48px',
        'gutter-3xl': '64px',
      },

      // SHADOWS: Refined elevation system
      boxShadow: {
        // Subtle elevations (cards, buttons)
        'sm':   '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        'base': '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
        'md':   '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        'lg':   '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
        'xl':   '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',

        // Interactive feedback
        'focus':  '0 0 0 3px rgba(14, 165, 233, 0.1)',
        'glow':   '0 0 20px rgba(14, 165, 233, 0.15)',   // Sky-500 glow
        'glow-sm': '0 0 10px rgba(14, 165, 233, 0.1)',

        // Legacy (backward compatibility)
        'card': '0 1px 3px rgba(0, 0, 0, 0.12), 0 4px 16px rgba(0, 0, 0, 0.08)',
        'aira-md': '0 4px 12px rgba(0, 0, 0, 0.08)',
      },

      // TRANSITIONS: Modern timing
      transitionDuration: {
        'fast':   '100ms',
        'normal': '150ms',
        'slow':   '300ms',
        'slower': '500ms',
      },

      transitionTimingFunction: {
        'ease-sharp':  'cubic-bezier(0.4, 0, 0.2, 1)',      // Exit
        'ease-smooth': 'cubic-bezier(0.34, 1.56, 0.64, 1)', // Enter (slight bounce)
        'ease-bounce': 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
      },

      // ANIMATIONS: Micro-interactions
      animation: {
        // Entrance animations
        'fade-in':       'fadeIn 200ms ease-out',
        'slide-up':      'slideUp 250ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        'slide-down':    'slideDown 250ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        'slide-left':    'slideLeft 300ms ease-smooth',
        'scale-in':      'scaleIn 200ms cubic-bezier(0.16, 1, 0.3, 1)',

        // Loading states
        'pulse-subtle':  'pulseSubtle 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'pulse-slow':    'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'shimmer':       'shimmer 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',

        // Interactive
        'bounce-sm':     'bounceSmall 150ms cubic-bezier(0.4, 0, 0.2, 1)',
        'nav-active':    'navActive 0.25s ease-out',

        // Legacy (fade-up kept for backward compatibility)
        'fade-up':       'fadeUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
      },

      // KEYFRAMES: Animation definitions
      keyframes: {
        fadeIn: {
          'from': { opacity: '0' },
          'to':   { opacity: '1' },
        },
        fadeUp: {
          '0%':   { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideUp: {
          'from': { opacity: '0', transform: 'translateY(12px)' },
          'to':   { opacity: '1', transform: 'translateY(0)' },
        },
        slideDown: {
          'from': { opacity: '0', transform: 'translateY(-12px)' },
          'to':   { opacity: '1', transform: 'translateY(0)' },
        },
        slideLeft: {
          '0%':   { opacity: '0', transform: 'translateX(12px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        scaleIn: {
          'from': { opacity: '0', transform: 'scale(0.95)' },
          'to':   { opacity: '1', transform: 'scale(1)' },
        },
        pulseSubtle: {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.5' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        bounceSmall: {
          '0%, 100%': { transform: 'scale(1)' },
          '50%':      { transform: 'scale(0.95)' },
        },
        navActive: {
          '0%':   { transform: 'scaleX(0)' },
          '100%': { transform: 'scaleX(1)' },
        },
      },

      // BORDERS: Refined border radius
      borderRadius: {
        'none':   '0',
        'sm':     '4px',
        'base':   '6px',
        'md':     '8px',
        'lg':     '12px',
        'xl':     '16px',
        '2xl':    '20px',
        'full':   '9999px',
      },

      // BORDER WIDTH: Standard sizes
      borderWidth: {
        '0': '0',
        '1': '1px',
        '2': '2px',
        '3': '3px',
        '4': '4px',
      },

      // FONT FAMILY: Primary sans-serif
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"SF Mono"', '"Fira Code"', 'monospace'],
      },

      // BACKGROUND IMAGE: Gradients
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic': 'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
      },

      // Z-INDEX: Layering scale
      zIndex: {
        'hide':     '-1',
        'base':     '0',
        'docked':   '10',
        'dropdown': '20',
        'sticky':   '30',
        'fixed':    '40',
        'modal-bg': '50',
        'modal':    '60',
        'popover':  '70',
        'tooltip':  '80',
        'max':      '9999',
      },
    },
  },
  plugins: [],
}
