import { defineConfig } from '@playwright/test';

const sizes = [
  { name: 'phone-320', width: 320, height: 568 },
  { name: 'phone-390', width: 390, height: 844 },
  { name: 'landscape', width: 844, height: 390 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'laptop', width: 1280, height: 900 },
  { name: 'desktop', width: 1920, height: 1080 },
];

export default defineConfig({
  testDir: './tests/ui-review',
  outputDir: './test-results/ui-review',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: 3,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'test-results/ui-review-report', open: 'never' }],
    ['json', { outputFile: 'test-results/ui-review-results.json' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    reducedMotion: 'reduce',
  },
  projects: [
    ...['light', 'dark'].flatMap((theme) =>
      sizes.map(({ name, width, height }) => ({
        name: `${name}-${theme}`,
        metadata: { theme },
        use: {
          browserName: 'chromium' as const,
          viewport: { width, height },
          colorScheme: theme as 'light' | 'dark',
          hasTouch: width < 1000,
        },
      })),
    ),
    ...(['firefox', 'webkit'] as const).flatMap((browserName) =>
      [
        { name: 'phone', width: 390, height: 844, theme: 'light' as const },
        { name: 'laptop', width: 1280, height: 900, theme: 'dark' as const },
      ].map(({ name, width, height, theme }) => ({
        name: `${browserName}-${name}-${theme}`,
        metadata: { theme },
        use: {
          browserName,
          viewport: { width, height },
          colorScheme: theme,
        },
      })),
    ),
  ],
  webServer: {
    command: 'corepack yarn dev --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
