import {
  onCLS,
  onFCP,
  onINP,
  onLCP,
  onTTFB,
  type MetricWithAttribution,
} from 'web-vitals/attribution';
import { pruneRecords, recordSessionStart, writeRecords } from './store';
import type { ProfileCategory, ProfileRecord, ProfileRecordInput, ProfileScalar } from './types';
import { PROFILE_SCHEMA_VERSION } from './types';

const FLUSH_INTERVAL_MS = 2_000;
const FLUSH_BATCH_SIZE = 25;
const MAX_QUEUED_RECORDS = 500;
const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'unknown';
const BUILD_ID = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : APP_VERSION;
const KNOWN_ROUTES = new Set([
  'networth',
  'portfolio',
  'portfolio/holdings',
  'portfolio/contributions',
  'portfolio/dividends',
  'analytics',
  'settings',
  'settings/portfolio',
  'settings/planning',
  'settings/advanced',
  'log',
  'log/transactions',
  'log/snapshots',
  'diagnostics',
]);
const ALLOWED_INPUT_KEYS = new Set([
  'route',
  'durationMs',
  'value',
  'unit',
  'rating',
  'outcome',
  'retryCount',
  'payloadBytes',
  'recordCount',
  'count',
  'bytes',
  'usedHeapBytes',
  'navigationType',
  'cacheState',
  'initiatorType',
  'interactionType',
  'loadState',
  'attribution',
]);
const ALLOWED_ENUM_VALUES = new Set([
  'good',
  'needs-improvement',
  'poor',
  'ok',
  'success',
  'error',
  'failure',
  'cached',
  'local',
  'uncached',
  'navigate',
  'reload',
  'back-forward',
  'back-forward-cache',
  'prerender',
  'restore',
  'soft-navigation',
  'pointer',
  'keyboard',
  'loading',
  'dom-interactive',
  'dom-content-loaded',
  'complete',
  'script',
  'css',
  'img',
  'link',
  'fetch',
  'xmlhttprequest',
  'other',
  'ms',
  'score',
  'bytes',
  'events',
  'count',
  'online',
  'offline',
  'unknown',
]);
const ALLOWED_ATTRIBUTION_KEYS = new Set([
  'timeToFirstByte',
  'resourceLoadDelay',
  'resourceLoadDuration',
  'elementRenderDelay',
  'inputDelay',
  'processingDuration',
  'presentationDelay',
  'largestShiftValue',
  'largestShiftTime',
  'firstByte',
  'loadTime',
  'loadDelay',
  'duration',
  'interactionType',
  'loadState',
]);

let _initialized = false;
let _nextId = 0;
let _flushTimer: number | undefined;
let _flushInProgress: Promise<void> | null = null;
let _storageError: string | null = null;
let _warnedStorage = false;
let _warnedObserver = false;
const _pending: ProfileRecord[] = [];
const _runId =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

function currentRoute(value?: string): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const url = new URL(value ?? window.location.href, window.location.origin);
    if (url.origin !== window.location.origin) return undefined;
    const route = url.hash.replace(/^#/, '').split('?')[0] || 'networth';
    return KNOWN_ROUTES.has(route) ? route : undefined;
  } catch {
    return undefined;
  }
}

export function sanitizeProfileInput(input: ProfileRecordInput): ProfileRecordInput {
  const clean: ProfileRecordInput = {};
  for (const [key, value] of Object.entries(input)) {
    if (!ALLOWED_INPUT_KEYS.has(key)) continue;
    if (key === 'route' && typeof value === 'string') {
      if (KNOWN_ROUTES.has(value)) clean.route = value;
      continue;
    }
    if (key === 'attribution' && value && typeof value === 'object') {
      const attribution: Record<string, ProfileScalar> = {};
      for (const [attributionKey, attributionValue] of Object.entries(value)) {
        if (
          ALLOWED_ATTRIBUTION_KEYS.has(attributionKey) &&
          (typeof attributionValue === 'number' ||
            (typeof attributionValue === 'string' && ALLOWED_ENUM_VALUES.has(attributionValue)))
        ) {
          attribution[attributionKey] = attributionValue;
        }
      }
      if (Object.keys(attribution).length) clean.attribution = attribution;
      continue;
    }
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      Object.assign(clean, { [key]: value });
    } else if (typeof value === 'string' && ALLOWED_ENUM_VALUES.has(value)) {
      Object.assign(clean, { [key]: value });
    }
  }
  if (!clean.route) clean.route = currentRoute();
  return clean;
}

function scheduleFlush(): void {
  if (_flushTimer !== undefined) return;
  _flushTimer = window.setTimeout(() => {
    _flushTimer = undefined;
    void flush();
  }, FLUSH_INTERVAL_MS);
}

function record(category: ProfileCategory, name: string, input: ProfileRecordInput = {}): void {
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(name)) return;
  const route = currentRoute();
  if (
    route === 'diagnostics' &&
    (category === 'vital' || category === 'route' || category === 'render')
  ) {
    return;
  }
  const record: ProfileRecord = {
    id: `${Date.now().toString(36)}-${(_nextId++).toString(36)}`,
    timestamp: Date.now(),
    appVersion: APP_VERSION,
    buildId: BUILD_ID,
    runId: _runId,
    profilerSchemaVersion: PROFILE_SCHEMA_VERSION,
    category,
    name,
    ...sanitizeProfileInput(input),
  };
  _pending.push(record);
  if (_pending.length > MAX_QUEUED_RECORDS)
    _pending.splice(0, _pending.length - MAX_QUEUED_RECORDS);
  if (_pending.length >= FLUSH_BATCH_SIZE) void flush();
  else scheduleFlush();
}

function recordFirstRender(
  startedAt: number,
  input: ProfileRecordInput,
  completedAt = performance.now(),
): void {
  let wasHidden = document.visibilityState === 'hidden';
  const visibilityChanged = () => {
    if (document.visibilityState === 'hidden') wasHidden = true;
  };
  const context = sanitizeProfileInput(input);
  record('app', 'first-render-complete', {
    ...context,
    durationMs: completedAt - startedAt,
  });
  document.addEventListener('visibilitychange', visibilityChanged);
  requestAnimationFrame(() => {
    document.removeEventListener('visibilitychange', visibilityChanged);
    const hidden = wasHidden || document.visibilityState === 'hidden';
    record('app', hidden ? 'first-frame-delay-hidden' : 'first-frame-delay-visible', {
      ...context,
      durationMs: performance.now() - completedAt,
    });
  });
}

async function flush(): Promise<void> {
  if (_flushInProgress) return _flushInProgress;
  if (_flushTimer !== undefined) {
    window.clearTimeout(_flushTimer);
    _flushTimer = undefined;
  }
  if (_pending.length === 0) return;
  const batch = _pending.splice(0, FLUSH_BATCH_SIZE);
  _flushInProgress = writeRecords(batch).then(
    () => {
      _storageError = null;
    },
    (error: unknown) => {
      _storageError = error instanceof Error ? error.message : 'Profiler storage is unavailable.';
      if (!_warnedStorage) {
        _warnedStorage = true;
        console.warn('[profiler] Could not persist local performance data.', error);
      }
    },
  );
  try {
    await _flushInProgress;
  } finally {
    _flushInProgress = null;
    if (_pending.length) scheduleFlush();
  }
}

function safeAttribution(metric: MetricWithAttribution): Record<string, ProfileScalar> {
  const values: Record<string, ProfileScalar> = {};
  const attribution = metric.attribution;
  const allowedNumbers = new Set([
    'timeToFirstByte',
    'resourceLoadDelay',
    'resourceLoadDuration',
    'elementRenderDelay',
    'inputDelay',
    'processingDuration',
    'presentationDelay',
    'largestShiftValue',
    'largestShiftTime',
    'firstByte',
    'loadTime',
    'loadDelay',
    'duration',
  ]);
  for (const [key, value] of Object.entries(attribution)) {
    if (
      allowedNumbers.has(key) &&
      typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= 0
    ) {
      values[key] = value;
    } else if (
      ['interactionType', 'loadState'].includes(key) &&
      typeof value === 'string' &&
      ALLOWED_ENUM_VALUES.has(value)
    ) {
      values[key] = value;
    }
  }
  return values;
}

function recordVital(metric: MetricWithAttribution): void {
  record('vital', metric.name, {
    value: metric.value,
    unit: metric.name === 'CLS' ? 'score' : 'ms',
    rating: metric.rating,
    navigationType: metric.navigationType,
    route: currentRoute(metric.navigationURL),
    attribution: safeAttribution(metric),
  });
}

function observeEntryType(type: string, name: string): void {
  if (typeof PerformanceObserver === 'undefined') return;
  if (!PerformanceObserver.supportedEntryTypes?.includes(type)) return;
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration >= 50) record('browser', name, { durationMs: entry.duration });
      }
    });
    observer.observe({ type, buffered: true });
  } catch (error) {
    if (!_warnedObserver) {
      _warnedObserver = true;
      console.warn(`[profiler] Optional ${type} observer is unavailable.`, error);
    }
  }
}

function captureResources(): void {
  if (typeof performance.getEntriesByType !== 'function') return;
  const byType = new Map<string, { count: number; durationMs: number; bytes: number }>();
  for (const entry of performance.getEntriesByType('resource')) {
    const resource = entry as PerformanceResourceTiming;
    try {
      if (new URL(resource.name, window.location.href).origin !== window.location.origin) continue;
    } catch {
      continue;
    }
    const type = ALLOWED_ENUM_VALUES.has(resource.initiatorType) ? resource.initiatorType : 'other';
    const summary = byType.get(type) ?? { count: 0, durationMs: 0, bytes: 0 };
    summary.count++;
    summary.durationMs += resource.duration;
    summary.bytes += resource.transferSize || 0;
    byType.set(type, summary);
  }
  for (const [initiatorType, summary] of byType) {
    record('browser', `resource-${initiatorType}`, {
      initiatorType,
      count: summary.count,
      durationMs: summary.durationMs,
      bytes: summary.bytes,
    });
  }
}

function captureMemory(): void {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory;
  if (typeof memory?.usedJSHeapSize === 'number') {
    record('browser', 'memory-snapshot', { usedHeapBytes: memory.usedJSHeapSize });
  }
}

function initializeObservers(): void {
  const attributionOptions = { reportSoftNavs: true, generateTarget: () => '' };
  onCLS(recordVital, attributionOptions);
  onFCP(recordVital, attributionOptions);
  onINP(recordVital, attributionOptions);
  onLCP(recordVital, attributionOptions);
  onTTFB(recordVital, attributionOptions);
  observeEntryType('longtask', 'long-task');
  observeEntryType('long-animation-frame', 'long-animation-frame');
  if (document.readyState === 'complete') {
    window.setTimeout(captureResources, 0);
  } else {
    window.addEventListener('load', () => window.setTimeout(captureResources, 0), { once: true });
  }
  captureMemory();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      captureMemory();
      void flush();
    }
  });
  window.addEventListener('pagehide', () => void flush());
  window.addEventListener('error', (event) => {
    const resizeLoop =
      event.message === 'ResizeObserver loop completed with undelivered notifications.' ||
      event.message === 'ResizeObserver loop limit exceeded';
    record(
      resizeLoop ? 'browser' : 'error',
      resizeLoop ? 'resize-observer-loop' : 'javascript-error',
      {
        outcome: 'error',
      },
    );
  });
  window.addEventListener('unhandledrejection', () => {
    record('error', 'unhandled-rejection', { outcome: 'error' });
  });
}

function reportStorageFailure(error: unknown): void {
  _storageError = error instanceof Error ? error.message : 'Profiler storage is unavailable.';
  if (!_warnedStorage) {
    _warnedStorage = true;
    console.warn('[profiler] Local performance storage is unavailable.', error);
  }
}

export function initProfiler(): void {
  if (_initialized) return;
  _initialized = true;
  globalThis.__wtProfiler = {
    record,
    recordFirstRender,
    flush,
    getStatus: () => ({
      enabled: true,
      queuedRecords: _pending.length,
      storageError: _storageError,
      runId: _runId,
    }),
  };
  initializeObservers();
  record('app', 'profiler-start');
  void pruneRecords().catch((error: unknown) => {
    reportStorageFailure(error);
  });
  void recordSessionStart().then(
    (previousStart) => {
      if (previousStart !== null && previousStart <= Date.now()) {
        record('app', 'session-gap', { durationMs: Date.now() - previousStart });
      }
    },
    (error: unknown) => {
      reportStorageFailure(error);
    },
  );
}
