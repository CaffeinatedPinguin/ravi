import { defineConfig } from '@playwright/test';

/**
 * Browser end-to-end tests: real `dist/ravi.mjs` + the installed Microsoft Edge, no browser download.
 * One worker keeps the shared fixture editable and the screenshots deterministic.
 */
export default defineConfig({
  testDir: 'e2e',
  outputDir: '.e2e-out/results',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    channel: 'msedge',
    headless: true,
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: 'edge' }],
});
