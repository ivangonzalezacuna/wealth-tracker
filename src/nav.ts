// ── Hash-based navigation helpers ────────────────────────
const VALID_SECTIONS = ['networth', 'portfolio', 'settings', 'log', 'analytics'] as const;
const VALID_SUBVIEWS = ['holdings', 'contributions', 'dividends'] as const;
export const LOG_VIEWS = ['transactions', 'snapshots'] as const;
export type LogView = (typeof LOG_VIEWS)[number];
export const SETTINGS_VIEWS = ['portfolio', 'planning', 'advanced'] as const;
export type SettingsView = (typeof SETTINGS_VIEWS)[number];

/** Compute the canonical hash for the current nav state. */
export function navHash(section: string, subview?: string): string {
  if (section === 'portfolio' && subview && subview !== 'holdings') {
    return `#portfolio/${subview}`;
  }
  if (section === 'log' && subview === 'snapshots') {
    return '#log/snapshots';
  }
  if (section === 'settings' && subview && subview !== 'portfolio') {
    if ((SETTINGS_VIEWS as readonly string[]).includes(subview)) return `#settings/${subview}`;
  }
  return `#${section}`;
}

/** Parse a hash string into { section, subview }. */
export function parseNavHash(hash: string): { section: string; subview: string | null } {
  const cleaned = hash.replace(/^#/, '');
  const [section, subview] = cleaned.split('/');
  const validSection = (VALID_SECTIONS as readonly string[]).includes(section)
    ? section
    : 'networth';
  if (validSection === 'portfolio') {
    const validSubview = (VALID_SUBVIEWS as readonly string[]).includes(subview) ? subview : null;
    return { section: validSection, subview: validSubview };
  }
  if (validSection === 'log') {
    const validSubview = (LOG_VIEWS as readonly string[]).includes(subview) ? subview : null;
    return { section: validSection, subview: validSubview };
  }
  if (validSection === 'settings') {
    const validSubview = (SETTINGS_VIEWS as readonly string[]).includes(subview) ? subview : null;
    return { section: validSection, subview: validSubview };
  }
  return { section: validSection, subview: null };
}
