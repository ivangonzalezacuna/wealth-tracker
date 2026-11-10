/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { replaceRoute, trackOverlay, whenOverlayHistorySettled } from './overlayHistory';

const releases: (() => void)[] = [];
const pop = () => window.dispatchEvent(new PopStateEvent('popstate'));
const settle = async () => {
  await vi.runAllTimersAsync();
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(history, 'pushState').mockImplementation(() => {});
  vi.spyOn(history, 'back').mockImplementation(() => {
    queueMicrotask(pop);
  });
});
afterEach(async () => {
  releases
    .splice(0)
    .reverse()
    .forEach((release) => release());
  await settle();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it('Back dismisses only the top overlay through its existing path', async () => {
  const editor = vi.fn();
  releases.push(trackOverlay(editor));
  let release = () => {};
  const confirm = vi.fn(() => release());
  release = trackOverlay(confirm);
  releases.push(release);
  pop();
  await settle();
  expect(confirm).toHaveBeenCalledOnce();
  expect(editor).not.toHaveBeenCalled();
});
it('retains a refused editor dismissal with a confirmation stacked above it', async () => {
  const confirmDismiss = vi.fn();
  const editorDismiss = vi.fn(() => {
    releases.push(trackOverlay(confirmDismiss));
  });
  releases.push(trackOverlay(editorDismiss));
  pop();
  expect(editorDismiss).toHaveBeenCalledOnce();
  pop();
  expect(confirmDismiss).toHaveBeenCalledOnce();
  expect(history.pushState).toHaveBeenCalledTimes(4);
  await settle();
});
it('consumes non-Back closes without dismissing again, including rapid reopen', async () => {
  const first = vi.fn();
  const second = vi.fn();
  const release = trackOverlay(first);
  releases.push(release);
  release();
  releases.push(trackOverlay(second));
  await settle();
  expect(history.back).toHaveBeenCalledOnce();
  expect(first).not.toHaveBeenCalled();
  expect(second).not.toHaveBeenCalled();
  pop();
  expect(second).toHaveBeenCalledOnce();
});
it('drains closed parents after a stacked confirmation is closed', async () => {
  const parent = trackOverlay(vi.fn());
  const child = trackOverlay(vi.fn());
  releases.push(parent, child);
  parent();
  expect(history.back).not.toHaveBeenCalled();
  child();
  await settle();
  expect(history.back).toHaveBeenCalledTimes(2);
});

it('preserves replacement hash routing while a closing entry is consumed', async () => {
  const release = trackOverlay(vi.fn());
  releases.push(release);
  release();
  replaceRoute('#log/snapshots');
  await settle();
  expect(location.hash).toBe('#log/snapshots');
});

it('restores focus after native traversal has reset it, but respects newer focus', async () => {
  document.body.innerHTML = '<button id="trigger">Open</button><input id="next">';
  const trigger = document.querySelector<HTMLButtonElement>('#trigger')!;
  const next = document.querySelector<HTMLInputElement>('#next')!;
  const release = trackOverlay(vi.fn());
  releases.push(release);
  trigger.focus();
  release();
  await Promise.resolve();
  await Promise.resolve();
  trigger.blur();
  await settle();
  expect(document.activeElement).toBe(trigger);
  const second = trackOverlay(vi.fn());
  releases.push(second);
  second();
  await Promise.resolve();
  await Promise.resolve();
  next.focus();
  await settle();
  expect(document.activeElement).toBe(next);
  document.body.innerHTML = '';
});
it('does not finish a close until traversal and queued opens have settled', async () => {
  const release = trackOverlay(vi.fn());
  releases.push(release);
  release();
  const finished = vi.fn();
  void whenOverlayHistorySettled().then(finished);
  releases.push(trackOverlay(vi.fn()));
  await Promise.resolve();
  expect(finished).not.toHaveBeenCalled();
  await settle();
  expect(finished).toHaveBeenCalledOnce();
});
