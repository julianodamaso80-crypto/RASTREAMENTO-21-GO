/**
 * Paleta de marca 21 Go — navy + laranja + limão
 * (designer/manual_marca_21go.pdf). Mesma identidade do dashboard 21 GO.
 */
export const colors = {
  navy: '#293c82',
  navyDark: '#1f2d63',
  navyDeep: '#0f172a',
  orange: '#f2911d',
  orangeDark: '#d97f10',
  orangeSoft: '#f8c075',
  lime: '#c7d301',

  white: '#ffffff',
  bg: '#f8fafc',
  card: '#ffffff',
  border: '#e2e8f0',
  text: '#0f172a',
  textMuted: '#64748b',
  textFaint: '#94a3b8',

  // status
  green: '#16a34a',
  red: '#ef4444',
  amber: '#f59e0b',
} as const;

export const radii = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 } as const;

export const spacing = (n: number) => n * 4;
