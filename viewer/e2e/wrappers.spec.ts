import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { demoUrl, fixture, waitForDocument } from './helpers';

// Files are served from the demo's own address, as they would be in a real app.
async function serveFixtures(page: Page) {
  for (const name of ['report.pdf', 'photo.png', 'form.pdf']) {
    await page.route(`**/files/${name}`, (route) => route.fulfill({ body: readFileSync(fixture(name)) }));
  }
  // A URL with no extension, so only the contents can identify it.
  await page.route('**/files/download?id=7', (route) => route.fulfill({ body: readFileSync(fixture('photo.png')) }));
  await page.route('**/files/missing.pdf', (route) => route.fulfill({ status: 404, body: 'not found' }));
}

const shownImage = (page: Page) => page.locator('.viewer-canvas img');
const setSource = (page: Page, source: string) => page.evaluate((value) => (window as never as { setDemoSource(s: string): void }).setDemoSource(value), source);

test.beforeEach(async ({ page }) => {
  await serveFixtures(page);
});

test('the source prop opens a PDF', async ({ page }) => {
  await page.goto(demoUrl({ source: '/files/report.pdf' }));
  await waitForDocument(page, 5);
});

test('the source prop opens an image', async ({ page }) => {
  await page.goto(demoUrl({ source: '/files/photo.png' }));
  await expect(shownImage(page)).toBeVisible();
});

test('a URL with no extension opens by its contents', async ({ page }) => {
  await page.goto(demoUrl({ source: '/files/download?id=7' }));
  await expect(shownImage(page)).toBeVisible();
});

test('changing the source prop switches viewers both ways', async ({ page }) => {
  await page.goto(demoUrl({ source: '/files/report.pdf' }));
  await waitForDocument(page, 5);

  await setSource(page, '/files/photo.png');
  await expect(shownImage(page)).toBeVisible();
  await expect(page.locator('.pv-page')).toHaveCount(0);

  await setSource(page, '/files/form.pdf');
  await waitForDocument(page, 1);
  await expect(shownImage(page)).toHaveCount(0);
});

test('a missing file reports an error', async ({ page }) => {
  await page.goto(demoUrl({ source: '/files/missing.pdf' }));
  await expect(page.getByRole('alert')).toContainText('404');
});

test('text files that look like images at first glance still open as text', async ({ page }) => {
  await page.goto(demoUrl({ editor: '0' }));
  await page.waitForFunction(() => Boolean((window as never as { pdfViewer?: unknown }).pdfViewer));
  await page.getByLabel('Choose a file to open').setInputFiles({ name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('BMW service report and GIF8 notes') });
  await waitForDocument(page, 1);
  expect(await page.evaluate(() => (window as never as { pdfViewer: { kind: string } }).pdfViewer.kind)).toBe('pdf');
});
