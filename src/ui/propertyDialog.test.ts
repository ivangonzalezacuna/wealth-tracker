/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { propertyDialog } from './propertyDialog';
import type { Property } from '../model/properties';

const home: Property = {
  id: 'home',
  label: 'Home',
  use: 'Home',
  value: 420000,
  share: 50,
  valueDate: '2026-01-01',
  mortgage: 'known',
  debt: 140000,
  debtDate: '2026-01-01',
};
const input = (id: string) => document.getElementById(`property-${id}`) as HTMLInputElement;
function fill(id: string, value: string) {
  input(id).value = value;
  input(id).dispatchEvent(new Event('input', { bubbles: true }));
}
function submit() {
  document
    .querySelector('form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}
function cancel() {
  (document.querySelector('.js-property-cancel') as HTMLButtonElement).click();
}

describe('property dialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  it('starts unknown rather than assuming debt-free and does not save on cancel', async () => {
    const save = vi.fn();
    const result = propertyDialog({ onSave: save });
    expect(input('mortgage').value).toBe('unknown');
    expect(input('debt').disabled).toBe(true);
    fill('value', '420000');
    fill('share', '50');
    expect(document.getElementById('property-preview')?.textContent).toContain(
      'Not calculated yet',
    );
    cancel();
    expect(await result).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });
  it('calculates only personal equity and saves the direct personal debt', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const result = propertyDialog({ existing: home, onSave: save });
    fill('debt', '130000');
    const preview = document.getElementById('property-preview')!;
    expect(preview.textContent).toContain('80.000');
    fill('value', '');
    expect(preview.textContent).not.toContain('80.000');
    fill('value', '420000');
    submit();
    expect(await result).toBe(true);
    expect(save.mock.calls[0][0]).toEqual({ ...home, debt: 130000 });
  });
  it('retains user input on write failure and allows a retry', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error('Storage unavailable'))
      .mockResolvedValueOnce(undefined);
    const result = propertyDialog({ existing: home, onSave: save });
    fill('name', 'Updated home');
    submit();
    await vi.waitFor(() =>
      expect(document.getElementById('property-error')?.textContent).toContain(
        'Storage unavailable',
      ),
    );
    expect(input('name').value).toBe('Updated home');
    expect(document.querySelector('.property-dialog-overlay')).not.toBeNull();
    submit();
    expect(await result).toBe(true);
  });
  it('blocks blank names and out-of-range shares', async () => {
    const save = vi.fn();
    const result = propertyDialog({ existing: home, onSave: save });
    fill('name', '   ');
    submit();
    expect(document.getElementById('property-error')?.textContent).toContain('property name');
    fill('name', 'Home');
    fill('share', '101');
    submit();
    expect(save).not.toHaveBeenCalled();
    cancel();
    await result;
  });
});
