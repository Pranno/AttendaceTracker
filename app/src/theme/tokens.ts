// ============================================================
// Design tokens — the single source of truth for colours (Step 2).
// Every token from the "Design and look" section lives here, so a
// theme change or a palette change needs one edit. The values are
// written into CSS custom properties by ThemeProvider; components
// only ever use var(--token-name).
// ============================================================

export type ThemeName = 'sunrise' | 'midnight'

/** Sunrise (light) / Midnight (dark) — exact hexes from the requirements doc. */
export const THEME_TOKENS: Record<ThemeName, Record<string, string>> = {
  sunrise: {
    bg: '#FFF8F2',
    card: '#FFFFFF',
    text: '#1E1B2E',
    soft: '#6B6580',
    primary: '#D93A32',
    headerFrom: '#7B1E3A',
    headerTo: '#D93A32',
    highlight: '#FFC93C',
    safe: '#1FA35B',
    limit: '#F2A100',
    danger: '#E5383B',
    // On-tile text for subject chips in this theme.
    subjectOnStrong: '#FFFFFF',
  },
  midnight: {
    bg: '#1B1226',
    card: '#2A1E3A',
    text: '#F7F1FF',
    soft: '#B7AECB',
    primary: '#FF5A4F',
    headerFrom: '#3A1458',
    headerTo: '#B02A4B',
    highlight: '#FFC93C',
    safe: '#3DDC84',
    limit: '#FFC24A',
    danger: '#FF6B6B',
    subjectOnStrong: '#1B1226',
  },
}

/** Subject colour pairs, assigned in order (8 colours, cycling past 8 subjects). */
export interface SubjectPalette {
  name: string
  softBg: string
  strong: string
}

export const SUBJECT_PALETTE: SubjectPalette[] = [
  { name: 'Coral',     softBg: '#FFE3DC', strong: '#D9432B' },
  { name: 'Sunshine',  softBg: '#FFF1C2', strong: '#A86B00' },
  { name: 'Mint',      softBg: '#D8F5E6', strong: '#1B8A55' },
  { name: 'Sky',       softBg: '#DCEBFF', strong: '#2563C9' },
  { name: 'Lavender',  softBg: '#E9E2FF', strong: '#5B3FD1' },
  { name: 'Pink',      softBg: '#FFDDEB', strong: '#C2255C' },
  { name: 'Teal',      softBg: '#D2F3F1', strong: '#0F7F7A' },
  { name: 'Peach',     softBg: '#FFE6CF', strong: '#C2570C' },
]

/** Colour pair for a subject by its position in the timetable (assigned in order). */
export function subjectPalette(index: number): SubjectPalette {
  return SUBJECT_PALETTE[index % SUBJECT_PALETTE.length]
}

/** Inline style for a subject tile in either theme. In dark mode the soft
 *  background becomes the strong colour at 25% opacity on the card surface. */
export function subjectTileStyle(index: number, theme: ThemeName): React.CSSProperties {
  const p = subjectPalette(index)
  if (theme === 'midnight') {
    return {
      background: `color-mix(in srgb, ${p.strong} 25%, #2A1E3A)`,
      ['--subj-strong' as string]: p.strong,
      ['--subj-on' as string]: '#F7F1FF',
    }
  }
  return {
    background: p.softBg,
    ['--subj-strong' as string]: p.strong,
    ['--subj-on' as string]: '#FFFFFF',
  }
}

/** status → colour token, used everywhere percentages are coloured (J10). */
export const STATUS_VAR = {
  safe: 'var(--safe)',
  limit: 'var(--limit)',
  below: 'var(--danger)',
  nodata: 'var(--soft)',
} as const
