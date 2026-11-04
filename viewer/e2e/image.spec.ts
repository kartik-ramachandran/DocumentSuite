import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { demoUrl, exportedPdf, fixture, openDemo, openFile, pageHasInk, waitForDocument } from './helpers';

type Viewer = {
  kind: string;
  pageCount: number;
  zoom: number;
  fileName: string;
  getBase64(): Promise<string>;
  load(source: unknown, name?: string): Promise<void>;
  zoomIn(): void;
  setZoom(value: unknown): void;
  rotateView(): void;
};
const viewer = <T>(page: Page, run: (instance: Viewer) => T | Promise<T>) =>
  page.evaluate(`(${run.toString()})(window.pdfViewer)`) as Promise<T>;

const shownImage = (page: Page) => page.locator('.viewer-canvas img');

async function openImage(page: Page, name: string): Promise<void> {
  await page.getByLabel('Choose a file to open').setInputFiles(fixture(name));
  await expect(shownImage(page)).toBeVisible();
  await expect.poll(() => shownImage(page).evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
}

test.beforeEach(async ({ page }) => {
  await openDemo(page, demoUrl());
});

for (const name of ['photo.png', 'photo.jpg', 'photo.gif', 'photo.webp', 'photo.bmp', 'drawing.svg']) {
  test(`opens ${name} in the image viewer`, async ({ page }) => {
    await openImage(page, name);
    expect(await viewer(page, (instance) => instance.kind)).toBe('image');
    await expect(page.locator('.pv-page')).toHaveCount(0);
  });
}

test('images never go to the server, even in server mode', async ({ page }) => {
  const calls: string[] = [];
  await page.goto(demoUrl({ mode: 'server' }));
  await page.waitForFunction(() => Boolean((window as never as { pdfViewer?: unknown }).pdfViewer));
  page.on('request', (request) => {
    if (request.url().includes(':8080')) calls.push(request.url());
  });
  await openImage(page, 'photo.png');
  expect(calls).toEqual([]);
});

test('images need no server configured', async ({ page }) => {
  await page.goto(demoUrl({ service: '' }));
  await page.waitForFunction(() => Boolean((window as never as { pdfViewer?: unknown }).pdfViewer));
  await openImage(page, 'photo.png');
});

test('the file contents decide, not the name', async ({ page }) => {
  await page.getByLabel('Choose a file to open').setInputFiles({ name: 'actually-an-image.pdf', mimeType: 'application/pdf', buffer: readFileSync(fixture('photo.png')) });
  await expect(shownImage(page)).toBeVisible();
  expect(await viewer(page, (instance) => instance.kind)).toBe('image');

  await page.getByLabel('Choose a file to open').setInputFiles({ name: 'actually-a-pdf.png', mimeType: 'image/png', buffer: readFileSync(fixture('report.pdf')) });
  await waitForDocument(page, 5);
  expect(await viewer(page, (instance) => instance.kind)).toBe('pdf');
});

test('switches back and forth between PDFs and images', async ({ page }) => {
  await openFile(page, 'report.pdf', 5);
  await expect(page.getByLabel('Page number')).toBeVisible();

  await openImage(page, 'photo.png');
  await expect(page.locator('.pv-page')).toHaveCount(0);
  await expect(page.getByLabel('Page number')).toBeHidden();

  await openFile(page, 'report.pdf', 5);
  await expect(page.getByLabel('Page number')).toBeVisible();
  await expect(shownImage(page)).toHaveCount(0);
  expect(await pageHasInk(page, 1)).toBe(true);

  await openImage(page, 'photo.jpg');
  await openImage(page, 'photo.png');
  await expect(page.locator('.pv-image')).toHaveCount(1);
});

test('hides tools that only apply to PDFs', async ({ page }) => {
  await openFile(page, 'report.pdf', 5);
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('button', { name: 'Toggle side panel' }).click();
  await expect(page.getByLabel('Find in document')).toBeVisible();
  await openImage(page, 'photo.png');

  for (const name of ['Next page', 'Previous page', 'Search']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeHidden();
  }
  await expect(page.getByLabel('Page number')).toBeHidden();
  await expect(page.getByLabel('Find in document')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Go to page 1' })).toHaveCount(0);
  for (const name of ['Open file', 'Print', 'Download', 'Zoom in', 'Zoom out', 'Rotate view', 'Draw', 'Highlight text', 'Toggle side panel']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  }
});

test('zooms, rotates and flips from the main toolbar', async ({ page }) => {
  await openImage(page, 'photo.png');
  const width = () => shownImage(page).evaluate((image) => image.getBoundingClientRect().width);
  const start = await width();

  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(width).toBeGreaterThan(start);

  await page.getByRole('button', { name: 'Actual size' }).click();
  await expect.poll(async () => Math.round(await width())).toBe(320);

  await page.getByRole('button', { name: 'Rotate view' }).click();
  await expect.poll(() => shownImage(page).evaluate((image) => image.style.transform)).toContain('rotate(90deg)');

  await page.getByRole('button', { name: 'Flip horizontally' }).click();
  await expect.poll(() => shownImage(page).evaluate((image) => image.style.transform)).toContain('scaleX(-1)');
});

test('the toolbar works from the keyboard', async ({ page }) => {
  await openImage(page, 'photo.png');
  const width = () => shownImage(page).evaluate((image) => image.getBoundingClientRect().width);
  const start = await width();
  await page.getByRole('button', { name: 'Zoom in' }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(width).toBeGreaterThan(start);
});

test('a dragged image moves', async ({ page }) => {
  await openImage(page, 'photo.png');
  await page.getByRole('button', { name: 'Zoom in' }).click();
  const box = (await shownImage(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await shownImage(page).boundingBox())!.x - box.x)).toBe(60);
});

test('the viewer API controls images too', async ({ page }) => {
  await openImage(page, 'photo.png');
  expect(await viewer(page, (instance) => instance.pageCount)).toBe(1);

  await viewer(page, (instance) => instance.setZoom(2));
  await expect.poll(() => viewer(page, (instance) => instance.zoom)).toBeCloseTo(2, 1);
  const before = await viewer(page, (instance) => instance.zoom);
  await viewer(page, (instance) => instance.zoomIn());
  await expect.poll(() => viewer(page, (instance) => instance.zoom)).toBeGreaterThan(before);

  await viewer(page, (instance) => instance.rotateView());
  await expect.poll(() => shownImage(page).evaluate((image) => image.style.transform)).toContain('rotate(90deg)');
});

test('adjusts when the window size changes', async ({ page }) => {
  await openImage(page, 'photo.png');
  await page.setViewportSize({ width: 500, height: 500 });
  await expect.poll(async () => {
    const box = (await page.locator('.pv-image .viewer-container').boundingBox())!;
    return box.width;
  }).toBeLessThanOrEqual(500);
  await page.getByLabel('Zoom level').selectOption('fit-page');
  await expect.poll(async () => (await shownImage(page).boundingBox())!.width).toBeLessThanOrEqual(500);
});

test('downloads the original image unchanged', async ({ page }) => {
  await openImage(page, 'photo.png');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download' }).click()]);
  expect(download.suggestedFilename()).toBe('photo.png');
  expect(readFileSync(await download.path()).equals(readFileSync(fixture('photo.png')))).toBe(true);
});

test('a wrongly named image downloads with the right extension', async ({ page }) => {
  await page.getByLabel('Choose a file to open').setInputFiles({ name: 'mislabelled.pdf', mimeType: 'application/pdf', buffer: readFileSync(fixture('photo.png')) });
  await expect(shownImage(page)).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download' }).click()]);
  expect(download.suggestedFilename()).toBe('mislabelled.png');
});

test('opens from base64 and from data URLs, as JSON APIs send them', async ({ page }) => {
  const base64 = readFileSync(fixture('photo.png')).toString('base64');
  await page.evaluate((data) => (window as never as { pdfViewer: Viewer }).pdfViewer.load({ base64: data, name: 'from-json.png' }), base64);
  await expect(shownImage(page)).toBeVisible();
  expect(await viewer(page, (instance) => instance.fileName)).toBe('from-json.png');
  expect(await viewer(page, (instance) => instance.getBase64())).toBe(base64);

  await page.evaluate((data) => (window as never as { pdfViewer: Viewer }).pdfViewer.load(data), `data:image/png;base64,${base64}`);
  await expect(shownImage(page)).toBeVisible();
});

test('prepares an image for printing', async ({ page }) => {
  await openImage(page, 'photo.png');
  await page.evaluate(() => {
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLIFrameElement) node.contentWindow!.print = () => {
            (window as never as { printedImages: number }).printedImages = node.contentDocument!.images.length;
          };
        }
      }
    }).observe(document.body, { childList: true });
  });
  await page.getByRole('button', { name: 'Print' }).click();
  await expect.poll(() => page.evaluate(() => (window as never as { printedImages?: number }).printedImages)).toBe(1);
});

test('a damaged image reports an error and keeps the current document', async ({ page }) => {
  await openFile(page, 'report.pdf', 5);
  const png = readFileSync(fixture('photo.png'));
  await page.getByLabel('Choose a file to open').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.concat([png.subarray(0, 12), Buffer.from('garbage')]) });
  await expect(page.getByRole('alert')).toContainText('damaged');
  await expect(page.locator('.pv-page')).toHaveCount(5);
  expect(await viewer(page, (instance) => instance.kind)).toBe('pdf');
});

test('explains image formats that browsers cannot show', async ({ page }) => {
  await page.getByLabel('Choose a file to open').setInputFiles({ name: 'scan.tiff', mimeType: 'image/tiff', buffer: Buffer.from([0x49, 0x49, 0x2a, 0x00, 1, 2, 3, 4]) });
  await expect(page.getByRole('alert')).toContainText('TIFF');
});

test('annotations from a PDF do not leak into images, or back', async ({ page }) => {
  await openFile(page, 'report.pdf', 5);
  await openImage(page, 'photo.png');
  await openFile(page, 'report.pdf', 5);
  expect((await exportedPdf(page)).pageCount).toBe(5);
});

test('destroying the viewer removes the image viewer', async ({ page }) => {
  await openImage(page, 'photo.png');
  await page.evaluate(() => (window as never as { pdfViewer: { destroy(): void } }).pdfViewer.destroy());
  await expect(page.locator('.pv-image')).toHaveCount(0);
});

test('throws no uncaught errors during normal use', async ({ page }) => {
  await openImage(page, 'photo.png');
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Rotate left' }).click();
  await openFile(page, 'report.pdf', 5);
  await openImage(page, 'photo.jpg');
  expect((page as typeof page & { pageErrors?: string[] }).pageErrors).toEqual([]);
});
