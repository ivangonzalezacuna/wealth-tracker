/** Attention trail: a dot on the tab and sub-tab chip, and a warning state on the affected card. */
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
  /** Card that shows the warning state. */
  cardId: string;
  /** Header badge, for cards with no status of their own. */
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

/** The drift warning shown on the tabs and the drift card, or null when drift is fine. */
export function driftAttention(
  maxDrift: number,
  thresholdPct?: number,
): { level: AttentionLevel; text: string } | null {
  const status = driftStatus(maxDrift, thresholdPct);
  if (status.level === 'ok') return null;
  const high = status.level === 'high';
  const limit = high
    ? `over ${fmtPctVal(status.highThreshold, 'auto')} (high threshold)`
    : `over ${fmtPctVal(status.threshold, 'auto')} (threshold)`;
  return {
    level: high ? 'alert' : 'warn',
    text: `${status.label}: max allocation drift is ${fmtPctVal(maxDrift)}, ${limit}`,
  };
}

export function collectAttention(input: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];
  const drift =
    input.maxDrift === null ? null : driftAttention(input.maxDrift, input.driftThresholdPct);
  if (drift)
    items.push({
      id: 'drift',
      ...drift,
      tabId: 'tab-portfolio',
      chipId: 'tab-holdings',
      cardId: 'port-drift-card',
    });
  const backup = input.backup;
  if (backup?.hasData && isBackupStale(backup.lastBackupAt, input.now)) {
    items.push({
      id: 'backup',
      level: 'warn',
      tabId: 'tab-settings',
      chipId: 'settings-tab-advanced',
      cardId: 'settings-card-backup',
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
const CARD_CLASSES = ['attn-card', 'attn-card--warn', 'attn-card--alert'];

function clear(root: Document): void {
  root.querySelectorAll<HTMLElement>('.attn-dot, .attn-badge').forEach((el) => {
    hideInfoTip(el);
    el.remove();
  });
  root.querySelectorAll('.attn-card').forEach((el) => el.classList.remove(...CARD_CLASSES));
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
  const dot = tipTrigger(`attn-dot attn-dot--${level}`, text, level);
  // Navigation dots explain on hover but never intercept selection.
  dot.dataset.tipClick = 'navigate';
  dot.setAttribute('aria-hidden', 'true');
  el.append(dot);
}

function tipTrigger(className: string, text: string, level: AttentionLevel): HTMLElement {
  const el = document.createElement('span');
  el.className = className;
  el.dataset.tipTrigger = '';
  el.dataset.tip = text;
  el.dataset.tipVariant = level;
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
    const card = root.getElementById(item.cardId);
    if (!card) continue;
    card.classList.add('attn-card', `attn-card--${item.level}`);
    const title = card.querySelector('.card-title');
    if (!item.badge || !title) continue;
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
