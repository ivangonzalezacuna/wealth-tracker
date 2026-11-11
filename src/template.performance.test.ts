// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appTemplate } from './template';

describe('profiling diagnostics template gate', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('does not render diagnostics or a menu link when profiling is disabled', () => {
    vi.stubEnv('VITE_ENABLE_PROFILING', 'false');
    const html = appTemplate();
    expect(html).not.toContain('id="diagnostics"');
    expect(html).not.toContain('btn-performance-diagnostics');
  });

  it('renders the diagnostics section and discreet menu link when enabled', () => {
    vi.stubEnv('VITE_ENABLE_PROFILING', 'true');
    const html = appTemplate();
    expect(html).toContain('id="diagnostics"');
    expect(html).toContain('btn-performance-diagnostics');
  });
});
