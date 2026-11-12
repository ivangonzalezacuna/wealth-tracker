export function measureRender<T>(name: string, route: string, work: () => T): T {
  const profiler = globalThis.__wtProfiler;
  if (!profiler) return work();
  const startedAt = performance.now();
  let outcome: 'success' | 'error' = 'error';
  try {
    const result = work();
    outcome = 'success';
    return result;
  } finally {
    profiler.record('render', name, { route, durationMs: performance.now() - startedAt, outcome });
  }
}
