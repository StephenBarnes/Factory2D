import { defineConfig } from "@playwright/test";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: "./tools/benchmark",
  testMatch: "*.bench.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 180_000,
  reporter: "list",
  outputDir: "test-results/benchmark",
  use: {
    baseURL: "http://127.0.0.1:4174",
    browserName: "chromium",
    headless: process.env.BENCH_HEADED !== "1",
    launchOptions: executablePath === undefined ? {} : { executablePath },
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1.25,
  },
  webServer: {
    command: "npm run build && npm exec vite build -- --config tools/benchmark/vite.config.ts && npm exec vite preview -- --host 127.0.0.1 --port 4174 --strictPort",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
