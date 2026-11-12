import { execFileSync } from 'node:child_process';

export function resolveBuildId(env, cwd = process.cwd()) {
  const configured = env.VITE_BUILD_ID || env.COMMIT_REF || env.GITHUB_SHA;
  if (configured) return configured;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    console.warn(
      '[build] Commit identity unavailable; set VITE_BUILD_ID for release comparisons.',
      error.message,
    );
    return 'local-unversioned';
  }
}
