import { defineConfig } from '@playwright/test'

// Runs the real web app against the product API's look-around server (in-memory database, stand-ins for calls and payments).
// Locally it uses the installed Chrome; in CI set E2E_BROWSER=chromium after `npx playwright install chromium`.
const PORT = 5174
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  use: { baseURL: `http://localhost:${PORT}`, channel: process.env.E2E_BROWSER ? undefined : 'chrome' },
  webServer: [
    { command: 'python ../scripts/product_dev.py', url: 'http://127.0.0.1:8000/docs', reuseExistingServer: true, timeout: 90_000 },
    { command: `npm run dev -- --port ${PORT}`, url: `http://localhost:${PORT}`, reuseExistingServer: true, timeout: 60_000, env: { VITE_USE_MOCKS: 'false' } },
  ],
})
