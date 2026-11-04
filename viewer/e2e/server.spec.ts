import { expect, test, type Page } from '@playwright/test';
import { demoUrl, exportedPdf, fixture, isServiceUp, openDemo, openFile, pageHasInk, waitForDocument } from './helpers';

test.beforeAll(async () => {
  test.skip(!(await isServiceUp()), 'needs the PDF service at localhost:8080');
});

for (const transport of ['multipart', 'json']) {
  test.describe(`server mode over ${transport}`, () => {
    test.beforeEach(async ({ page }) => {
      await openDemo(page, demoUrl({ editor: '0', mode: 'server', transport }));
    });

    test('renders pages on the server', async ({ page }) => {
      const pageRequests: string[] = [];
      page.on('request', (request) => {
        if (/\/viewer\/documents\/[0-9a-f]+\/pages\/\d+\?dpi=/.test(request.url())) pageRequests.push(request.url());
      });
      await openFile(page, 'report.pdf', 5);
      expect(await pageHasInk(page, 1)).toBe(true);
      expect(pageRequests.length).toBeGreaterThan(0);
    });

    test('searches and selects text from the server', async ({ page }) => {
      await openFile(page, 'report.pdf', 5);
      await page.getByRole('button', { name: 'Search' }).click();
      await page.getByLabel('Find in document').fill('alpha4');
      await expect(page.locator('.pv-search-count')).toHaveText('1 of 1');
      await expect(page.getByLabel('Page number')).toHaveValue('4');
      await expect(page.locator('.pv-page[data-page="1"] .pv-text span', { hasText: 'Heading' })).toHaveCount(1);
    });

    test('opens Word files', async ({ page }) => {
      await openFile(page, 'note.docx', 1);
      await page.getByRole('button', { name: 'Search' }).click();
      await page.getByLabel('Find in document').fill('Word content');
      await expect(page.locator('.pv-search-count')).toHaveText('1 of 1');
      expect(await page.evaluate(() => (window as never as { pdfViewer: { pageCount: number } }).pdfViewer.pageCount)).toBe(1);
    });

    test('rotates, zooms and downloads', async ({ page }) => {
      await openFile(page, 'report.pdf', 5);
      await page.getByLabel('Zoom level').selectOption('1');
      await page.getByRole('button', { name: 'Rotate view' }).click();
      await expect.poll(async () => Math.round((await page.locator('.pv-page[data-page="1"]').boundingBox())!.width)).toBe(792);
      await expect.poll(() => pageHasInk(page, 1)).toBe(true);
      expect((await exportedPdf(page)).pageCount).toBe(5);
    });
  });
}

test('browser mode converts Word and text files through the service', async ({ page }) => {
  await openDemo(page, demoUrl({ editor: '0' }));
  await openFile(page, 'note.docx', 1);
  expect(await (await exportedPdf(page)).text(1)).toContain('Word content opened in the viewer');
  await openFile(page, 'note.txt', 1);
  await expect.poll(async () => (await exportedPdf(page)).text(1)).toContain('Plain text content');
});

test('browser mode converts over the JSON transport too', async ({ page }) => {
  await openDemo(page, demoUrl({ editor: '0', transport: 'json' }));
  await openFile(page, 'note.docx', 1);
  expect(await (await exportedPdf(page)).text(1)).toContain('Word content opened in the viewer');
});

test('a service failure is reported, not hidden', async ({ page }) => {
  await openDemo(page, demoUrl({ editor: '0', mode: 'server', service: 'http://localhost:9' }));
  await page.getByLabel('Choose a file to open').setInputFiles(fixture('report.pdf'));
  await expect(page.getByRole('alert')).toBeVisible();
});

test.describe('document tools', () => {
  const openTool = async (page: Page, name: string) => {
    await page.locator('details[data-tool]', { has: page.locator(`summary:text-is("${name}")`) }).locator('summary').click();
    return page.locator('details[open]', { has: page.locator(`summary:text-is("${name}")`) });
  };

  test.beforeEach(async ({ page }) => {
    await openDemo(page, demoUrl());
    await openFile(page, 'report.pdf', 5);
    await page.getByRole('button', { name: 'Toggle side panel' }).click();
    await page.getByRole('button', { name: 'Document tools' }).click();
  });

  test('organize reorders and removes pages', async ({ page }) => {
    const tool = await openTool(page, 'Organize pages');
    await page.getByRole('button', { name: 'Remove page 2' }).click();
    await page.getByRole('button', { name: 'Move page 5 up' }).click();
    await tool.getByRole('button', { name: 'Apply new order' }).click();
    await expect(page.locator('.pv-page')).toHaveCount(4);
    const saved = await exportedPdf(page);
    expect(await saved.text(1)).toContain('Section 1');
    expect(await saved.text(2)).toContain('Section 3');
    expect(await saved.text(3)).toContain('Section 5');
    expect(await saved.text(4)).toContain('Section 4');
  });

  test('redact permanently removes text, and undo restores it', async ({ page }) => {
    const tool = await openTool(page, 'Redact');
    await tool.getByLabel('Words or phrases, one per line').fill('alpha1');
    await tool.getByRole('button', { name: 'Redact permanently' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Redact: done' })).toBeVisible();
    await waitForDocument(page, 5);
    expect(await (await exportedPdf(page)).text(1)).not.toContain('alpha1');

    await page.getByRole('button', { name: 'Undo last tool' }).click();
    await expect.poll(async () => (await exportedPdf(page)).text(1)).toContain('alpha1');
  });

  test('redact reports when nothing matched', async ({ page }) => {
    const tool = await openTool(page, 'Redact');
    await tool.getByLabel('Words or phrases, one per line').fill('nothing like this');
    await tool.getByRole('button', { name: 'Redact permanently' }).click();
    await expect(page.getByRole('alert')).toContainText('nothing was redacted');
  });

  test('annotations are included when a tool runs', async ({ page }) => {
    await page.getByRole('button', { name: 'Add text' }).click();
    const box = (await page.locator('.pv-page[data-page="1"]').boundingBox())!;
    await page.mouse.click(box.x + 100, box.y + 400);
    const editor = page.getByLabel('Annotation text');
    await editor.fill('KeepMe');
    await editor.press('Control+Enter');

    const tool = await openTool(page, 'Watermark');
    await tool.getByRole('button', { name: 'Add watermark' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Watermark: done' })).toBeVisible();
    await waitForDocument(page, 5);
    const text = await (await exportedPdf(page)).text(1);
    expect(text).toContain('KeepMe');
    expect(text).toContain('DRAFT');
  });

  test('compress and page numbers update the open document', async ({ page }) => {
    const compress = await openTool(page, 'Compress');
    await compress.getByRole('button', { name: 'Compress', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Compress: done' })).toBeVisible();

    const numbers = await openTool(page, 'Page numbers');
    await numbers.getByRole('button', { name: 'Add numbers' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Page numbers: done' })).toBeVisible();
    await waitForDocument(page, 5);
    expect(await (await exportedPdf(page)).text(1)).toContain('1 / 5');
  });

  test('convert downloads an editable Word file', async ({ page }) => {
    const tool = await openTool(page, 'Convert and download');
    const [download] = await Promise.all([page.waitForEvent('download'), tool.getByRole('button', { name: 'Convert', exact: true }).click()]);
    expect(download.suggestedFilename()).toBe('report.docx');
  });
});

test('document tools explain themselves without a service', async ({ page }) => {
  await page.goto(demoUrl({ service: '' }));
  await page.waitForFunction(() => Boolean((window as never as { pdfViewer?: unknown }).pdfViewer));
  await openFile(page, 'report.pdf', 5);
  await page.getByRole('button', { name: 'Toggle side panel' }).click();
  await page.getByRole('button', { name: 'Document tools' }).click();
  await expect(page.getByText('Document tools need a PDF service')).toBeVisible();
});
