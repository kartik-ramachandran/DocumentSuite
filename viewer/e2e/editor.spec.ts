import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { clickOnPage, demoUrl, dragOnPage, exportedPdf, fixture, openDemo, openFile, pageHasInk, readPdf } from './helpers';

const annotations = (page: Page) => page.evaluate(() => (window as never as { pdfPlugin: { annotations: { getAnnotations(): Array<Record<string, unknown>> } } }).pdfPlugin.annotations.getAnnotations());

test.describe('annotations', () => {
  test.beforeEach(async ({ page }) => {
    await openDemo(page, demoUrl());
    await openFile(page, 'report.pdf', 5);
    await page.getByLabel('Zoom level').selectOption('1');
    await expect.poll(async () => Math.round((await page.locator('.pv-page[data-page="1"]').boundingBox())!.width)).toBe(612);
  });

  test('drawing appears on the page and goes into the PDF', async ({ page }) => {
    const before = await (await exportedPdf(page)).operators(1);
    await page.getByRole('button', { name: 'Draw', exact: true }).click();
    await dragOnPage(page, 1, [100, 100], [300, 180]);
    await expect(page.locator('.pv-page[data-page="1"] [data-kind="ink"]')).toHaveCount(1);
    expect(await (await exportedPdf(page)).operators(1)).toBeGreaterThan(before);
  });

  test('highlighting snaps to the text under the drag', async ({ page }) => {
    await page.getByRole('button', { name: 'Highlight text' }).click();
    await dragOnPage(page, 1, [72, 125], [250, 132]);
    await expect(page.locator('.pv-page[data-page="1"] [data-kind="highlight"] rect')).toHaveCount(1);
    const [highlight] = await annotations(page);
    const rect = (highlight.rects as Array<{ y: number; height: number }>)[0];
    expect(rect.y).toBeGreaterThan(110);
    expect(rect.height).toBeLessThan(20);
    await exportedPdf(page);
  });

  test('text annotations can be read from the exported PDF', async ({ page }) => {
    await page.getByRole('button', { name: 'Add text' }).click();
    await clickOnPage(page, 1, [100, 500]);
    const editor = page.getByLabel('Annotation text');
    await editor.fill('Reviewed by Ada');
    await editor.press('Control+Enter');
    await expect(page.locator('.pv-page[data-page="1"] [data-kind="text"]')).toHaveCount(1);
    expect(await (await exportedPdf(page)).text(1)).toContain('Reviewed by Ada');
  });

  test('non-Western text still exports without failing', async ({ page }) => {
    await page.getByRole('button', { name: 'Add text' }).click();
    await clickOnPage(page, 1, [100, 500]);
    const editor = page.getByLabel('Annotation text');
    await editor.fill('नमस्ते 你好');
    await editor.press('Control+Enter');
    const saved = await exportedPdf(page);
    expect(saved.pageCount).toBe(5);
  });

  test('comments become real PDF comments', async ({ page }) => {
    await page.getByRole('button', { name: 'Add a comment' }).click();
    await clickOnPage(page, 1, [300, 300]);
    await page.getByRole('dialog', { name: 'Add a comment' }).getByRole('textbox').fill('Please check (this) figure');
    await page.getByRole('button', { name: 'Save' }).click();
    const notes = await (await exportedPdf(page)).annotations(1);
    const note = notes.find((annotation) => annotation.subtype === 'Text');
    expect(note?.contentsObj?.str ?? note?.contents).toContain('Please check (this) figure');
  });

  test('pictures can be placed like a signature', async ({ page }) => {
    const before = await (await exportedPdf(page)).operators(1);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/AAAMBAQAY3Y2wAAAAAElFTkSuQmCC', 'base64');
    await page.getByLabel('Choose a picture').setInputFiles({ name: 'sign.png', mimeType: 'image/png', buffer: png });
    await expect(page.getByRole('button', { name: 'Add a picture or signature' })).toHaveAttribute('aria-pressed', 'true');
    await clickOnPage(page, 1, [200, 600]);
    await expect(page.locator('.pv-page[data-page="1"] [data-kind="stamp"]')).toHaveCount(1);
    expect(await (await exportedPdf(page)).operators(1)).toBeGreaterThan(before);
  });

  test('undo and redo work from the buttons and keyboard', async ({ page }) => {
    await page.getByRole('button', { name: 'Draw a rectangle' }).click();
    await dragOnPage(page, 1, [100, 100], [200, 200]);
    await dragOnPage(page, 1, [250, 100], [350, 200]);
    await expect(page.locator('[data-kind="rect"]')).toHaveCount(2);

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator('[data-kind="rect"]')).toHaveCount(1);
    await page.getByRole('button', { name: 'Redo' }).click();
    await expect(page.locator('[data-kind="rect"]')).toHaveCount(2);

    await page.locator('.pv-scroll').focus();
    await page.keyboard.press('Control+z');
    await expect(page.locator('[data-kind="rect"]')).toHaveCount(1);
  });

  test('annotations can be selected, moved and deleted', async ({ page }) => {
    await page.getByRole('button', { name: 'Draw a rectangle' }).click();
    await dragOnPage(page, 1, [100, 100], [200, 200]);
    await page.getByRole('button', { name: 'Select annotations' }).click();

    await dragOnPage(page, 1, [100, 150], [150, 250]);
    await expect.poll(async () => (await annotations(page))[0].x).toBeGreaterThan(140);
    expect((await annotations(page))[0].y).toBeGreaterThan(190);

    await page.keyboard.press('Delete');
    await expect(page.locator('[data-kind="rect"]')).toHaveCount(0);
  });

  test('annotations stay in position when zoomed', async ({ page }) => {
    await page.getByRole('button', { name: 'Draw a rectangle' }).click();
    await dragOnPage(page, 1, [100, 100], [200, 200]);
    const pageBox = () => page.locator('.pv-page[data-page="1"]').boundingBox();
    const shapeBox = () => page.locator('[data-kind="rect"] rect').boundingBox();
    const relative = async () => {
      const [outer, inner] = [(await pageBox())!, (await shapeBox())!];
      return (inner.x - outer.x) / outer.width;
    };
    const before = await relative();
    await page.getByLabel('Zoom level').selectOption('2');
    await expect.poll(async () => Math.round((await pageBox())!.width)).toBe(1224);
    expect(Math.abs((await relative()) - before)).toBeLessThan(0.005);
  });

  test('saved annotations can be restored', async ({ page }) => {
    await page.getByRole('button', { name: 'Draw a rectangle' }).click();
    await dragOnPage(page, 1, [100, 100], [200, 200]);
    const saved = await annotations(page);
    await page.evaluate((items) => {
      const { annotations: controller } = (window as never as { pdfPlugin: { annotations: { clear(): void; setAnnotations(value: unknown): void } } }).pdfPlugin;
      controller.clear();
      controller.setAnnotations(items);
    }, saved);
    await expect(page.locator('[data-kind="rect"]')).toHaveCount(1);
  });

  test('a new document starts with no annotations', async ({ page }) => {
    await page.getByRole('button', { name: 'Draw a rectangle' }).click();
    await dragOnPage(page, 1, [100, 100], [200, 200]);
    await openFile(page, 'form.pdf', 1);
    await expect(page.locator('[data-kind="rect"]')).toHaveCount(0);
    expect(await annotations(page)).toEqual([]);
  });
});

test('annotations land correctly on a page with built-in rotation', async ({ page }) => {
  await openDemo(page, demoUrl());
  await openFile(page, 'rotated.pdf', 1);
  await page.getByRole('button', { name: 'Add text' }).click();
  await clickOnPage(page, 1, [100, 200]);
  const editor = page.getByLabel('Annotation text');
  await editor.fill('RotatedNote');
  await editor.press('Control+Enter');

  // Reopened in the viewer, the text must appear where it was placed on screen.
  const base64 = await page.evaluate(() => (window as never as { pdfViewer: { getBase64(): Promise<string> } }).pdfViewer.getBase64());
  await page.evaluate((data) => (window as never as { pdfViewer: { load(source: unknown): Promise<void> } }).pdfViewer.load({ base64: data, name: 'x.pdf' }), base64);
  const runs = await page.waitForFunction(async () => {
    const viewer = (window as never as { pdfViewer: { pageCount: number; getPageText(n: number): Promise<Array<{ text: string; left: number; top: number }>> } }).pdfViewer;
    if (viewer.pageCount !== 1) return null;
    const found = (await viewer.getPageText(1)).find((run) => run.text.includes('RotatedNote'));
    return found ?? null;
  });
  const run = (await runs.jsonValue()) as { left: number; top: number };
  expect(Math.abs(run.left - 100)).toBeLessThan(4);
  expect(Math.abs(run.top - 200)).toBeLessThan(16);
});

test.describe('forms', () => {
  test.beforeEach(async ({ page }) => {
    await openDemo(page, demoUrl());
    await openFile(page, 'form.pdf', 1);
    await expect(page.locator('[data-field="full_name"]')).toBeVisible();
  });

  test('filled values are saved into the PDF', async ({ page }) => {
    await page.locator('[data-field="full_name"]').fill('Ada Lovelace');
    await page.locator('[data-field="agree"]').check();
    await page.locator('[data-field="country"]').selectOption('New Zealand');

    const values = await (await exportedPdf(page)).fieldValues();
    expect(values.full_name).toBe('Ada Lovelace');
    expect(values.agree).toBe('Yes');
    expect(values.country).toContain('New Zealand');
  });

  test('fields line up with where the form places them', async ({ page }) => {
    const pageBox = (await page.locator('.pv-page[data-page="1"]').boundingBox())!;
    const scale = await page.evaluate(() => (window as never as { pdfViewer: { zoom: number } }).pdfViewer.zoom);
    const field = (await page.locator('[data-field="full_name"]').boundingBox())!;
    expect(Math.abs(field.x - (pageBox.x + 72 * scale))).toBeLessThan(3);
    expect(Math.abs(field.y - (pageBox.y + (792 - 686) * scale))).toBeLessThan(3);
    expect(Math.abs(field.width - 300 * scale)).toBeLessThan(3);
  });

  test('forms and annotations can be saved together', async ({ page }) => {
    await page.locator('[data-field="full_name"]').fill('Grace Hopper');
    await page.getByRole('button', { name: 'Add text' }).click();
    await clickOnPage(page, 1, [100, 280]);
    const editor = page.getByLabel('Annotation text');
    await editor.fill('Approved');
    await editor.press('Control+Enter');

    const saved = await exportedPdf(page);
    expect((await saved.fieldValues()).full_name).toBe('Grace Hopper');
    expect(await saved.text(1)).toContain('Approved');
  });
});

test('an untouched document exports unchanged', async ({ page }) => {
  await openDemo(page, demoUrl());
  await openFile(page, 'report.pdf', 5);
  expect((await exportedPdf(page)).bytes.equals(readFileSync(fixture('report.pdf')))).toBe(true);
});

test('without the editor plugin there are no editing tools', async ({ page }) => {
  await openDemo(page, demoUrl({ editor: '0' }));
  await openFile(page, 'report.pdf', 5);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Document tools' })).toHaveCount(0);
  expect((await exportedPdf(page)).bytes.equals(readFileSync(fixture('report.pdf')))).toBe(true);
  expect(await pageHasInk(page, 1)).toBe(true);
});

test('a downloaded annotated file opens as a normal PDF', async ({ page }) => {
  await openDemo(page, demoUrl());
  await openFile(page, 'report.pdf', 5);
  await page.getByRole('button', { name: 'Draw a rectangle' }).click();
  await dragOnPage(page, 1, [100, 100], [200, 200]);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download' }).click()]);
  const saved = await readPdf(readFileSync(await download.path()));
  expect(saved.pageCount).toBe(5);
});

test.describe('comments and text after they are added', () => {
  const page1 = (page: Page) => page.locator('.pv-page[data-page="1"]');
  const notes = (page: Page) => page1(page).locator('[data-kind="note"]');
  const texts = (page: Page) => page1(page).locator('[data-kind="text"]');
  const commentTool = (page: Page) => page.getByRole('button', { name: 'Add a comment' });
  const textTool = (page: Page) => page.getByRole('button', { name: 'Add text' });
  const addDialog = (page: Page) => page.getByRole('dialog', { name: 'Add a comment' });
  const editDialog = (page: Page) => page.getByRole('dialog', { name: 'Edit comment' });

  async function addComment(page: Page, text: string, at: [number, number] = [300, 300]): Promise<void> {
    await commentTool(page).click();
    await clickOnPage(page, 1, at);
    await addDialog(page).getByRole('textbox').fill(text);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(addDialog(page)).toHaveCount(0);
  }

  async function addText(page: Page, text: string): Promise<void> {
    await textTool(page).click();
    await clickOnPage(page, 1, [100, 500]);
    await page.getByLabel('Annotation text').fill(text);
    await page.getByLabel('Annotation text').press('Control+Enter');
    await expect(texts(page)).toHaveCount(1);
  }

  test.beforeEach(async ({ page }) => {
    await openDemo(page, demoUrl());
    await openFile(page, 'report.pdf', 5);
    await page.getByLabel('Zoom level').selectOption('1');
    await expect.poll(async () => Math.round((await page1(page).boundingBox())!.width)).toBe(612);
  });

  test('the comment tool turns off once a comment is saved', async ({ page }) => {
    await addComment(page, 'First');
    await expect(commentTool(page)).toHaveAttribute('aria-pressed', 'false');
    await clickOnPage(page, 1, [100, 100]);
    await page.waitForTimeout(150);
    await expect(addDialog(page)).toHaveCount(0);
    await expect(notes(page)).toHaveCount(1);
  });

  test('cancelling a new comment keeps the tool on, and adds nothing', async ({ page }) => {
    await commentTool(page).click();
    await clickOnPage(page, 1, [300, 300]);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(notes(page)).toHaveCount(0);
    await expect(commentTool(page)).toHaveAttribute('aria-pressed', 'true');
  });

  test('clicking a comment opens it, and saving changes it rather than adding another', async ({ page }) => {
    await addComment(page, 'First');
    await notes(page).click();
    await expect(editDialog(page).getByRole('textbox')).toHaveValue('First');
    await editDialog(page).getByRole('textbox').fill('Changed');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(notes(page)).toHaveCount(1);
    await expect(notes(page).locator('title')).toHaveText('Changed');
    const exported = (await (await exportedPdf(page)).annotations(1)).find((annotation) => annotation.subtype === 'Text');
    expect(exported?.contentsObj?.str ?? exported?.contents).toContain('Changed');
  });

  test('with the comment tool on, an existing comment opens and empty space starts a new one', async ({ page }) => {
    await addComment(page, 'First');
    await commentTool(page).click();
    await notes(page).click();
    await expect(editDialog(page)).toBeVisible();
    await expect(addDialog(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(notes(page)).toHaveCount(1);

    await clickOnPage(page, 1, [100, 100]);
    await expect(addDialog(page)).toBeVisible();
  });

  test('a comment stays readable by hover when no tool is on', async ({ page }) => {
    await addComment(page, 'Read me');
    await expect(notes(page).locator('title')).toHaveText('Read me');
    await expect(notes(page)).toHaveCSS('pointer-events', 'auto');
    await expect(notes(page)).toHaveCSS('cursor', 'pointer');
  });

  test('other tools draw straight over a comment', async ({ page }) => {
    await addComment(page, 'First', [300, 300]);
    await page.getByRole('button', { name: 'Draw a rectangle' }).click();
    await dragOnPage(page, 1, [280, 280], [340, 340]);
    await expect(page1(page).locator('[data-kind="rect"]')).toHaveCount(1);
    await expect(editDialog(page)).toHaveCount(0);
  });

  test('with the select tool, a click selects a comment and a double click opens it', async ({ page }) => {
    await addComment(page, 'First');
    await page.getByRole('button', { name: 'Select annotations' }).click();
    await notes(page).click();
    await expect(page.locator('[data-selected="true"]')).toHaveCount(1);
    await expect(editDialog(page)).toHaveCount(0);

    await notes(page).dblclick();
    await expect(editDialog(page).getByRole('textbox')).toHaveValue('First');
  });

  test('a comment can still be moved and deleted with the select tool', async ({ page }) => {
    await addComment(page, 'First', [300, 300]);
    await page.getByRole('button', { name: 'Select annotations' }).click();
    const before = (await notes(page).boundingBox())!;
    await page.mouse.move(before.x + 5, before.y + 5);
    await page.mouse.down();
    await page.mouse.move(before.x + 85, before.y + 65, { steps: 4 });
    await page.mouse.up();
    const after = (await notes(page).boundingBox())!;
    expect(Math.round(after.x - before.x)).toBe(80);
    await page.keyboard.press('Delete');
    await expect(notes(page)).toHaveCount(0);
  });

  test('clearing a comment deletes it, and undo brings it back', async ({ page }) => {
    await addComment(page, 'First');
    await notes(page).click();
    await editDialog(page).getByRole('textbox').fill('');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(notes(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(notes(page)).toHaveCount(1);
  });

  test('keyboard shortcuts keep working after saving a comment', async ({ page }) => {
    await addComment(page, 'First');
    await page.keyboard.press('Control+z');
    await expect(notes(page)).toHaveCount(0);
  });

  test('clicking away saves text, without opening another box', async ({ page }) => {
    await textTool(page).click();
    await clickOnPage(page, 1, [100, 500]);
    await page.getByLabel('Annotation text').fill('Typed');
    await clickOnPage(page, 1, [300, 200]);
    await expect(texts(page)).toHaveCount(1);
    await expect(page.getByLabel('Annotation text')).toHaveCount(0);
    await expect(textTool(page)).toHaveAttribute('aria-pressed', 'false');
  });

  test('clicking away from an empty text box closes it and keeps the tool on', async ({ page }) => {
    await textTool(page).click();
    await clickOnPage(page, 1, [100, 500]);
    await expect(page.getByLabel('Annotation text')).toBeFocused();
    await clickOnPage(page, 1, [300, 200]);
    await expect(page.getByLabel('Annotation text')).toHaveCount(0);
    await expect(texts(page)).toHaveCount(0);
    await expect(textTool(page)).toHaveAttribute('aria-pressed', 'true');
  });

  test('switching tools saves text that is still being typed', async ({ page }) => {
    await textTool(page).click();
    await clickOnPage(page, 1, [100, 500]);
    await page.getByLabel('Annotation text').fill('Typed');
    await page.getByRole('button', { name: 'Draw a rectangle' }).click();
    await expect(texts(page)).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Draw a rectangle' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('with the select tool, a double click edits text in place', async ({ page }) => {
    await addText(page, 'Typed');
    await page.getByRole('button', { name: 'Select annotations' }).click();
    await texts(page).dblclick();
    const editor = page.getByLabel('Annotation text');
    await expect(editor).toHaveValue('Typed');
    await expect(texts(page)).toHaveCount(0);
    await editor.fill('Changed');
    await editor.press('Control+Enter');
    await expect(texts(page)).toHaveText('Changed');
    expect(await (await exportedPdf(page)).text(1)).toContain('Changed');
  });

  test('Esc while editing text keeps what was there', async ({ page }) => {
    await addText(page, 'Typed');
    await page.getByRole('button', { name: 'Select annotations' }).click();
    await texts(page).dblclick();
    await page.getByLabel('Annotation text').fill('Changed');
    await page.getByLabel('Annotation text').press('Escape');
    await expect(texts(page)).toHaveText('Typed');
  });
});
