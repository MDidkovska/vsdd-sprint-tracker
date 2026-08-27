import { defineConfig, devices } from '@playwright/test';

// Playwright e2e configuration for the PoC (task 10.5).
//
// Browser support decision (requirements §Browser support, design §14):
//   - Chrome is THE supported browser for the PoC. `chromium` runs the full
//     e2e + visual-regression suite and owns the committed visual baselines.
//   - Safari is SMOKE-TESTED ONLY. `webkit` runs the functional smoke suite
//     (tracker.spec) but is excluded from visual regression — Safari has no
//     committed baselines and is not a visual gate for the PoC.
//   - Edge and Firefox certification is DEFERRED to Phase B, so they are not
//     configured here. Do not add them as PoC gates.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  projects: [
    // Supported browser: full functional + visual-regression coverage.
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Safari smoke test only: functional flows, no visual-regression gate.
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testIgnore: /visual\.spec\.ts/,
    },
  ],
  webServer: {
    // VITE_AUTH_MODE is a BUILD-TIME flag: it is read in src/main.tsx as
    // `import.meta.env.VITE_AUTH_MODE === 'mock'` and baked into the bundle by
    // `vite build`. `vite preview` only serves whatever is already in dist/, so
    // serving a stale bundle could run the app in REAL mode and require a
    // backend. To keep the e2e/visual suite deterministic and backend-free we
    // BUILD in mock mode first, then serve that fresh bundle. The env below is
    // applied to the spawned shell so it covers both the build and preview
    // steps, and reuseExistingServer is disabled so we never reuse a
    // possibly-stale (non-mock) server.
    command: 'npm run build && npm run preview -- --strictPort --port 4173',
    url: 'http://localhost:4173',
    env: { VITE_AUTH_MODE: 'mock' },
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
