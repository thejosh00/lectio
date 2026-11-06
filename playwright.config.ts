import {defineConfig, devices} from '@playwright/test';

export default defineConfig({
  testDir: 'tests/browser',
  // real.pw.ts reads a copy of your own lessons: `bun run test:real`, never in a shared run.
  testMatch: process.env['LECTIO_REAL_DATA'] ? 'real.pw.ts' : ['pages.pw.ts', 'flows.pw.ts', 'looks.pw.ts'],
  outputDir: '.playwright/results',
  snapshotPathTemplate: 'tests/browser/looks/{projectName}/{arg}{ext}',
  fullyParallel: true,
  forbidOnly: true,
  reporter: [['list'], ['html', {outputFolder: '.playwright/report', open: 'never'}]],
  timeout: 60_000,
  expect: {timeout: 10_000},
  use: {trace: 'retain-on-failure', screenshot: 'only-on-failure'},
  projects: [
    {name: 'iphone-webkit', use: {...devices['iPhone 14']}},
    {name: 'small-phone-webkit', use: {...devices['iPhone SE']}},
    {name: 'phone-chromium', use: {...devices['Pixel 7']}},
    // Just under and over the stylesheet's main breakpoint.
    {name: 'narrow-tablet-chromium', use: {...devices['Desktop Chrome'], viewport: {width: 759, height: 900}}},
    {name: 'wide-tablet-webkit', use: {...devices['Desktop Safari'], viewport: {width: 760, height: 900}}},
    {name: 'desktop-webkit', use: {...devices['Desktop Safari'], viewport: {width: 1280, height: 900}}},
    {name: 'desktop-chromium', use: {...devices['Desktop Chrome'], viewport: {width: 1280, height: 900}}},
  ],
});
