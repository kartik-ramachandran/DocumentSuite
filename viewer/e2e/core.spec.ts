import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { demoUrl, fixture, openDemo, openFile, pageHasInk, readPdf, waitForDocument } from './helpers';

test.beforeEach(async ({ page }) => {
  await openDemo(page, demoUrl({ editor: '0' }));
});

test('opens a PDF and draws real page content', async ({ page }) => {
  await openFile(page, 'report.pdf', 5);
  expect(await pageHasInk(page, 1)).toBe(true);
  await expect(page.getByLabel('Page number')).toHaveValue('1');
  await expect(page.locator('.pv-page-total')).toHaveText('of 5');
});

test('opens from base64, as a JSON API would send it', async ({ page }) => {
  const base64 = readFileSync(fixture('report.pdf')).toString('base64');
  await page.evaluate((data) => (window as never as { pdfViewer: { load(source: unknown): Promise<void> } }).pdfViewer.load({ base64: data, name: 'from-json.pdf' }), base64);
  await waitForDocument(page, 5);
  expect(await page.evaluate(() => (window as never as { pdfViewer: { fileName: string } }).pdfViewer.fileName)).toBe('from-json.pdf');
});

test('moves between pages with the buttons, the box and the keyboard', async ({ page }) => {
  await openFile(page, 'report.pdf', 5);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByLabel('Page number')).toHaveValue('2');

  await page.getByLabel('Page number').fill('4');
  await page.getByLabel('Page number').press('Enter');
  await expect(page.getByLabel('Page number')).toHaveValue('4');
  await expect.poll(() => pageHasInk(page, 4)).toBe(true);

  await page.locator('.pv-scroll').focus();
  await page.keyboard.press('Home');
  await expect(page.getByLabel('Page number')).toHaveValue('1');
  await page.keyboard.press('End');
  await expect(page.getByLabel('Page number')).toHaveValue('5');
});

test('zooms and re-renders sharply', async ({ page }) => {
  await openFile(page, 'report.pdf', 5);
  const before = (await page.locator('.pv-page[data-page="1"]').boundingBox())!.width;

  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(async () => (await page.locator('.pv-page[data-page="1"]').boundingBox())!.width).toBeGreaterThan(before);

  await page.getByLabel('Zoom level').selectOption('1');
  await expect.poll(async () => Math.round((await page.locator('.pv-page[data-page="1"]').boundingBox())!.width)).toBe(612);
  await expect.poll(() => page.locator('.pv-page[data-page="1"] canvas.pv-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.width)).toBeGreaterThanOrEqual(612);

  await page.getByLabel('Zoom level').selectOption('fit-page');
  await expect.poll(async () => (await page.locator('.pv-page[data-page="1"]').boundingBox())!.height).toBeLessThan(800);
});

test('rotates the view without changing the file', async ({ page }) => {
  await openFile(page, 'report.pdf', 5);
  await page.getByLabel('Zoom level').selectOption('1');
  await expect.poll(async () => Math.round((await page.locator('.pv-page[data-page="1"]').boundingBox())!.width)).toBe(612);

  await page.getByRole('button', { name: 'Rotate view' }).click();
  await expect.poll(async () => Math.round((await page.locator('.pv-page[data-page="1"]').boundingBox())!.width)).toBe(792);
  await expect.poll(() => pageHasInk(page, 1)).toBe(true);
});

test('finds text across pages and steps through matches', async ({ page }) => {
  await openFile(page, 'report.pdf', 5);
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByLabel('Find in document').fill('alpha3');
  await expect(page.locator('.pv-search-count')).toHaveText('1 of 1');
  await expect(page.locator('.pv-page[data-page="3"] .pv-match')).toHaveCount(1);
  await expect(page.getByLabel('Page number')).toHaveValue('3');

  await page.getByLabel('Find in document').fill('heading');
  await expect(page.locator('.pv-search-count')).toHaveText('1 of 5');
  await page.getByLabel('Find in document').press('Enter');
  await expect(page.locator('.pv-search-count')).toHaveText('2 of 5');
  await page.getByLabel('Find in document').press('Shift+Enter');
  await expect(page.locator('.pv-search-count')).toHaveText('1 of 5');

  await page.getByLabel('Find in document').fill('no such words');
  await expect(page.locator('.pv-search-count')).toHaveText('No matches');
  await expect(page.locator('.pv-match')).toHaveCount(0);
});

test('Ctrl+F opens search and Escape closes it', async ({ page }) => {
  await openFile(page, 'report.pdf', 5);
  await page.locator('.pv-scroll').focus();
  await page.keyboard.press('Control+f');
  await expect(page.getByLabel('Find in document')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Find in document')).toBeHidden();
});

test('has selectable text lined up over the page', async ({ page }) => {
  await openFile(page, 'report.pdf', 5);
  const span = page.locator('.pv-page[data-page="1"] .pv-text span', { hasText: 'Section 1 Heading' });
  await expect(span).toHaveCount(1);

  const page1 = (await page.locator('.pv-page[data-page="1"]').boundingBox())!;
  const scale = await page.evaluate(() => (window as never as { pdfViewer: { zoom: number } }).pdfViewer.zoom);
  const box = (await span.boundingBox())!;
  expect(Math.abs(box.x - (page1.x + 72 * scale))).toBeLessThan(3);
  expect(box.width / scale).toBeGreaterThan(150);
});

test('shows thumbnails that navigate', async ({ page }) => {
  await openFile(page, 'report.pdf', 5);
  await page.getByRole('button', { name: 'Toggle side panel' }).click();
  await expect(page.locator('.pv-thumb')).toHaveCount(5);
  await page.getByRole('button', { name: 'Go to page 3' }).click();
  await expect(page.getByLabel('Page number')).toHaveValue('3');
  await expect(page.getByRole('button', { name: 'Go to page 3' })).toHaveAttribute('aria-current', 'page');
});

test('frees far-away pages and redraws them on return', async ({ page }) => {
  await page.getByLabel('Choose a file to open').setInputFiles(fixture('report.pdf'));
  await waitForDocument(page, 5);
  await page.getByLabel('Zoom level').selectOption('2');
  await page.getByLabel('Page number').fill('5');
  await page.getByLabel('Page number').press('Enter');
  await expect.poll(() => pageHasInk(page, 5)).toBe(true);
  await page.locator('.pv-scroll').focus();
  await page.keyboard.press('Home');
  await expect.poll(() => pageHasInk(page, 1)).toBe(true);
});

test('downloads the original document unchanged', async ({ page }) => {
  await openFile(page, 'report.pdf', 5);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download' }).click()]);
  expect(download.suggestedFilename()).toBe('report.pdf');
  const saved = await readPdf(readFileSync(await download.path()));
  expect(saved.pageCount).toBe(5);
  expect(saved.bytes.equals(readFileSync(fixture('report.pdf')))).toBe(true);
});

test('prepares every page for printing', async ({ page }) => {
  await openFile(page, 'report.pdf', 5);
  await page.evaluate(() => {
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLIFrameElement) node.contentWindow!.print = () => {
            (window as never as { printedPages: number }).printedPages = node.contentDocument!.images.length;
          };
        }
      }
    }).observe(document.body, { childList: true });
  });
  await page.getByRole('button', { name: 'Print' }).click();
  await expect.poll(() => page.evaluate(() => (window as never as { printedPages?: number }).printedPages)).toBe(5);
});

test('reports a corrupt file without breaking', async ({ page }) => {
  await page.getByLabel('Choose a file to open').setInputFiles({ name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7 this is not really a PDF') });
  await expect(page.getByRole('alert')).toBeVisible();
  await openFile(page, 'report.pdf', 5);
  expect(await pageHasInk(page, 1)).toBe(true);
});

test('a password-protected PDF asks for its password', async ({ page, request }) => {
  const up = await request.get('http://localhost:8080/swagger/index.html').then((response) => response.ok()).catch(() => false);
  test.skip(!up, 'needs the PDF service to create the fixture');
  const protectedPdf = await request.post('http://localhost:8080/api/pdf/protect', {
    multipart: { file: { name: 'a.pdf', mimeType: 'application/pdf', buffer: readFileSync(fixture('form.pdf')) }, userPassword: 'open-sesame', ownerPassword: 'owner' },
  });
  await page.getByLabel('Choose a file to open').setInputFiles({ name: 'locked.pdf', mimeType: 'application/pdf', buffer: await protectedPdf.body() });
  await page.getByLabel('Password', { exact: true }).fill('wrong');
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.getByText('Incorrect password')).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill('open-sesame');
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await waitForDocument(page, 1);
});

test('without a service, non-PDF files explain what is needed', async ({ page }) => {
  await page.goto(demoUrl({ editor: '0', service: '' }));
  await page.waitForFunction(() => Boolean((window as never as { pdfViewer?: unknown }).pdfViewer));
  await page.getByLabel('Choose a file to open').setInputFiles(fixture('note.txt'));
  await expect(page.getByRole('alert')).toContainText('serviceUrl');
});

test('when the service can\'t be reached, non-PDF files say so', async ({ page }) => {
  await page.goto(demoUrl({ editor: '0', service: 'http://localhost:9' }));
  await page.waitForFunction(() => Boolean((window as never as { pdfViewer?: unknown }).pdfViewer));
  await page.getByLabel('Choose a file to open').setInputFiles(fixture('note.docx'));
  await expect(page.getByRole('alert')).toContainText("Couldn't reach the PDF service");
});

test('throws no uncaught errors during normal use', async ({ page }) => {
  await openFile(page, 'report.pdf', 5);
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Rotate view' }).click();
  await page.getByRole('button', { name: 'Toggle side panel' }).click();
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByLabel('Find in document').fill('alpha');
  await expect(page.locator('.pv-search-count')).toContainText('of 5');
  expect((page as typeof page & { pageErrors?: string[] }).pageErrors).toEqual([]);
});

test('destroying the viewer cleans up', async ({ page }) => {
  await openFile(page, 'report.pdf', 5);
  await page.evaluate(() => (window as never as { pdfViewer: { destroy(): void } }).pdfViewer.destroy());
  await expect(page.locator('.pv-root')).toHaveCount(0);
});
