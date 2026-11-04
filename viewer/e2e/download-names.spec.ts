import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { demoUrl, fixture, isServiceUp, openDemo, openFile, waitForDocument } from './helpers';

const downloadButton = (page: Page) => page.getByRole('button', { name: 'Download', exact: true });
const renameDialog = (page: Page) => page.locator('[data-pdf-rename] dialog');
const nameInput = (page: Page) => page.getByRole('textbox', { name: /File name/ });
const confirmButton = (page: Page) => renameDialog(page).getByRole('button', { name: 'Download', exact: true });

async function download(page: Page, action: () => Promise<unknown>) {
  const [file] = await Promise.all([page.waitForEvent('download'), action()]);
  return file;
}

test.describe('with renaming off, the default', () => {
  test.beforeEach(async ({ page }) => openDemo(page, demoUrl()));

  test('a PDF downloads straight away with its uploaded name', async ({ page }) => {
    await openFile(page, 'report.pdf', 5);
    const file = await download(page, () => downloadButton(page).click());
    expect(file.suggestedFilename()).toBe('report.pdf');
    await expect(renameDialog(page)).toHaveCount(0);
  });

  test('names with several dots and capital letters are kept exactly', async ({ page }) => {
    await page.getByLabel('Choose a file to open').setInputFiles({ name: 'Q3 Report v2.1 FINAL.PDF', mimeType: 'application/pdf', buffer: readFileSync(fixture('report.pdf')) });
    await waitForDocument(page, 5);
    const file = await download(page, () => downloadButton(page).click());
    expect(file.suggestedFilename()).toBe('Q3 Report v2.1 FINAL.PDF');
  });

  test('an image keeps its uploaded name', async ({ page }) => {
    await page.getByLabel('Choose a file to open').setInputFiles(fixture('photo.jpg'));
    await expect(page.locator('.viewer-canvas img')).toBeVisible();
    const file = await download(page, () => downloadButton(page).click());
    expect(file.suggestedFilename()).toBe('photo.jpg');
  });

  test('your code can still choose a name', async ({ page }) => {
    await openFile(page, 'report.pdf', 5);
    const file = await download(page, () => page.evaluate(() => (window as never as { pdfViewer: { download(name: string): Promise<boolean> } }).pdfViewer.download('chosen.pdf')));
    expect(file.suggestedFilename()).toBe('chosen.pdf');
  });
});

test.describe('converted documents', () => {
  test.beforeAll(async () => {
    test.skip(!(await isServiceUp()), 'needs the PDF service at localhost:8080');
  });

  test('an untouched Word file downloads as the original file', async ({ page }) => {
    await openDemo(page, demoUrl());
    await openFile(page, 'note.docx', 1);
    const file = await download(page, () => downloadButton(page).click());
    expect(file.suggestedFilename()).toBe('note.docx');
    expect(readFileSync(await file.path()).equals(readFileSync(fixture('note.docx')))).toBe(true);
  });

  test('an annotated Word file downloads as a PDF with the same name', async ({ page }) => {
    await openDemo(page, demoUrl());
    await openFile(page, 'note.docx', 1);
    await page.getByRole('button', { name: 'Draw a rectangle' }).click();
    const area = (await page.locator('.pv-page[data-page="1"]').boundingBox())!;
    await page.mouse.move(area.x + 60, area.y + 60);
    await page.mouse.down();
    await page.mouse.move(area.x + 160, area.y + 140, { steps: 4 });
    await page.mouse.up();
    const file = await download(page, () => downloadButton(page).click());
    expect(file.suggestedFilename()).toBe('note.pdf');
    expect(readFileSync(await file.path()).subarray(0, 4).toString()).toBe('%PDF');
  });

  test('tools name their results after the document', async ({ page }) => {
    await openDemo(page, demoUrl());
    await openFile(page, 'report.pdf', 5);
    await page.getByRole('button', { name: 'Toggle side panel' }).click();
    await page.getByRole('button', { name: 'Document tools' }).click();
    await page.locator('details[data-tool="convert"] summary').click();
    const file = await download(page, () => page.locator('details[data-tool="convert"]').getByRole('button', { name: 'Convert', exact: true }).click());
    expect(file.suggestedFilename()).toBe('report.docx');
  });

  for (const [route, expected] of [['pdf-to-word', 'report.docx'], ['pdf-to-text', 'report.txt'], ['rotate', 'report.pdf'], ['compress', 'report.pdf'], ['any-to-pdf', 'report.pdf']] as const) {
    test(`the API's ${route} route keeps the name`, async ({ request }) => {
      const response = await request.post(`http://localhost:8080/api/pdf/${route}`, {
        multipart: { file: { name: 'report.pdf', mimeType: 'application/pdf', buffer: readFileSync(fixture('report.pdf')) } },
      });
      expect(response.ok()).toBe(true);
      expect(response.headers()['content-disposition']).toContain(`filename=${expected}`);
    });
  }

  test('the JSON API keeps the name too', async ({ request }) => {
    const response = await request.post('http://localhost:8080/api/json/any-to-pdf', {
      data: { file: { name: 'My Notes.txt', data: Buffer.from('hello').toString('base64') } },
    });
    expect((await response.json()).fileName).toBe('My Notes.pdf');
  });
});

test.describe('with renaming on', () => {
  test.beforeEach(async ({ page }) => openDemo(page, demoUrl({ rename: '1' })));

  test('asks for a name, starting from the uploaded one', async ({ page }) => {
    await openFile(page, 'report.pdf', 5);
    await downloadButton(page).click();
    await expect(renameDialog(page)).toBeVisible();
    await expect(nameInput(page)).toHaveValue('report');
    await expect(nameInput(page)).toBeFocused();
    await expect(renameDialog(page)).toContainText('.pdf');
  });

  test('downloads with the new name, keeping the extension', async ({ page }) => {
    await openFile(page, 'report.pdf', 5);
    await downloadButton(page).click();
    await nameInput(page).fill('Board pack');
    const file = await download(page, () => confirmButton(page).click());
    expect(file.suggestedFilename()).toBe('Board pack.pdf');
    await expect(renameDialog(page)).toHaveCount(0);
  });

  test('keeping the suggested name is one key press', async ({ page }) => {
    await openFile(page, 'report.pdf', 5);
    await downloadButton(page).click();
    const file = await download(page, () => page.keyboard.press('Enter'));
    expect(file.suggestedFilename()).toBe('report.pdf');
  });

  test('typing the extension as well does not double it', async ({ page }) => {
    await openFile(page, 'report.pdf', 5);
    await downloadButton(page).click();
    await nameInput(page).fill('summary.PDF');
    const file = await download(page, () => confirmButton(page).click());
    expect(file.suggestedFilename()).toBe('summary.pdf');
  });

  test('the next download starts from the new name', async ({ page }) => {
    await openFile(page, 'report.pdf', 5);
    await downloadButton(page).click();
    await nameInput(page).fill('Second name');
    await download(page, () => confirmButton(page).click());
    await downloadButton(page).click();
    await expect(nameInput(page)).toHaveValue('Second name');
  });

  for (const [name, value, message] of [['empty', '   ', 'Enter a file name'], ['with a slash', 'a/b', "can't contain"], ['with a colon', 'a:b', "can't contain"], ['too long', 'x'.repeat(201), '200 characters']] as const) {
    test(`rejects a name that is ${name}`, async ({ page }) => {
      await openFile(page, 'report.pdf', 5);
      await downloadButton(page).click();
      await nameInput(page).fill(value);
      await confirmButton(page).click();
      await expect(renameDialog(page).getByRole('alert')).toContainText(message);
      await expect(renameDialog(page)).toBeVisible();
    });
  }

  test('Cancel and Esc download nothing', async ({ page }) => {
    let downloads = 0;
    page.on('download', () => downloads++);
    await openFile(page, 'report.pdf', 5);

    await downloadButton(page).click();
    await renameDialog(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(renameDialog(page)).toHaveCount(0);

    await downloadButton(page).click();
    await page.keyboard.press('Escape');
    await expect(renameDialog(page)).toHaveCount(0);

    await page.waitForTimeout(300);
    expect(downloads).toBe(0);
  });

  test('your code can skip the question by passing a name', async ({ page }) => {
    await openFile(page, 'report.pdf', 5);
    const file = await download(page, () => page.evaluate(() => (window as never as { pdfViewer: { download(name: string): Promise<boolean> } }).pdfViewer.download('chosen.pdf')));
    expect(file.suggestedFilename()).toBe('chosen.pdf');
    await expect(renameDialog(page)).toHaveCount(0);
  });

  test('images ask too, keeping their extension', async ({ page }) => {
    await page.getByLabel('Choose a file to open').setInputFiles(fixture('photo.png'));
    await expect(page.locator('.viewer-canvas img')).toBeVisible();
    await downloadButton(page).click();
    await nameInput(page).fill('Site photo');
    const file = await download(page, () => confirmButton(page).click());
    expect(file.suggestedFilename()).toBe('Site photo.png');
  });
});

test.describe('from the file list', () => {
  const row = (page: Page, id: string) => page.locator(`li[data-file="${id}"]`);
  const openMenuDownload = async (page: Page, id: string) => {
    await row(page, id).click({ button: 'right' });
    await page.getByRole('menu').getByRole('menuitem', { name: 'Download' }).click();
  };

  test('renaming off keeps the uploaded name', async ({ page }) => {
    await page.goto('/');
    await expect(row(page, 'report')).toBeVisible();
    const file = await download(page, () => openMenuDownload(page, 'report'));
    expect(file.suggestedFilename()).toBe('Annual report.pdf');
    await expect(renameDialog(page)).toHaveCount(0);
  });

  test('renaming on asks first', async ({ page }) => {
    await page.goto('/?rename=1');
    await expect(row(page, 'report')).toBeVisible();
    await openMenuDownload(page, 'report');
    await expect(nameInput(page)).toHaveValue('Annual report');
    await nameInput(page).fill('Board pack');
    const file = await download(page, () => confirmButton(page).click());
    expect(file.suggestedFilename()).toBe('Board pack.pdf');
  });

  test('inside the modal, Esc closes the question but not the modal', async ({ page }) => {
    await page.goto('/?rename=1');
    await row(page, 'report').click();
    await expect(page.locator('.pv-page[data-page="1"] canvas.pv-canvas')).toBeVisible();
    await downloadButton(page).click();
    await expect(renameDialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(renameDialog(page)).toHaveCount(0);
    await expect(page.locator('[data-pdf-modal] dialog')).toBeVisible();
  });

  test('Download and close can be renamed, and cancelling keeps the modal open', async ({ page }) => {
    await page.goto('/?rename=1');
    await row(page, 'report').click();
    await expect(page.locator('.pv-page[data-page="1"] canvas.pv-canvas')).toBeVisible();
    await page.getByRole('button', { name: 'Draw a rectangle' }).click();
    const area = (await page.locator('.pv-page[data-page="1"]').boundingBox())!;
    await page.mouse.move(area.x + 60, area.y + 60);
    await page.mouse.down();
    await page.mouse.move(area.x + 160, area.y + 140, { steps: 4 });
    await page.mouse.up();

    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Download and close' }).click();
    await renameDialog(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('[data-pdf-modal] dialog')).toBeVisible();
    await expect(page.locator('[data-kind="rect"]')).toHaveCount(1);

    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Download and close' }).click();
    await nameInput(page).fill('Reviewed report');
    const file = await download(page, () => confirmButton(page).click());
    expect(file.suggestedFilename()).toBe('Reviewed report.pdf');
    await expect(page.locator('[data-pdf-modal] dialog')).toHaveCount(0);
  });
});
