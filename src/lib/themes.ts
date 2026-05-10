export interface ThemePreset {
  id: string;
  label: string;
  icon: string;
  description: string;
  colors: {
    primary: string;        // hex (preview)
    primaryHsl: string;     // "H S% L%" para Tailwind via hsl(var(--primary))
    accent: string;
    accentHsl: string;
    bg: string;
    surface: string;
    text: string;
    textMuted: string;
  };
  fonts: {
    heading: string;
    body: string;
  };
  bgPattern?: string;
}

export const THEMES: Record<string, ThemePreset> = {
  padrao: {
    id: 'padrao',
    label: 'Genérico',
    icon: '🍽️',
    description: 'Visual neutro e limpo. Bom para qualquer tipo de negócio que não se encaixe em um vertical específico.',
    colors: {
      primary: '#16a34a',
      primaryHsl: '142 76% 36%',
      accent: '#f59e0b',
      accentHsl: '38 92% 50%',
      bg: '#FAFAF7',
      surface: '#ffffff',
      text: '#1e293b',
      textMuted: '#64748b',
    },
    fonts: {
      heading: "'Inter', system-ui, sans-serif",
      body: "'Inter', system-ui, sans-serif",
    },
  },
  marmitaria: {
    id: 'marmitaria',
    label: 'Marmitaria',
    icon: '🍱',
    description: 'Tons quentes e acolhedores, fonte rústica. Comida caseira e fresquinha.',
    colors: {
      primary: '#c2410c',
      primaryHsl: '21 88% 40%',
      accent: '#fbbf24',
      accentHsl: '43 96% 56%',
      bg: '#fefaf3',
      surface: '#ffffff',
      text: '#3f2517',
      textMuted: '#92847a',
    },
    fonts: {
      heading: "'Roboto Slab', Georgia, serif",
      body: "'Inter', system-ui, sans-serif",
    },
    bgPattern: 'linear-gradient(135deg, #fefaf3 0%, #fef3e2 100%)',
  },
  confeitaria: {
    id: 'confeitaria',
    label: 'Confeitaria',
    icon: '🎂',
    description: 'Rosa pastel com dourado, tipografia elegante. Doces, bolos e sobremesas.',
    colors: {
      primary: '#be185d',
      primaryHsl: '336 78% 42%',
      accent: '#d4af37',
      accentHsl: '46 65% 52%',
      bg: '#fef7f7',
      surface: '#ffffff',
      text: '#4a1e2e',
      textMuted: '#9c7585',
    },
    fonts: {
      heading: "'Playfair Display', Georgia, serif",
      body: "'Inter', system-ui, sans-serif",
    },
    bgPattern: 'linear-gradient(135deg, #fef7f7 0%, #fce7f3 100%)',
  },
  pizzaria: {
    id: 'pizzaria',
    label: 'Pizzaria',
    icon: '🍕',
    description: 'Vermelho intenso e tipografia condensada. Pizza, hambúrguer e fast food.',
    colors: {
      primary: '#dc2626',
      primaryHsl: '0 72% 51%',
      accent: '#facc15',
      accentHsl: '48 96% 53%',
      bg: '#fafaf9',
      surface: '#ffffff',
      text: '#1c1917',
      textMuted: '#78716c',
    },
    fonts: {
      heading: "'Bebas Neue', Impact, sans-serif",
      body: "'Inter', system-ui, sans-serif",
    },
    bgPattern: 'linear-gradient(135deg, #fafaf9 0%, #fef2f2 100%)',
  },
  sucaria: {
    id: 'sucaria',
    label: 'Sucaria & Açaí',
    icon: '🥤',
    description: 'Verde lima vibrante e amarelo cítrico. Sucos, vitaminas, açaís e bebidas naturais.',
    colors: {
      primary: '#65a30d',
      primaryHsl: '82 85% 34%',
      accent: '#facc15',
      accentHsl: '48 96% 53%',
      bg: '#f7fee7',
      surface: '#ffffff',
      text: '#1a2e05',
      textMuted: '#65784a',
    },
    fonts: {
      heading: "'Quicksand', 'Inter', sans-serif",
      body: "'Inter', system-ui, sans-serif",
    },
    bgPattern: 'linear-gradient(135deg, #f7fee7 0%, #fefce8 100%)',
  },
};

export const THEME_LIST: ThemePreset[] = Object.values(THEMES);

export const DEFAULT_THEME = THEMES.padrao;

export function getTheme(id?: string | null): ThemePreset {
  if (!id) return DEFAULT_THEME;
  return THEMES[id] || DEFAULT_THEME;
}

export function themeToCssVars(theme: ThemePreset): React.CSSProperties {
  return {
    // Sobrescreve as vars que o Tailwind usa via hsl(var(--primary))
    ['--primary' as any]: theme.colors.primaryHsl,
    ['--accent' as any]: theme.colors.accentHsl,
    ['--ring' as any]: theme.colors.primaryHsl,
    // Vars de marca para uso direto se necessário
    ['--brand-primary' as any]: theme.colors.primary,
    ['--brand-accent' as any]: theme.colors.accent,
    ['--brand-bg' as any]: theme.colors.bg,
    ['--brand-surface' as any]: theme.colors.surface,
    ['--brand-text' as any]: theme.colors.text,
    ['--brand-text-muted' as any]: theme.colors.textMuted,
    ['--brand-font-heading' as any]: theme.fonts.heading,
    ['--brand-font-body' as any]: theme.fonts.body,
    background: theme.bgPattern || theme.colors.bg,
    fontFamily: theme.fonts.body,
  } as React.CSSProperties;
}

export const GOOGLE_FONTS_LINK =
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Roboto+Slab:wght@400;500;700;900&family=Playfair+Display:wght@400;600;700;900&family=Bebas+Neue&family=Quicksand:wght@400;500;600;700&display=swap';

export function ensureBrandFontsLoaded() {
  if (typeof document === 'undefined') return;
  const linkId = 'brand-fonts-link';
  if (document.getElementById(linkId)) return;
  const link = document.createElement('link');
  link.id = linkId;
  link.rel = 'stylesheet';
  link.href = GOOGLE_FONTS_LINK;
  document.head.appendChild(link);
}
