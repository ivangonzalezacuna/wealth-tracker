import {
  PROFILE_MAX_EXPORT_BYTES,
  type Distribution,
  type ProfileCategory,
  type ProfileGroup,
  type ProfileRecord,
  type ProfileRelease,
} from './types';

export type PeriodDays = 7 | 30 | 90 | 'all';

export interface ReportFilters {
  days: PeriodDays;
  category?: ProfileCategory | 'all';
  route?: string | 'all';
  release?: string | 'all';
  compareFrom?: string;
  compareTo?: string;
  from?: number;
  to?: number;
  runId?: string;
}

export interface ReleaseComparison {
  from: { appVersion: string; buildId: string };
  to: { appVersion: string; buildId: string };
  groups: Array<{
    category: ProfileCategory;
    name: string;
    route?: string;
    unit: string;
    fromSamples: number;
    toSamples: number;
    fromMedian: number | null;
    toMedian: number | null;
    medianChange: number | null;
  }>;
}

export interface PerformanceReport {
  schemaVersion: number;
  generatedAt: string;
  application: {
    name: 'Wealth Tracker';
    architecture: string;
    current: { appVersion: string; buildId: string };
    versions: Array<{ appVersion: string; buildId: string }>;
  };
  period: { from: string | null; to: string; filterDays: PeriodDays };
  summary: { measurementCount: number; runCount: number };
  groups: ProfileGroup[];
  releases: ProfileRelease[];
  runs: Array<{
    label: string;
    appVersion: string;
    buildId: string;
    startedAt: string;
    endedAt: string;
    eventCount: number;
    vitalSampleCount: number;
    errorCount: number;
    syncCount: number;
  }>;
  comparison: ReleaseComparison | null;
  selection: { from: string | null; to: string; singleRun: boolean };
  recommendations: Array<{ title: string; detail: string; sampleCount: number; threshold: string }>;
  limitations: string[];
}

function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function distribution(values: number[]): Distribution {
  return {
    sampleCount: values.length,
    median: percentile(values, 0.5),
    p75: percentile(values, 0.75),
    p95: percentile(values, 0.95),
    maximum: values.length ? Math.max(...values) : null,
  };
}

export function releaseKey(release: Pick<ProfileRelease, 'appVersion' | 'buildId'>): string {
  return JSON.stringify([release.appVersion, release.buildId]);
}

function metricValue(record: ProfileRecord): { value: number; unit: string } | null {
  if (typeof record.durationMs === 'number' && Number.isFinite(record.durationMs)) {
    return { value: record.durationMs, unit: 'ms' };
  }
  if (typeof record.value === 'number' && Number.isFinite(record.value)) {
    return { value: record.value, unit: record.unit ?? 'count' };
  }
  if (typeof record.usedHeapBytes === 'number' && Number.isFinite(record.usedHeapBytes)) {
    return { value: record.usedHeapBytes, unit: 'bytes' };
  }
  if (typeof record.bytes === 'number' && Number.isFinite(record.bytes)) {
    return { value: record.bytes, unit: 'bytes' };
  }
  return null;
}

function groupRecords(records: ProfileRecord[]): ProfileGroup[] {
  const groups = new Map<string, { records: ProfileRecord[]; values: number[]; unit: string }>();
  for (const record of records) {
    const metric = metricValue(record);
    const unit = metric?.unit ?? 'events';
    const key = JSON.stringify([
      record.appVersion,
      record.buildId,
      record.category,
      record.name,
      record.route ?? '',
      unit,
    ]);
    let group = groups.get(key);
    if (!group) {
      group = { records: [], values: [], unit };
      groups.set(key, group);
    }
    group.records.push(record);
    if (metric) group.values.push(metric.value);
  }

  return [...groups.entries()].map(([key, group]) => {
    const [appVersion, buildId, category, name, route] = JSON.parse(key) as [
      string,
      string,
      ProfileCategory,
      string,
      string,
    ];
    const successCount = group.records.filter((record) =>
      ['ok', 'success'].includes(record.outcome ?? ''),
    ).length;
    const failureCount = group.records.filter((record) =>
      ['error', 'failure'].includes(record.outcome ?? ''),
    ).length;
    const retries = group.records.reduce((sum, record) => sum + (record.retryCount ?? 0), 0);
    const payloads = group.records
      .map((record) => record.payloadBytes)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const ratingCounts: Record<string, number> = {};
    const attributionValues: Record<string, number[]> = {};
    const attributionCounts: Record<string, Record<string, number>> = {};
    for (const record of group.records) {
      if (record.rating) ratingCounts[record.rating] = (ratingCounts[record.rating] ?? 0) + 1;
      for (const [key, value] of Object.entries(record.attribution ?? {})) {
        if (record.name !== 'INP') continue;
        if (
          ['inputDelay', 'processingDuration', 'presentationDelay'].includes(key) &&
          typeof value === 'number' &&
          Number.isFinite(value) &&
          value >= 0
        ) {
          (attributionValues[key] ??= []).push(value);
        } else if (
          (key === 'interactionType' && ['pointer', 'keyboard'].includes(String(value))) ||
          (key === 'loadState' &&
            ['loading', 'dom-interactive', 'dom-content-loaded', 'complete'].includes(
              String(value),
            ))
        ) {
          const counts = (attributionCounts[key] ??= {});
          counts[String(value)] = (counts[String(value)] ?? 0) + 1;
        }
      }
    }
    return {
      appVersion,
      buildId,
      category,
      name,
      ...(route ? { route } : {}),
      unit: group.unit,
      eventCount: group.records.length,
      sampleCount: group.values.length,
      distribution: distribution(group.values),
      ...(successCount + failureCount ? { successCount, failureCount } : {}),
      ...(retries ? { retryCount: retries } : {}),
      ...(payloads.length
        ? { meanPayloadBytes: payloads.reduce((sum, value) => sum + value, 0) / payloads.length }
        : {}),
      ...(Object.keys(ratingCounts).length ? { ratingCounts } : {}),
      ...(Object.keys(attributionValues).length
        ? {
            attribution: Object.fromEntries(
              Object.entries(attributionValues).map(([key, values]) => [key, distribution(values)]),
            ),
          }
        : {}),
      ...(Object.keys(attributionCounts).length ? { attributionCounts } : {}),
    };
  });
}

function summarizeReleases(records: ProfileRecord[]): ProfileRelease[] {
  const summaries = new Map<string, ProfileRelease & { runIds: Set<string> }>();
  for (const record of records) {
    const key = releaseKey(record);
    let release = summaries.get(key);
    if (!release) {
      release = {
        appVersion: record.appVersion,
        buildId: record.buildId,
        sampleCount: 0,
        runCount: 0,
        firstSeen: record.timestamp,
        lastSeen: record.timestamp,
        runIds: new Set(),
      };
      summaries.set(key, release);
    }
    release.sampleCount++;
    release.runIds.add(record.runId);
    release.firstSeen = Math.min(release.firstSeen, record.timestamp);
    release.lastSeen = Math.max(release.lastSeen, record.timestamp);
  }
  return [...summaries.values()]
    .map(({ runIds, ...release }) => ({ ...release, runCount: runIds.size }))
    .sort((a, b) => a.firstSeen - b.firstSeen);
}

function summarizeRuns(records: ProfileRecord[]): PerformanceReport['runs'] {
  const byRun = new Map<
    string,
    {
      appVersion: string;
      buildId: string;
      records: ProfileRecord[];
      firstSeen: number;
      lastSeen: number;
    }
  >();
  for (const record of records) {
    const run = byRun.get(record.runId);
    if (run) {
      run.records.push(record);
      run.firstSeen = Math.min(run.firstSeen, record.timestamp);
      run.lastSeen = Math.max(run.lastSeen, record.timestamp);
    } else {
      byRun.set(record.runId, {
        appVersion: record.appVersion,
        buildId: record.buildId,
        records: [record],
        firstSeen: record.timestamp,
        lastSeen: record.timestamp,
      });
    }
  }
  return [...byRun.values()]
    .sort((a, b) => a.firstSeen - b.firstSeen)
    .map((run, index) => ({
      label: `Run ${index + 1}`,
      appVersion: run.appVersion,
      buildId: run.buildId,
      startedAt: new Date(run.firstSeen).toISOString(),
      endedAt: new Date(run.lastSeen).toISOString(),
      eventCount: run.records.length,
      vitalSampleCount: run.records.filter((record) => record.category === 'vital').length,
      errorCount: run.records.filter((record) => record.category === 'error').length,
      syncCount: run.records.filter((record) => record.category === 'sync').length,
    }));
}

function compareReleases(
  groups: ProfileGroup[],
  fromKey?: string,
  toKey?: string,
): ReleaseComparison | null {
  if (!fromKey || !toKey || fromKey === toKey) return null;
  const from = groups.filter((group) => releaseKey(group) === fromKey);
  const to = groups.filter((group) => releaseKey(group) === toKey);
  if (!from.length || !to.length) return null;
  const toByMetric = new Map(
    to.map((group) => [
      JSON.stringify([group.category, group.name, group.route ?? '', group.unit]),
      group,
    ]),
  );
  const fromRelease = from[0];
  const toRelease = to[0];
  const comparisons: ReleaseComparison['groups'] = [];
  for (const before of from) {
    const key = JSON.stringify([before.category, before.name, before.route ?? '', before.unit]);
    const after = toByMetric.get(key);
    if (!after) continue;
    const fromMedian = before.distribution.median;
    const toMedian = after.distribution.median;
    comparisons.push({
      category: before.category,
      name: before.name,
      ...(before.route ? { route: before.route } : {}),
      unit: before.unit,
      fromSamples: before.sampleCount,
      toSamples: after.sampleCount,
      fromMedian,
      toMedian,
      medianChange:
        fromMedian !== null && toMedian !== null && fromMedian !== 0
          ? ((toMedian - fromMedian) / Math.abs(fromMedian)) * 100
          : null,
    });
  }
  return {
    from: { appVersion: fromRelease.appVersion, buildId: fromRelease.buildId },
    to: { appVersion: toRelease.appVersion, buildId: toRelease.buildId },
    groups: comparisons,
  };
}

function recommendations(groups: ProfileGroup[]): PerformanceReport['recommendations'] {
  const findings: PerformanceReport['recommendations'] = [];
  for (const group of groups) {
    const p95 = group.distribution.p95;
    if (group.category === 'vital' && (group.ratingCounts?.poor ?? 0) > 0) {
      findings.push({
        title: `Poor ${group.name} samples`,
        detail: `${group.ratingCounts?.poor} sample(s) were rated poor by web-vitals.`,
        sampleCount: group.sampleCount,
        threshold: 'web-vitals rating',
      });
    } else if (group.category === 'database' && p95 !== null && p95 > 100) {
      findings.push({
        title: `Slow ${group.name}`,
        detail: `The p95 was ${p95.toFixed(1)} ms.`,
        sampleCount: group.sampleCount,
        threshold: 'Heuristic: p95 over 100 ms',
      });
    } else if (group.category === 'drive' && p95 !== null && p95 > 5000) {
      findings.push({
        title: `Slow ${group.name}`,
        detail: `The p95 was ${(p95 / 1000).toFixed(1)} seconds.`,
        sampleCount: group.sampleCount,
        threshold: 'Heuristic: p95 over 5,000 ms',
      });
    } else if (group.category === 'browser' && group.name === 'long-task' && p95 !== null) {
      findings.push({
        title: 'Long JavaScript tasks observed',
        detail: `The p95 task duration was ${p95.toFixed(1)} ms.`,
        sampleCount: group.sampleCount,
        threshold: 'Browser Long Tasks API entry threshold: 50 ms',
      });
    }
  }
  return findings.slice(0, 20);
}

export function filterProfileRecords(
  records: ProfileRecord[],
  filters: ReportFilters,
  now: number,
): ProfileRecord[] {
  const cutoff =
    filters.days === 'all' ? Number.NEGATIVE_INFINITY : now - filters.days * 24 * 60 * 60 * 1000;
  return records.filter(
    (record) =>
      record.timestamp >= Math.max(cutoff, filters.from ?? Number.NEGATIVE_INFINITY) &&
      record.timestamp <= Math.min(now, filters.to ?? now) &&
      (!filters.runId || record.runId === filters.runId) &&
      (!filters.category || filters.category === 'all' || record.category === filters.category) &&
      (!filters.route || filters.route === 'all' || record.route === filters.route) &&
      (!filters.release || filters.release === 'all' || releaseKey(record) === filters.release),
  );
}

export function buildReport(
  records: ProfileRecord[],
  filters: ReportFilters = { days: 'all' },
  now = Date.now(),
): PerformanceReport {
  const periodRecords = filterProfileRecords(
    records,
    { days: filters.days, from: filters.from, to: filters.to, runId: filters.runId },
    now,
  );
  const releases = summarizeReleases(periodRecords);
  const selected = filterProfileRecords(records, filters, now);
  const groups = groupRecords(selected);
  const seenVersions = new Map<string, { appVersion: string; buildId: string }>();
  for (const record of selected) {
    const key = releaseKey(record);
    seenVersions.set(key, { appVersion: record.appVersion, buildId: record.buildId });
  }
  const timestamps = selected.map((record) => record.timestamp);
  const runs = new Set(selected.map((record) => record.runId));
  const comparisonRecords = periodRecords.filter(
    (record) =>
      (!filters.category || filters.category === 'all' || record.category === filters.category) &&
      (!filters.route || filters.route === 'all' || record.route === filters.route),
  );
  const comparisonGroups = groupRecords(comparisonRecords);

  return {
    schemaVersion: 1,
    generatedAt: new Date(now).toISOString(),
    application: {
      name: 'Wealth Tracker',
      architecture:
        'Vanilla TypeScript PWA; sql.js/SQLite in IndexedDB; Google Drive AppData full-database sync.',
      current: {
        appVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'unknown',
        buildId: typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'unknown',
      },
      versions: [...seenVersions.values()].map(({ appVersion, buildId }) => ({
        appVersion,
        buildId,
      })),
    },
    period: {
      from: timestamps.length ? new Date(Math.min(...timestamps)).toISOString() : null,
      to: new Date(now).toISOString(),
      filterDays: filters.days,
    },
    summary: { measurementCount: selected.length, runCount: runs.size },
    groups,
    releases,
    runs: summarizeRuns(selected),
    comparison: compareReleases(comparisonGroups, filters.compareFrom, filters.compareTo),
    selection: {
      from: filters.from === undefined ? null : new Date(filters.from).toISOString(),
      to: new Date(Math.min(now, filters.to ?? now)).toISOString(),
      singleRun: !!filters.runId,
    },
    recommendations: recommendations(groups),
    limitations: [
      'Performance measurements are local browser observations and are not controlled benchmarks.',
      'Sparse samples make percentile estimates descriptive rather than statistically robust.',
      'Route timings are custom app metrics, not Core Web Vitals.',
      'Release comparisons are observational and do not establish causation.',
    ],
  };
}

export function serializeReport(report: PerformanceReport): string {
  const serialized = JSON.stringify(report, null, 2);
  const bytes = new TextEncoder().encode(serialized).byteLength;
  if (bytes > PROFILE_MAX_EXPORT_BYTES) {
    throw new RangeError(`Diagnostic report exceeds the 3 MiB export limit (${bytes} bytes).`);
  }
  return serialized;
}
