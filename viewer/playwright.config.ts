import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 60_000,
  fullyParallel: true,
  workers: 6,
  reporter: [['list']],
  use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, acceptDownloads: true },
  projects: [
    { name: 'react', use: { baseURL: 'http://localhost:5173' } },
    { name: 'vue', use: { baseURL: 'http://localhost:5174' } },
    { name: 'angular', use: { baseURL: 'http://localhost:5175' } },
  ],
  webServer: [
    { command: 'npm run preview -w example-react', url: 'http://localhost:5173', reuseExistingServer: true },
    { command: 'npm run preview -w example-vue', url: 'http://localhost:5174', reuseExistingServer: true },
    { command: 'npm run preview -w example-angular', url: 'http://localhost:5175', reuseExistingServer: true },
  ],
});
