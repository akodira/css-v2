import { defineConfig, devices } from '@playwright/test';
import { baseUrl } from './support/env';

/**
 * Browser tests for CCS v2. They run against the LOCAL copy of the system
 * (Angular on http://localhost:4200, API on https://localhost:7180, local database copy).
 * support/env.ts refuses any other address unless you opt in on purpose.
 */
export default defineConfig({
  testDir: './specs',
  globalSetup: './support/global-setup.ts',
  fullyParallel: false,          // one browser at a time: tests share one local database
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: [['list'], ['json', { outputFile: 'results/report.json' }], ['html', { open: 'never' }]],
  use: {
    baseURL: baseUrl(),
    ignoreHTTPSErrors: true,     // the local API uses a development certificate
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1280, height: 800 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } }],
});
