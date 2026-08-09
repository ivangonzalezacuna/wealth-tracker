/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { conflictDialog } from './conflictDialog';

describe('conflictDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.querySelector('.conflict-overlay')?.remove();
  });

  it('focuses the backup action by default', () => {
    conflictDialog();
    const backup = document.querySelector('.js-conflict-backup') as HTMLElement;
    expect(document.activeElement).toBe(backup);
  });

  it('returns backup when the safe action is clicked', async () => {
    const p = conflictDialog();
    (document.querySelector('.js-conflict-backup') as HTMLElement).click();
    expect(await p).toBe('backup');
  });

  it('returns keep-local when the overwrite action is clicked', async () => {
    const p = conflictDialog();
    (document.querySelector('.js-conflict-keep-local') as HTMLElement).click();
    expect(await p).toBe('keep-local');
  });

  it('returns keep-cloud when the replace action is clicked', async () => {
    const p = conflictDialog();
    (document.querySelector('.js-conflict-keep-cloud') as HTMLElement).click();
    expect(await p).toBe('keep-cloud');
  });

  it('returns cancel on escape', async () => {
    const p = conflictDialog();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(await p).toBe('cancel');
  });

  it('returns cancel when a second dialog replaces the first', async () => {
    const p1 = conflictDialog();
    const p2 = conflictDialog();
    expect(await p1).toBe('cancel');
    (document.querySelector('.js-conflict-cancel') as HTMLElement).click();
    expect(await p2).toBe('cancel');
  });
});
