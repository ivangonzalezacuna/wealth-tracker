import {
  buildReport,
  releaseKey,
  serializeReport,
  type PeriodDays,
  type ReportFilters,
} from '../performance/report';
import { readRecords } from '../performance/store';
import type {
  ProfileCategory,
  ProfileGroup,
  ProfileRecord,
  ProfileRelease,
} from '../performance/types';

let _days: PeriodDays = 90;
let _category: ProfileCategory | 'all' = 'all';
let _route = 'all';
let _release = 'all';
let _compareFrom = '';
let _compareTo = '';

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function selectControl<T extends string>(
  labelText: string,
  options: Array<{ value: T; label: string }>,
  value: T,
  onChange: (value: T) => void,
): HTMLLabelElement {
  const label = element('label', undefined, 'performance-filter');
  label.append(element('span', labelText));
  const select = element('select', undefined, 'form-select form-select-sm');
  select.setAttribute('aria-label', labelText);
  for (const option of options) {
    const item = element('option', option.label);
    item.value = option.value;
    select.append(item);
  }
  select.value = value;
  select.addEventListener('change', () => onChange(select.value as T));
  label.append(select);
  return label;
}

function formatNumber(value: number | null, unit: string): string {
  if (value === null) return 'n/a';
  if (unit === 'score') return value.toFixed(3);
  if (unit === 'bytes') {
    if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MiB`;
    if (value >= 1024) return `${(value / 1024).toFixed(1)} KiB`;
    return `${Math.round(value)} B`;
  }
  if (unit === 'ms') return `${value.toFixed(1)} ms`;
  return value.toFixed(2);
}

function releaseLabel(release: ProfileRelease): string {
  return `${release.appVersion} · ${release.buildId}`;
}

function appendGroupTable(host: HTMLElement, title: string, groups: ProfileGroup[]): void {
  const section = element('section', undefined, 'performance-section');
  section.append(element('h3', title));
  if (groups.length === 0) {
    section.append(element('p', 'No measurements in this period.', 'note'));
    host.append(section);
    return;
  }
  const scroll = element('div', undefined, 'performance-table-scroll');
  const table = element('table', undefined, 'performance-table');
  const head = element('thead');
  const header = element('tr');
  for (const value of [
    'Metric / operation',
    'Route',
    'Samples',
    'Median',
    'p75',
    'p95',
    'Max',
    'Success / failure',
    'Retries',
    'Avg payload',
  ]) {
    header.append(element('th', value));
  }
  head.append(header);
  table.append(head);
  const body = element('tbody');
  for (const group of groups) {
    const row = element('tr');
    const nameCell = element('td', group.name);
    nameCell.title = `${group.appVersion} · ${group.buildId}`;
    row.append(nameCell, element('td', group.route ?? '—'));
    row.append(
      element('td', String(group.category === 'error' ? group.eventCount : group.sampleCount)),
    );
    row.append(element('td', formatNumber(group.distribution.median, group.unit)));
    const p75 = element(
      'td',
      `${formatNumber(group.distribution.p75, group.unit)}${group.sampleCount < 20 ? ' (descriptive)' : ''}`,
    );
    if (group.sampleCount < 20)
      p75.title = 'Fewer than 20 samples; interpret this p75 as directional.';
    row.append(
      p75,
      element('td', formatNumber(group.distribution.p95, group.unit)),
      element('td', formatNumber(group.distribution.maximum, group.unit)),
      element(
        'td',
        group.successCount !== undefined
          ? `${group.successCount} / ${group.failureCount ?? 0}`
          : '—',
      ),
      element('td', group.retryCount === undefined ? '—' : String(group.retryCount)),
      element(
        'td',
        group.meanPayloadBytes === undefined ? '—' : formatNumber(group.meanPayloadBytes, 'bytes'),
      ),
    );
    body.append(row);
  }
  table.append(body);
  scroll.append(table);
  section.append(scroll);
  host.append(section);
}

function appendRunTable(host: HTMLElement, records: ProfileRecord[]): void {
  const runs = new Map<string, { first: number; last: number; records: ProfileRecord[] }>();
  for (const record of records) {
    const run = runs.get(record.runId);
    if (run) {
      run.first = Math.min(run.first, record.timestamp);
      run.last = Math.max(run.last, record.timestamp);
      run.records.push(record);
    } else {
      runs.set(record.runId, {
        first: record.timestamp,
        last: record.timestamp,
        records: [record],
      });
    }
  }
  const section = element('section', undefined, 'performance-section');
  section.append(element('h3', 'Application runs'));
  const table = element('table', undefined, 'performance-table');
  const header = element('tr');
  for (const value of [
    'Run',
    'Version / build',
    'Started',
    'Duration',
    'Events',
    'Vitals',
    'Errors',
  ]) {
    header.append(element('th', value));
  }
  const head = element('thead');
  head.append(header);
  table.append(head);
  const body = element('tbody');
  [...runs.values()]
    .sort((a, b) => a.first - b.first)
    .forEach((run, index) => {
      const sample = run.records[0];
      const row = element('tr');
      row.append(
        element('td', `Run ${index + 1}`),
        element('td', `${sample.appVersion} · ${sample.buildId}`),
        element('td', new Date(run.first).toLocaleString()),
        element('td', formatNumber(run.last - run.first, 'ms')),
        element('td', String(run.records.length)),
        element('td', String(run.records.filter((record) => record.category === 'vital').length)),
        element('td', String(run.records.filter((record) => record.category === 'error').length)),
      );
      body.append(row);
    });
  table.append(body);
  const scroll = element('div', undefined, 'performance-table-scroll');
  scroll.append(table);
  section.append(scroll);
  host.append(section);
}

function appendReleases(
  host: HTMLElement,
  releases: ProfileRelease[],
  records: ProfileRecord[],
): void {
  const section = element('section', undefined, 'performance-section');
  section.append(element('h3', 'Release history'));
  if (releases.length === 0) {
    section.append(element('p', 'No releases recorded in this period.', 'note'));
    host.append(section);
    return;
  }
  const table = element('table', undefined, 'performance-table');
  const header = element('tr');
  for (const value of ['Version', 'Build', 'Runs', 'Events', 'First seen', 'Last seen']) {
    header.append(element('th', value));
  }
  const head = element('thead');
  head.append(header);
  table.append(head);
  const body = element('tbody');
  for (const release of releases) {
    const matching = records.filter(
      (record) => record.appVersion === release.appVersion && record.buildId === release.buildId,
    );
    const row = element('tr');
    row.append(
      element('td', release.appVersion),
      element('td', release.buildId),
      element('td', String(new Set(matching.map((record) => record.runId)).size)),
      element('td', String(matching.length)),
      element('td', new Date(release.firstSeen).toLocaleString()),
      element('td', new Date(release.lastSeen).toLocaleString()),
    );
    body.append(row);
  }
  table.append(body);
  const scroll = element('div', undefined, 'performance-table-scroll');
  scroll.append(table);
  section.append(scroll);
  host.append(section);
}

function appendComparison(host: HTMLElement, report: ReturnType<typeof buildReport>): void {
  const section = element('section', undefined, 'performance-section');
  section.append(element('h3', 'Release comparison'));
  const comparison = report.comparison;
  if (!comparison) {
    section.append(
      element(
        'p',
        'Choose two different releases above to compare matching metric groups.',
        'note',
      ),
    );
    host.append(section);
    return;
  }
  section.append(
    element(
      'p',
      `${comparison.from.appVersion} · ${comparison.from.buildId} → ${comparison.to.appVersion} · ${comparison.to.buildId}`,
      'note',
    ),
    element(
      'p',
      'Median changes are observational, not proof that a release caused the difference. Compare sample counts and time periods.',
      'note',
    ),
  );
  const table = element('table', undefined, 'performance-table');
  const header = element('tr');
  for (const value of [
    'Metric',
    'Route',
    'Before',
    'After',
    'Median change',
    'Samples before / after',
  ]) {
    header.append(element('th', value));
  }
  const head = element('thead');
  head.append(header);
  table.append(head);
  const body = element('tbody');
  for (const group of comparison.groups) {
    const change =
      group.medianChange === null
        ? 'n/a'
        : `${group.medianChange > 0 ? '+' : ''}${group.medianChange.toFixed(1)}%`;
    const row = element('tr');
    row.append(
      element('td', `${group.name} (${group.unit})`),
      element('td', group.route ?? '—'),
      element('td', formatNumber(group.fromMedian, group.unit)),
      element('td', formatNumber(group.toMedian, group.unit)),
      element('td', change),
      element('td', `${group.fromSamples} / ${group.toSamples}`),
    );
    body.append(row);
  }
  table.append(body);
  const scroll = element('div', undefined, 'performance-table-scroll');
  scroll.append(table);
  section.append(scroll);
  host.append(section);
}

function makeFilters(
  records: ProfileRecord[],
  releases: ProfileRelease[],
  rerender: () => void,
): HTMLElement {
  const filters = element('div', undefined, 'performance-filters');
  const periodOptions = [
    { value: '7', label: 'Last 7 days' },
    { value: '30', label: 'Last 30 days' },
    { value: '90', label: 'Last 90 days' },
    { value: 'all', label: 'All collected' },
  ];
  filters.append(
    selectControl('Period', periodOptions, String(_days), (value) => {
      if (value === 'all') _days = 'all';
      else if (value === '7') _days = 7;
      else if (value === '30') _days = 30;
      else _days = 90;
      rerender();
    }),
  );
  const categoryOptions: Array<{ value: ProfileCategory | 'all'; label: string }> = [
    { value: 'all', label: 'All categories' },
    { value: 'vital', label: 'Web vitals' },
    { value: 'route', label: 'Page routes' },
    { value: 'render', label: 'Rendering' },
    { value: 'database', label: 'IndexedDB / database' },
    { value: 'drive', label: 'Google Drive' },
    { value: 'sync', label: 'Synchronization' },
    { value: 'browser', label: 'Browser performance' },
    { value: 'error', label: 'Errors' },
  ];
  filters.append(
    selectControl('Category', categoryOptions, _category, (value) => {
      _category = value;
      rerender();
    }),
  );
  const routes = [
    ...new Set(records.map((record) => record.route).filter((value): value is string => !!value)),
  ].sort();
  filters.append(
    selectControl(
      'Page',
      [{ value: 'all', label: 'All pages' }, ...routes.map((value) => ({ value, label: value }))],
      _route,
      (value) => {
        _route = value;
        rerender();
      },
    ),
  );
  const releaseOptions = [
    { value: 'all', label: 'All releases' },
    ...releases.map((release) => ({ value: releaseKey(release), label: releaseLabel(release) })),
  ];
  filters.append(
    selectControl('Release', releaseOptions, _release, (value) => {
      _release = value;
      rerender();
    }),
  );
  const compareOptions = [
    { value: '', label: 'Choose release' },
    ...releases.map((release) => ({ value: releaseKey(release), label: releaseLabel(release) })),
  ];
  filters.append(
    selectControl('Compare from', compareOptions, _compareFrom, (value) => {
      _compareFrom = value;
      rerender();
    }),
    selectControl('Compare to', compareOptions, _compareTo, (value) => {
      _compareTo = value;
      rerender();
    }),
  );
  return filters;
}

export async function renderPerformanceDiagnostics(): Promise<void> {
  const host = document.getElementById('performance-diagnostics-content');
  if (!host) return;
  host.replaceChildren(element('p', 'Loading local measurements…', 'note'));
  try {
    const records = await readRecords();
    const now = Date.now();
    const baseFilters: ReportFilters = { days: _days };
    const baseReport = buildReport(records, baseFilters, now);
    const releases = baseReport.releases;
    if (!_compareFrom && releases.length > 1) _compareFrom = releaseKey(releases[0]);
    if (!_compareTo && releases.length > 1) _compareTo = releaseKey(releases[releases.length - 1]);
    const filters: ReportFilters = {
      days: _days,
      category: _category,
      route: _route,
      release: _release,
      compareFrom: _compareFrom,
      compareTo: _compareTo,
    };
    const report = buildReport(records, filters, now);
    const cutoff = _days === 'all' ? Number.NEGATIVE_INFINITY : now - _days * 24 * 60 * 60 * 1000;
    const filteredRecords = records.filter(
      (record) =>
        record.timestamp >= cutoff &&
        record.timestamp <= now &&
        (!filters.category || filters.category === 'all' || record.category === filters.category) &&
        (!filters.route || filters.route === 'all' || record.route === filters.route) &&
        (!filters.release || filters.release === 'all' || releaseKey(record) === filters.release),
    );
    const periodRecords = records.filter(
      (record) => record.timestamp >= cutoff && record.timestamp <= now,
    );
    const status = globalThis.__wtProfiler?.getStatus();
    const content = element('div', undefined, 'performance-diagnostics');
    const toolbar = element('div', undefined, 'performance-toolbar');
    toolbar.append(makeFilters(records, releases, () => void renderPerformanceDiagnostics()));
    const exportButton = element(
      'button',
      'Export diagnostic report (JSON)',
      'btn btn-outline btn-sm',
    );
    exportButton.type = 'button';
    const message = element('p', '', 'performance-message');
    message.setAttribute('role', 'status');
    exportButton.addEventListener('click', () => {
      try {
        const json = serializeReport(report);
        const file = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(file);
        const link = element('a');
        link.href = url;
        link.download = `wealth-tracker-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
        message.textContent = `Exported ${new TextEncoder().encode(json).byteLength} bytes.`;
      } catch (error) {
        message.textContent =
          error instanceof Error ? error.message : 'Could not create the diagnostic report.';
        console.error('[profiler] Export failed:', error);
      }
    });
    toolbar.append(exportButton, message);
    content.append(toolbar);
    if (status?.storageError) {
      content.append(
        element('p', `Profiler storage warning: ${status.storageError}`, 'performance-warning'),
      );
    }
    const overview = element('div', undefined, 'performance-overview');
    const period = report.period.from
      ? `${new Date(report.period.from).toLocaleDateString()} to ${new Date(report.period.to).toLocaleDateString()}`
      : 'No measurements yet';
    for (const [label, value] of [
      ['Measurements', String(report.summary.measurementCount)],
      ['Runs', String(report.summary.runCount)],
      ['Versions / builds', String(report.application.versions.length)],
      [
        'Current build',
        `${report.application.current.appVersion} · ${report.application.current.buildId}`,
      ],
      [
        'Errors',
        String(
          report.groups
            .filter((group) => group.category === 'error')
            .reduce((count, group) => count + group.eventCount, 0),
        ),
      ],
      ['Collection period', period],
    ]) {
      const card = element('div', undefined, 'performance-stat card');
      card.append(element('span', label), element('strong', value));
      overview.append(card);
    }
    content.append(overview);
    const visibleGroups = report.groups;
    appendGroupTable(
      content,
      'Core Web Vitals (LCP, INP, CLS)',
      visibleGroups.filter(
        (group) => group.category === 'vital' && ['LCP', 'INP', 'CLS'].includes(group.name),
      ),
    );
    appendGroupTable(
      content,
      'Supplementary web-vitals (FCP, TTFB)',
      visibleGroups.filter(
        (group) => group.category === 'vital' && ['FCP', 'TTFB'].includes(group.name),
      ),
    );
    appendGroupTable(
      content,
      'Page performance',
      visibleGroups.filter((group) => group.category === 'route'),
    );
    appendGroupTable(
      content,
      'Rendering',
      visibleGroups.filter((group) => group.category === 'render'),
    );
    appendGroupTable(
      content,
      'IndexedDB and database',
      visibleGroups.filter((group) => group.category === 'database'),
    );
    appendGroupTable(
      content,
      'Google Drive and synchronization',
      visibleGroups.filter((group) => group.category === 'drive' || group.category === 'sync'),
    );
    appendGroupTable(
      content,
      'JavaScript and browser performance',
      visibleGroups.filter((group) => group.category === 'browser'),
    );
    appendGroupTable(
      content,
      'Errors',
      visibleGroups.filter((group) => group.category === 'error'),
    );
    const findings = element('section', undefined, 'performance-section');
    findings.append(element('h3', 'Heuristic findings'));
    if (report.recommendations.length === 0) {
      findings.append(element('p', 'No heuristic findings for this selection.', 'note'));
    } else {
      const list = element('ul', undefined, 'performance-findings');
      for (const recommendation of report.recommendations) {
        const item = element('li');
        item.append(
          element('strong', recommendation.title),
          element(
            'span',
            `${recommendation.detail} ${recommendation.threshold}; n=${recommendation.sampleCount}.`,
          ),
        );
        list.append(item);
      }
      findings.append(list);
    }
    content.append(findings);
    appendComparison(content, report);
    appendReleases(content, report.releases, periodRecords);
    appendRunTable(content, filteredRecords);
    content.append(
      element(
        'p',
        'p75 values with fewer than 20 samples are descriptive. Release differences are observational and may reflect different usage or devices.',
        'note',
      ),
    );
    host.replaceChildren(content);
  } catch (error) {
    console.error('[profiler] Could not read local diagnostics:', error);
    host.replaceChildren(
      element(
        'p',
        `Local profiler data could not be read: ${error instanceof Error ? error.message : 'storage error'}`,
        'performance-warning',
      ),
    );
  }
}
