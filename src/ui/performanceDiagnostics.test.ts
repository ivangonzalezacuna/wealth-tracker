// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { renderPerformanceDiagnostics } from './performanceDiagnostics';
import { readRecords } from '../performance/store';
import { serializeReport } from '../performance/report';
import type { ProfileRecord } from '../performance/types';

vi.mock('../performance/store', () => ({ readRecords: vi.fn() }));
vi.mock('../performance/report', async (original) => {
  const actual = await original<typeof import('../performance/report')>();
  return { ...actual, serializeReport: vi.fn(actual.serializeReport) };
});

beforeEach(() => {
  document.body.innerHTML = '<div id="performance-diagnostics-content"></div>';
  vi.mocked(serializeReport).mockClear();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  URL.createObjectURL = vi.fn(() => 'blob:test');
  URL.revokeObjectURL = vi.fn();
  const record = (id: string, timestamp: string, runId: string): ProfileRecord => ({
    id,
    timestamp: Date.parse(timestamp),
    runId,
    appVersion: '1.0.0',
    buildId: 'test',
    profilerSchemaVersion: 1,
    category: 'app',
    name: 'cache-boot',
    durationMs: 20,
  });
  vi.mocked(readRecords).mockResolvedValue([
    record('yesterday', '2026-11-11T12:00:00Z', 'run-old'),
    record('today', '2026-11-12T12:00:00Z', 'run-new'),
    record('other', '2026-11-12T13:00:00Z', 'run-other'),
  ]);
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-12T14:00:00Z'));
});

it('exports the same UTC-date and single-run selection shown in the UI', async () => {
  await renderPerformanceDiagnostics();
  const from = document.querySelector<HTMLInputElement>('[aria-label="From date (UTC)"]')!;
  from.value = '2026-11-12';
  from.dispatchEvent(new Event('change'));
  await vi.waitFor(() =>
    expect(document.querySelector('[aria-label="Run"]')?.textContent).not.toContain('2026-11-11'),
  );
  const run = document.querySelector<HTMLSelectElement>('[aria-label="Run"]')!;
  run.value = 'run-new';
  run.dispatchEvent(new Event('change'));
  await vi.waitFor(() =>
    expect(document.querySelector('.performance-overview')?.textContent).toContain('Measurements1'),
  );
  document.querySelector<HTMLButtonElement>('.performance-toolbar > button')!.click();
  const report = vi.mocked(serializeReport).mock.calls[0][0];
  expect(report.summary).toEqual({ measurementCount: 1, runCount: 1 });
  expect(report.selection).toMatchObject({ singleRun: true, from: '2026-11-12T00:00:00.000Z' });
  expect(report.groups[0].name).toBe('cache-boot');
});
