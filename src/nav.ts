// ── Hash-based navigation helpers ────────────────────────
const VALID_SECTIONS = ['networth', 'portfolio', 'settings', 'log'] as const;
const VALID_SUBVIEWS = ['holdings', 'contributions', 'dividends'] as const;

/** Compute the canonical hash for the current nav state. */
export function navHash(section: string, subview?: string): string {
  if (section === 'portfolio' && subview && subview !== 'holdings') {
    return `#portfolio/${subview}`;
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
  return { section: validSection, subview: null };
}
