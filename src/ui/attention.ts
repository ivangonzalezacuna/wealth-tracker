/**
 * Attention trail: when something needs the user's attention, a coloured dot
 * marks the main tab and the sub-tab chip that lead to it, and the card that
 * explains it shows a badge in its header (visible even when collapsed).
 */
import { driftStatus } from '../model/drift';
import { isBackupStale } from '../backup/exportImport';
import { fmtPctVal } from '../utils';
import { attachInfoTips, hideInfoTip } from './infoTip';

export type AttentionLevel = 'warn' | 'alert';

export interface AttentionItem {
  id: 'drift' | 'backup';
  level: AttentionLevel;
  /** Main navigation tab that leads to the item. */
  tabId: string;
  /** Sub-tab chip inside that section. */
  chipId: string;
  /** Card header button that gets a badge, when the card has no status of its own. */
  cardHeadingId?: string;
  badge?: string;
  text: string;
}

export interface AttentionInput {
  maxDrift: number | null;
  driftThresholdPct?: number;
  /** Omit when backup state is unknown (signed out or settings not loaded). */
  backup?: { lastBackupAt?: string; hasData: boolean };
  now?: Date;
}

export function collectAttention(input: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];
  if (input.maxDrift !== null) {
    const status = driftStatus(input.maxDrift, input.driftThresholdPct);
    if (status.level !== 'ok') {
      const high = status.level === 'high';
      const limit = high
        ? `over ${fmtPctVal(status.highThreshold, 'auto')} (high threshold)`
        : `over ${fmtPctVal(status.threshold, 'auto')} (threshold)`;
      items.push({
        id: 'drift',
        level: high ? 'alert' : 'warn',
        tabId: 'tab-portfolio',
        chipId: 'tab-holdings',
        text: `${status.label}: max allocation drift is ${fmtPctVal(input.maxDrift)}, ${limit}`,
      });
    }
  }
  const backup = input.backup;
  if (backup?.hasData && isBackupStale(backup.lastBackupAt, input.now)) {
    items.push({
      id: 'backup',
      level: 'warn',
      tabId: 'tab-settings',
      chipId: 'settings-tab-advanced',
      cardHeadingId: 'settings-heading-backup',
      badge: 'Backup due',
      text: backup.lastBackupAt ? 'Last backup is over 30 days old' : 'No backup yet',
    });
  }
  return items;
}

let _source: (() => AttentionInput) | null = null;
let _items: AttentionItem[] = [];

/** Registers how the current attention state is computed. */
export function setAttentionSource(source: () => AttentionInput): void {
  _source = source;
}

/** Recomputes the attention items and redraws the trail. */
export function refreshAttention(): void {
  if (_source) _items = collectAttention(_source());
  applyAttention();
}

const NO_LABEL = '\u0000';

function clear(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('.attn-dot, .attn-badge').forEach((el) => {
    hideInfoTip(el);
    el.remove();
  });
  root.querySelectorAll<HTMLElement>('[data-attn-label]').forEach((el) => {
    const original = el.dataset.attnLabel!;
    if (original === NO_LABEL) el.removeAttribute('aria-label');
    else el.setAttribute('aria-label', original);
    delete el.dataset.attnLabel;
  });
}

function markWithDot(el: HTMLElement, items: AttentionItem[]): void {
  const level: AttentionLevel = items.some((i) => i.level === 'alert') ? 'alert' : 'warn';
  const text = items.map((i) => i.text).join('. ');
  const name = el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '';
  el.dataset.attnLabel = el.getAttribute('aria-label') ?? NO_LABEL;
  el.setAttribute('aria-label', `${name}, needs attention: ${text}`);
  el.append(tipTrigger(`attn-dot attn-dot--${level}`, text, level, true));
}

// The dot and badge open the app's own popover: hover on desktop (the whole tab for dots),
// tap on touch, where the click stays on the dot instead of switching tabs.
function tipTrigger(
  className: string,
  text: string,
  level: AttentionLevel,
  hoverParent = false,
): HTMLElement {
  const el = document.createElement('span');
  el.className = className;
  el.dataset.tipTrigger = '';
  el.dataset.tip = text;
  el.dataset.tipVariant = level;
  if (hoverParent) {
    el.dataset.tipHover = 'parent';
    el.setAttribute('aria-hidden', 'true');
  }
  return el;
}

function group(items: AttentionItem[], key: 'tabId' | 'chipId'): Map<string, AttentionItem[]> {
  const map = new Map<string, AttentionItem[]>();
  for (const item of items) map.set(item[key], [...(map.get(item[key]) ?? []), item]);
  return map;
}

/** Draws the current trail on whatever part of the page is mounted. */
export function applyAttention(root: Document = document): void {
  clear(root);
  for (const key of ['tabId', 'chipId'] as const) {
    for (const [id, items] of group(_items, key)) {
      const el = root.getElementById(id);
      if (el) markWithDot(el, items);
    }
  }
  for (const item of _items) {
    if (!item.cardHeadingId || !item.badge) continue;
    const title = root.getElementById(item.cardHeadingId)?.querySelector('.card-title');
    if (!title) continue;
    const badge = tipTrigger(`badge attn-badge attn-badge--${item.level}`, item.text, item.level);
    badge.textContent = item.badge;
    title.append(badge);
  }
  attachInfoTips(root);
}

/** Test helper. */
export function resetAttentionForTests(): void {
  _source = null;
  _items = [];
}
