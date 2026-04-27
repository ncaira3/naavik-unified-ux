import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

export interface Operator {
  id: string;
  name: string;
  primary: string;      // Main brand color (hex)
  onPrimary: string;    // Text color on primary (hex)
  light: string;        // Light tint for backgrounds (hex)
}

const OPERATORS: Record<string, Operator> = {
  att: {
    id: 'att',
    name: 'AT&T',
    primary: '#00A8E0',
    onPrimary: '#FFFFFF',
    light: '#E0F4FB',
  },
  tmobile: {
    id: 'tmobile',
    name: 'T-Mobile',
    primary: '#E20074',
    onPrimary: '#FFFFFF',
    light: '#FCE4F1',
  },
  orange: {
    id: 'orange',
    name: 'Orange',
    primary: '#FF7900',
    onPrimary: '#FFFFFF',
    light: '#FFF0E6',
  },
  mtn: {
    id: 'mtn',
    name: 'MTN',
    primary: '#FFCB00',
    onPrimary: '#1F2937',
    light: '#FFFAEC',
  },
  vodafone: {
    id: 'vodafone',
    name: 'Vodafone',
    primary: '#5C5C5C',
    onPrimary: '#FFFFFF',
    light: '#F3F3F3',
  },
  dt: {
    id: 'dt',
    name: 'Deutsche Telekom',
    primary: '#E4007F',
    onPrimary: '#FFFFFF',
    light: '#FCE4F1',
  },
  bt: {
    id: 'bt',
    name: 'BT',
    primary: '#591895',
    onPrimary: '#FFFFFF',
    light: '#F4E5FB',
  },
  o2: {
    id: 'o2',
    name: 'O2 / Telefónica',
    primary: '#00B0EA',
    onPrimary: '#FFFFFF',
    light: '#E0F4FB',
  },
  stc: {
    id: 'stc',
    name: 'STC',
    primary: '#7B2D8B',
    onPrimary: '#FFFFFF',
    light: '#F4E5FB',
  },
  etisalat: {
    id: 'etisalat',
    name: 'e&',
    primary: '#009A44',
    onPrimary: '#FFFFFF',
    light: '#E6F7ED',
  },
  safaricom: {
    id: 'safaricom',
    name: 'Safaricom',
    primary: '#00B300',
    onPrimary: '#FFFFFF',
    light: '#E6F7ED',
  },
  zain: {
    id: 'zain',
    name: 'Zain',
    primary: '#0066CC',
    onPrimary: '#FFFFFF',
    light: '#E6F0FF',
  },
  chinamobile: {
    id: 'chinamobile',
    name: 'China Mobile',
    primary: '#009900',
    onPrimary: '#FFFFFF',
    light: '#E6F7ED',
  },
  ntt: {
    id: 'ntt',
    name: 'NTT',
    primary: '#003087',
    onPrimary: '#FFFFFF',
    light: '#E6F0FF',
  },
  telus: {
    id: 'telus',
    name: 'TELUS',
    primary: '#4B286D',
    onPrimary: '#FFFFFF',
    light: '#F4E5FB',
  },
  rogers: {
    id: 'rogers',
    name: 'Rogers',
    primary: '#002D6E',
    onPrimary: '#FFFFFF',
    light: '#E6F0FF',
  },
  optus: {
    id: 'optus',
    name: 'Optus',
    primary: '#1B9E3E',
    onPrimary: '#FFFFFF',
    light: '#E6F7ED',
  },
  aira: {
    id: 'aira',
    name: 'Aira Default',
    primary: '#767676',
    onPrimary: '#FFFFFF',
    light: '#F1F5F9',
  },
};

interface TenantContextType {
  currentOperator: Operator;
  allOperators: Operator[];
  setOperator: (operatorId: string) => void;
}

const TenantContext = createContext<TenantContextType | undefined>(undefined);

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

interface HslColor {
  h: number;
  s: number;
  l: number;
}

const FALLBACK_RGB: RgbColor = { r: 139, g: 92, b: 246 };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const hexToRgb = (hex: string): RgbColor | null => {
  const normalized = hex.replace('#', '');
  const expanded = normalized.length === 3
    ? normalized.split('').map((char) => char + char).join('')
    : normalized;

  const result = /^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(expanded);
  if (!result) return null;

  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  };
};

const rgbToCss = ({ r, g, b }: RgbColor) => `${r} ${g} ${b}`;

const rgbToHsl = ({ r, g, b }: RgbColor): HslColor => {
  const nr = r / 255;
  const ng = g / 255;
  const nb = b / 255;
  const max = Math.max(nr, ng, nb);
  const min = Math.min(nr, ng, nb);
  const delta = max - min;
  const lightness = (max + min) / 2;

  if (delta === 0) {
    return { h: 0, s: 0, l: lightness };
  }

  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;

  switch (max) {
    case nr:
      hue = ((ng - nb) / delta) % 6;
      break;
    case ng:
      hue = (nb - nr) / delta + 2;
      break;
    default:
      hue = (nr - ng) / delta + 4;
      break;
  }

  return {
    h: hue * 60 < 0 ? hue * 60 + 360 : hue * 60,
    s: saturation,
    l: lightness,
  };
};

const hslToRgb = ({ h, s, l }: HslColor): RgbColor => {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const hueSegment = h / 60;
  const x = chroma * (1 - Math.abs((hueSegment % 2) - 1));
  let red = 0;
  let green = 0;
  let blue = 0;

  if (hueSegment >= 0 && hueSegment < 1) {
    red = chroma;
    green = x;
  } else if (hueSegment < 2) {
    red = x;
    green = chroma;
  } else if (hueSegment < 3) {
    green = chroma;
    blue = x;
  } else if (hueSegment < 4) {
    green = x;
    blue = chroma;
  } else if (hueSegment < 5) {
    red = x;
    blue = chroma;
  } else {
    red = chroma;
    blue = x;
  }

  const match = l - chroma / 2;
  return {
    r: Math.round((red + match) * 255),
    g: Math.round((green + match) * 255),
    b: Math.round((blue + match) * 255),
  };
};

const relativeLuminance = ({ r, g, b }: RgbColor) => {
  const toLinear = (channel: number) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : Math.pow((normalized + 0.055) / 1.055, 2.4);
  };

  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
};

const getReadableForeground = (color: RgbColor): RgbColor => (
  relativeLuminance(color) > 0.38
    ? { r: 15, g: 23, b: 42 }
    : { r: 255, g: 255, b: 255 }
);

const deriveBrandTokens = (operator: Operator) => {
  const primaryRgb = hexToRgb(operator.primary) ?? FALLBACK_RGB;
  const baseHsl = rgbToHsl(primaryRgb);
  const isNeutralBrand = baseHsl.s < 0.12;

  const accentHue = baseHsl.h;
  const accentSaturation = isNeutralBrand
    ? 0
    : clamp(baseHsl.s * 0.82, 0.45, 0.74);
  const accentLightness = isNeutralBrand
    ? 0.46
    : clamp(baseHsl.l, 0.4, 0.52);

  // For neutral brands (e.g. Aira default), keep all derived tokens pure gray (s=0)
  const accentRgb = hslToRgb({ h: accentHue, s: accentSaturation, l: accentLightness });

  const accentHoverRgb = isNeutralBrand
    ? hslToRgb({ h: 0, s: 0, l: clamp(accentLightness - 0.08, 0.3, 0.46) })
    : hslToRgb({ h: accentHue, s: clamp(accentSaturation + 0.06, 0.4, 0.82), l: clamp(accentLightness - 0.08, 0.3, 0.46) });

  const accentSoftRgb = isNeutralBrand
    ? hslToRgb({ h: 0, s: 0, l: 0.93 })
    : hslToRgb({ h: accentHue, s: clamp(accentSaturation * 0.48, 0.18, 0.42), l: 0.93 });

  const accentMutedRgb = isNeutralBrand
    ? hslToRgb({ h: 0, s: 0, l: 0.86 })
    : hslToRgb({ h: accentHue, s: clamp(accentSaturation * 0.58, 0.2, 0.46), l: 0.86 });

  const accentForegroundRgb = getReadableForeground(accentRgb);

  return {
    primary: primaryRgb,
    light: accentSoftRgb,
    accent: accentRgb,
    accentHover: accentHoverRgb,
    accentSoft: accentSoftRgb,
    accentMuted: accentMutedRgb,
    accentForeground: accentForegroundRgb,
  };
};

const deriveScale = (baseHue: number, baseSaturation: number) => ({
  50: hslToRgb({ h: baseHue, s: clamp(baseSaturation * 0.22, 0.08, 0.18), l: 0.97 }),
  100: hslToRgb({ h: baseHue, s: clamp(baseSaturation * 0.3, 0.1, 0.24), l: 0.93 }),
  200: hslToRgb({ h: baseHue, s: clamp(baseSaturation * 0.42, 0.14, 0.34), l: 0.86 }),
  300: hslToRgb({ h: baseHue, s: clamp(baseSaturation * 0.56, 0.22, 0.48), l: 0.74 }),
  400: hslToRgb({ h: baseHue, s: clamp(baseSaturation * 0.72, 0.34, 0.62), l: 0.62 }),
  500: hslToRgb({ h: baseHue, s: clamp(baseSaturation, 0.45, 0.74), l: 0.5 }),
  600: hslToRgb({ h: baseHue, s: clamp(baseSaturation + 0.04, 0.48, 0.8), l: 0.44 }),
  700: hslToRgb({ h: baseHue, s: clamp(baseSaturation + 0.02, 0.42, 0.76), l: 0.36 }),
  800: hslToRgb({ h: baseHue, s: clamp(baseSaturation * 0.8, 0.28, 0.62), l: 0.28 }),
  900: hslToRgb({ h: baseHue, s: clamp(baseSaturation * 0.7, 0.22, 0.52), l: 0.21 }),
});

const TENANT_STORAGE_KEY = 'naavik-tenant';

const readStoredOperator = (): Operator => {
  if (typeof window === 'undefined') return OPERATORS.aira;
  try {
    const savedOperatorId = window.localStorage.getItem(TENANT_STORAGE_KEY);
    if (savedOperatorId && OPERATORS[savedOperatorId]) {
      return OPERATORS[savedOperatorId];
    }
  } catch {
    // localStorage may be unavailable (private mode / SSR) — fall through to default.
  }
  return OPERATORS.aira;
};

export const TenantProvider = ({ children }: { children: ReactNode }) => {
  // Lazy initializer reads localStorage synchronously so the first render
  // already has the correct operator — avoids a flash of the default brand and
  // prevents the save-effect from racing with a separate load-effect (which
  // under StrictMode could overwrite the stored value with the default).
  const [currentOperator, setCurrentOperator] = useState<Operator>(readStoredOperator);

  // Update CSS variables whenever operator changes
  useEffect(() => {
    const root = document.documentElement;
    const tokens = deriveBrandTokens(currentOperator);
    const onPrimaryRgb = hexToRgb(currentOperator.onPrimary) ?? tokens.accentForeground;
    const accentHsl = rgbToHsl(tokens.accent);
    const skyScale = deriveScale(accentHsl.h, accentHsl.s);

    root.style.setProperty('--tenant-primary-rgb', rgbToCss(tokens.primary));
    root.style.setProperty('--tenant-on-primary-rgb', rgbToCss(onPrimaryRgb));
    root.style.setProperty('--tenant-light-rgb', rgbToCss(tokens.light));
    root.style.setProperty('--tenant-accent-rgb', rgbToCss(tokens.accent));
    root.style.setProperty('--tenant-accent-hover-rgb', rgbToCss(tokens.accentHover));
    root.style.setProperty('--tenant-accent-soft-rgb', rgbToCss(tokens.accentSoft));
    root.style.setProperty('--tenant-accent-muted-rgb', rgbToCss(tokens.accentMuted));
    root.style.setProperty('--tenant-accent-foreground-rgb', rgbToCss(tokens.accentForeground));
    root.style.setProperty('--brand-sky-50-rgb', rgbToCss(skyScale[50]));
    root.style.setProperty('--brand-sky-100-rgb', rgbToCss(skyScale[100]));
    root.style.setProperty('--brand-sky-200-rgb', rgbToCss(skyScale[200]));
    root.style.setProperty('--brand-sky-300-rgb', rgbToCss(skyScale[300]));
    root.style.setProperty('--brand-sky-400-rgb', rgbToCss(skyScale[400]));
    root.style.setProperty('--brand-sky-500-rgb', rgbToCss(skyScale[500]));
    root.style.setProperty('--brand-sky-600-rgb', rgbToCss(skyScale[600]));
    root.style.setProperty('--brand-sky-700-rgb', rgbToCss(skyScale[700]));
    root.style.setProperty('--brand-sky-800-rgb', rgbToCss(skyScale[800]));
    root.style.setProperty('--brand-sky-900-rgb', rgbToCss(skyScale[900]));

    // Persist to localStorage — wrapped so a storage failure (quota, private
    // mode) doesn't break the rest of the brand-theming pipeline.
    try {
      window.localStorage.setItem(TENANT_STORAGE_KEY, currentOperator.id);
    } catch {
      /* ignore */
    }
  }, [currentOperator]);

  const handleSetOperator = (operatorId: string) => {
    if (OPERATORS[operatorId]) {
      setCurrentOperator(OPERATORS[operatorId]);
    }
  };

  return (
    <TenantContext.Provider
      value={{
        currentOperator,
        allOperators: Object.values(OPERATORS),
        setOperator: handleSetOperator,
      }}
    >
      {children}
    </TenantContext.Provider>
  );
};

export const useTenant = () => {
  const context = useContext(TenantContext);
  if (context === undefined) {
    throw new Error('useTenant must be used within a TenantProvider');
  }
  return context;
};
