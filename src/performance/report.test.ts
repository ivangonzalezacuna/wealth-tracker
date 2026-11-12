import { describe, expect, it } from 'vitest';
import { buildReport, distribution, releaseKey, serializeReport } from './report';
import { type ProfileRecord } from './types';

function makeRecord(
  id: string,
  timestamp: number,
  options: {
    appVersion?: string;
    buildId?: string;
    runId?: string;
    category?: ProfileRecord['category'];
    name?: string;
    durationMs?: number;
    value?: number;
    unit?: string;
    route?: string;
    rating?: string;
  } = {},
): ProfileRecord {
  return {
    id,
    timestamp,
    appVersion: options.appVersion ?? '1.0.0',
    buildId: options.buildId ?? 'a1b2c3',
    runId: options.runId ?? 'local-run-id',
    profilerSchemaVersion: 1,
    category: options.category ?? 'route',
    name: options.name ?? 'section-transition',
    ...(options.durationMs === undefined ? {} : { durationMs: options.durationMs }),
    ...(options.value === undefined ? {} : { value: options.value }),
    ...(options.unit === undefined ? {} : { unit: options.unit }),
    ...(options.route === undefined ? {} : { route: options.route }),
    ...(options.rating === undefined ? {} : { rating: options.rating }),
  };
}

describe('performance report aggregation', () => {
  it('isolates an inclusive date interval and run without exporting the run identifier', () => {
    const records = [
      makeRecord('before', 999, { runId: 'private-a', durationMs: 1000 }),
      makeRecord('first', 1000, { runId: 'private-a', durationMs: 10 }),
      makeRecord('other', 1500, { runId: 'private-b', durationMs: 900 }),
      makeRecord('last', 2000, { runId: 'private-a', durationMs: 20 }),
      makeRecord('after', 2001, { runId: 'private-a', durationMs: 1000 }),
    ];
    const report = buildReport(
      records,
      { days: 'all', from: 1000, to: 2000, runId: 'private-a' },
      3000,
    );
    expect(report.summary).toEqual({ measurementCount: 2, runCount: 1 });
    expect(report.groups[0].distribution.median).toBe(15);
    expect(report.selection.singleRun).toBe(true);
    expect(serializeReport(report)).not.toContain('private-a');
  });

  it('exports only allowlisted INP attribution distributions and categories', () => {
    const a = makeRecord('a', 1000, { category: 'vital', name: 'INP', value: 100 });
    const b = makeRecord('b', 1100, { category: 'vital', name: 'INP', value: 200 });
    a.attribution = {
      inputDelay: 10,
      processingDuration: 20,
      presentationDelay: 70,
      interactionType: 'pointer',
      target: 'secret-selector',
    };
    b.attribution = {
      inputDelay: 30,
      processingDuration: 40,
      presentationDelay: 130,
      interactionType: 'keyboard',
      loadState: 'complete',
    };
    const report = buildReport([a, b], { days: 'all' }, 2000);
    expect(report.groups[0].attribution?.inputDelay).toMatchObject({ sampleCount: 2, median: 20 });
    expect(report.groups[0].attribution?.processingDuration.median).toBe(30);
    expect(report.groups[0].attributionCounts).toEqual({
      interactionType: { pointer: 1, keyboard: 1 },
      loadState: { complete: 1 },
    });
    expect(serializeReport(report)).not.toContain('secret-selector');
    expect(serializeReport(report)).not.toContain('"target"');
  });
  it('calculates interpolated median, p75, p95, and maximum', () => {
    expect(distribution([10, 20, 30, 40])).toEqual({
      sampleCount: 4,
      median: 25,
      p75: 32.5,
      p95: 38.5,
      maximum: 40,
    });
  });

  it('groups events by release and run, and compares matching metrics', () => {
    const now = 2_000;
    const records = [
      makeRecord('a1', 1_000, {
        appVersion: '1.0.0',
        buildId: 'old',
        runId: 'run-a',
        durationMs: 100,
      }),
      makeRecord('a2', 1_100, {
        appVersion: '1.0.0',
        buildId: 'old',
        runId: 'run-a',
        durationMs: 120,
      }),
      makeRecord('b1', 1_500, {
        appVersion: '1.1.0',
        buildId: 'new',
        runId: 'run-b',
        durationMs: 80,
      }),
    ];
    const oldKey = releaseKey({ appVersion: '1.0.0', buildId: 'old' });
    const newKey = releaseKey({ appVersion: '1.1.0', buildId: 'new' });
    const report = buildReport(
      records,
      { days: 'all', compareFrom: oldKey, compareTo: newKey },
      now,
    );

    expect(report.releases).toHaveLength(2);
    expect(report.runs).toHaveLength(2);
    expect(report.runs[0].label).toBe('Run 1');
    expect(report.runs[0]).not.toHaveProperty('runId');
    expect(report.comparison?.groups[0]).toMatchObject({
      fromSamples: 2,
      toSamples: 1,
      fromMedian: 110,
      toMedian: 80,
    });
    expect(report.comparison?.groups[0].medianChange).toBeCloseTo(-27.27, 1);
  });

  it('applies time filters and labels poor web-vitals as official ratings', () => {
    const now = 90 * 24 * 60 * 60 * 1000;
    const records = [
      makeRecord('recent', now - 1_000, {
        category: 'vital',
        name: 'LCP',
        value: 3_000,
        unit: 'ms',
        rating: 'poor',
      }),
      makeRecord('old', now - 8 * 24 * 60 * 60 * 1000, {
        category: 'vital',
        name: 'LCP',
        value: 2_000,
        unit: 'ms',
      }),
    ];
    const report = buildReport(records, { days: 7 }, now);
    expect(report.summary.measurementCount).toBe(1);
    expect(report.recommendations[0]).toMatchObject({
      title: 'Poor LCP samples',
      threshold: 'web-vitals rating',
      sampleCount: 1,
    });
  });

  it('keeps build lists and release comparisons consistent with report filters', () => {
    const oldKey = releaseKey({ appVersion: '1.0.0', buildId: 'old' });
    const newKey = releaseKey({ appVersion: '1.1.0', buildId: 'new' });
    const records = [
      makeRecord('old-route', 1_000, {
        appVersion: '1.0.0',
        buildId: 'old',
        category: 'route',
        durationMs: 100,
      }),
      makeRecord('new-route', 1_500, {
        appVersion: '1.1.0',
        buildId: 'new',
        category: 'route',
        durationMs: 80,
      }),
      makeRecord('other-category', 1_600, {
        appVersion: '1.1.0',
        buildId: 'new',
        category: 'database',
        durationMs: 10,
      }),
    ];

    const report = buildReport(
      records,
      {
        days: 'all',
        category: 'route',
        release: oldKey,
        compareFrom: oldKey,
        compareTo: newKey,
      },
      2_000,
    );

    expect(report.application.versions).toEqual([{ appVersion: '1.0.0', buildId: 'old' }]);
    expect(report.groups.every((group) => group.category === 'route')).toBe(true);
    expect(report.comparison?.groups).toHaveLength(1);
    expect(report.comparison?.groups[0]).toMatchObject({
      category: 'route',
      fromMedian: 100,
      toMedian: 80,
    });
  });

  it('does not export raw run identifiers and enforces the JSON size ceiling', () => {
    const report = buildReport(
      [makeRecord('event', 1_000, { runId: 'private-run-value', durationMs: 12 })],
      { days: 'all' },
      2_000,
    );
    expect(serializeReport(report)).not.toContain('private-run-value');
    report.limitations.push('x'.repeat(3 * 1024 * 1024));
    expect(() => serializeReport(report)).toThrow('3 MiB export limit');
  });
});
