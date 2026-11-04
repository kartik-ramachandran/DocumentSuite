import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { demoUrl, exportedPdf, fixture, isServiceUp } from './helpers';

const row = (page: Page, id: string) => page.locator(`li[data-file="${id}"]`);
const menu = (page: Page) => page.getByRole('menu');
const dialog = (page: Page) => page.locator('[data-pdf-modal] dialog');
const firstPage = (page: Page) => page.locator('.pv-page[data-page="1"] canvas.pv-canvas');

const listUrl = (settings: object = {}) => `/?settings=${encodeURIComponent(JSON.stringify(settings))}`;
const viewerUrl = (settings: object) => demoUrl({ settings: JSON.stringify(settings) });

async function openList(page: Page, settings: object = {}): Promise<void> {
  await page.goto(listUrl(settings));
  await expect(row(page, 'report')).toBeVisible();
}

async function openViewer(page: Page, settings: object, file = 'report.pdf'): Promise<void> {
  await page.goto(viewerUrl(settings));
  await page.waitForFunction(() => Boolean((window as never as { pdfViewer?: unknown }).pdfViewer));
  await page.locator('input[type="file"]').first().setInputFiles(fixture(file));
  await expect(firstPage(page)).toBeVisible({ timeout: 30_000 });
}

test.describe('single and double click', () => {
  test('single click opens the file by default', async ({ page }) => {
    await openList(page);
    await row(page, 'report').click();
    await expect(dialog(page)).toBeVisible();
  });

  test('single click can show the menu', async ({ page }) => {
    await openList(page, { clickAction: 'menu' });
    await row(page, 'report').click();
    await expect(menu(page)).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);
  });

  test('single click can do nothing', async ({ page }) => {
    await openList(page, { clickAction: 'none' });
    await row(page, 'report').click();
    await page.waitForTimeout(200);
    await expect(menu(page)).toHaveCount(0);
    await expect(dialog(page)).toHaveCount(0);
  });

  test('double click can open the file while single click does nothing', async ({ page }) => {
    await openList(page, { clickAction: 'none', doubleClickAction: 'open' });
    await row(page, 'report').dblclick();
    await expect(dialog(page)).toBeVisible();
  });

  test('double click can show the menu', async ({ page }) => {
    await openList(page, { clickAction: 'none', doubleClickAction: 'menu' });
    await row(page, 'report').dblclick();
    await expect(menu(page)).toBeVisible();
  });
});

test.describe('file list', () => {
  test('right-click can leave the browser menu alone', async ({ page }) => {
    await openList(page, { contextMenu: false });
    const prevented = await row(page, 'report').evaluate((element) => {
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, composed: true, clientX: 50, clientY: 50 });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(prevented).toBe(false);
    await expect(menu(page)).toHaveCount(0);
  });

  test('the menu button and file details can be hidden', async ({ page }) => {
    await openList(page, { showMenuButton: false, showFileDetails: false });
    await expect(page.locator('.pl-more')).toHaveCount(0);
    await expect(page.locator('.pl-meta')).toHaveCount(0);
    await row(page, 'report').click({ button: 'right' });
    await expect(menu(page)).toBeVisible();
  });

  test('changing settings updates a list that is already showing', async ({ page }) => {
    await openList(page);
    await expect(page.locator('.pl-more').first()).toBeVisible();
    await page.evaluate(() => (window as never as { configureViewer(value: object): void }).configureViewer({ showMenuButton: false, clickAction: 'menu' }));
    await expect(page.locator('.pl-more')).toHaveCount(0);
    await row(page, 'report').click();
    await expect(menu(page)).toBeVisible();
  });
});

test.describe('viewer window', () => {
  const open = async (page: Page, settings: object) => {
    await openList(page, settings);
    await row(page, 'report').click();
    await expect(firstPage(page)).toBeVisible();
  };
  const box = async (page: Page) => (await dialog(page).boundingBox())!;

  test('resizing can be turned off', async ({ page }) => {
    await open(page, {});
    await expect(page.locator('.pm-handle').first()).toBeAttached();

    await open(page, { modalResizable: false });
    await expect(page.locator('.pm-handle')).toHaveCount(0);
  });

  test('moving can be turned off', async ({ page }) => {
    await open(page, { modalMovable: false });
    const before = await box(page);
    const title = (await page.locator('.pm-title').boundingBox())!;
    await page.mouse.move(title.x + 10, title.y + 8);
    await page.mouse.down();
    await page.mouse.move(title.x + 90, title.y + 58, { steps: 4 });
    await page.mouse.up();
    expect(await box(page)).toEqual(before);
  });

  test('maximizing can be turned off', async ({ page }) => {
    await open(page, {});
    await expect(page.getByRole('button', { name: 'Maximize' })).toBeVisible();

    await open(page, { modalMaximizable: false });
    await expect(page.getByRole('button', { name: 'Maximize' })).toHaveCount(0);
    await page.locator('.pm-title').dblclick();
    await expect(page.getByRole('button', { name: 'Restore size' })).toHaveCount(0);
  });

  test('Esc can leave it open', async ({ page }) => {
    await open(page, { closeOnEscape: false });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await expect(dialog(page)).toBeVisible();
  });

  test('clicking outside can close it, and otherwise does not', async ({ page }) => {
    await open(page, {});
    await page.mouse.click(5, 5);
    await page.waitForTimeout(200);
    await expect(dialog(page)).toBeVisible();

    await open(page, { closeOnBackdropClick: true });
    const inside = await box(page);
    await page.mouse.click(inside.x + 200, inside.y + 200);
    await page.waitForTimeout(100);
    await expect(dialog(page)).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(dialog(page)).toHaveCount(0);
  });

  test('remembering the size can be turned off', async ({ page }) => {
    await open(page, { rememberModalSize: false });
    const first = await box(page);
    const handle = (await page.locator('.pm-handle[data-edge="se"]').boundingBox())!;
    await page.mouse.move(handle.x + 8, handle.y + 8);
    await page.mouse.down();
    await page.mouse.move(handle.x - 100, handle.y - 60, { steps: 3 });
    await page.mouse.up();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await row(page, 'form').click();
    await expect(dialog(page)).toBeVisible();
    expect((await box(page)).width).toBe(first.width);
  });

  test('asking before closing can be turned off', async ({ page }) => {
    await open(page, { confirmClose: false });
    await page.getByRole('button', { name: 'Draw a rectangle' }).click();
    const area = (await page.locator('.pv-page[data-page="1"]').boundingBox())!;
    await page.mouse.move(area.x + 60, area.y + 60);
    await page.mouse.down();
    await page.mouse.move(area.x + 160, area.y + 140, { steps: 4 });
    await page.mouse.up();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog(page)).toHaveCount(0);
  });
});

test.describe('downloads', () => {
  test('turning downloads off removes them everywhere', async ({ page }) => {
    await openList(page, { allowDownload: false });
    await row(page, 'report').click({ button: 'right' });
    await expect(menu(page).getByRole('menuitem', { name: 'Download' })).toHaveCount(0);
    await menu(page).getByRole('menuitem', { name: 'Open' }).click();
    await expect(firstPage(page)).toBeVisible();

    await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeHidden();

    await page.getByRole('button', { name: 'Toggle side panel' }).click();
    await page.getByRole('button', { name: 'Document tools' }).click();
    await expect(page.locator('details[data-tool="convert"]')).toBeHidden();
    await expect(page.locator('details[data-tool="compress"]')).toBeVisible();

    await page.getByRole('button', { name: 'Draw a rectangle' }).click();
    const area = (await page.locator('.pv-page[data-page="1"]').boundingBox())!;
    await page.mouse.move(area.x + 60, area.y + 60);
    await page.mouse.down();
    await page.mouse.move(area.x + 160, area.y + 140, { steps: 4 });
    await page.mouse.up();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download and close' })).toHaveCount(0);
  });

  test('the rename setting asks for a name', async ({ page }) => {
    await openViewer(page, { allowRename: true });
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    await expect(page.getByRole('textbox', { name: /File name/ })).toHaveValue('report');
  });
});

test.describe('viewer', () => {
  for (const [key, name] of [['allowOpen', 'Open file'], ['allowPrint', 'Print'], ['allowSearch', 'Search'], ['allowRotate', 'Rotate view']] as const) {
    test(`${key} can hide its button`, async ({ page }) => {
      await page.goto(viewerUrl({}));
      await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
      await page.goto(viewerUrl({ [key]: false }));
      await page.waitForFunction(() => Boolean((window as never as { pdfViewer?: unknown }).pdfViewer));
      await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible();
      await expect(page.getByRole('button', { name, exact: true })).toBeHidden();
    });
  }

  test('turning search off also disables its shortcut', async ({ page }) => {
    await openViewer(page, {});
    await page.locator('.pv-scroll').focus();
    await page.keyboard.press('Control+f');
    await expect(page.getByLabel('Find in document')).toBeVisible();

    await openViewer(page, { allowSearch: false });
    await page.locator('.pv-scroll').focus();
    await page.keyboard.press('Control+f');
    await expect(page.getByLabel('Find in document')).toBeHidden();
  });

  test('turning rotation off also hides it for images', async ({ page }) => {
    await page.goto(viewerUrl({ allowRotate: false }));
    await page.waitForFunction(() => Boolean((window as never as { pdfViewer?: unknown }).pdfViewer));
    await page.locator('input[type="file"]').first().setInputFiles(fixture('photo.png'));
    await expect(page.locator('.viewer-canvas img')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Rotate left' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Flip horizontally' })).toBeVisible();
  });

  test('theme applies', async ({ page }) => {
    await openViewer(page, { theme: 'dark' });
    const background = await page.locator('.pv-toolbar').evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(background).toBe('rgb(38, 43, 53)');
  });

  test('starting zoom applies', async ({ page }) => {
    await openViewer(page, { initialZoom: 1 });
    await expect.poll(async () => Math.round((await page.locator('.pv-page[data-page="1"]').boundingBox())!.width)).toBe(612);
  });

  test('the side panel can start open', async ({ page }) => {
    await openViewer(page, { sidebarOpen: true });
    await expect(page.locator('.pv-sidebar')).toBeVisible();
  });

  test('server rendering can be chosen', async ({ page, request }) => {
    const up = await request.get('http://localhost:8080/swagger/index.html').then((response) => response.ok()).catch(() => false);
    test.skip(!up, 'needs the PDF service at localhost:8080');
    let serverPages = 0;
    page.on('request', (item) => {
      if (/\/viewer\/documents\/[0-9a-f]+\/pages\/\d+\?dpi=/.test(item.url())) serverPages++;
    });
    await openViewer(page, { mode: 'server' });
    expect(serverPages).toBeGreaterThan(0);
  });
});

test.describe('editing', () => {
  test('annotations can be turned off', async ({ page }) => {
    await openViewer(page, { annotations: false, sidebarOpen: true });
    await expect(page.getByRole('button', { name: 'Draw', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Document tools' })).toHaveCount(1);
  });

  test('form filling can be turned off', async ({ page }) => {
    await openViewer(page, {}, 'form.pdf');
    await expect(page.locator('[data-field]').first()).toBeAttached();

    await openViewer(page, { formFilling: false }, 'form.pdf');
    await page.waitForTimeout(300);
    await expect(page.locator('[data-field]')).toHaveCount(0);
  });

  test('document tools can be turned off', async ({ page }) => {
    await openViewer(page, { sidebarOpen: true });
    await expect(page.getByRole('button', { name: 'Document tools' })).toHaveCount(1);

    await openViewer(page, { documentTools: false, sidebarOpen: true });
    await expect(page.getByRole('button', { name: 'Document tools' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Draw', exact: true })).toHaveCount(1);
  });
});

test.describe('settings screen', () => {
  const setting = (page: Page, key: string) => page.locator(`[data-setting="${key}"]`);
  const openPanel = async (page: Page) => {
    await openList(page);
    await page.locator('summary', { hasText: 'Settings' }).click();
    await expect(setting(page, 'clickAction')).toBeVisible();
  };

  test('shows the current value of every setting', async ({ page }) => {
    await openPanel(page);
    await expect(setting(page, 'clickAction')).toHaveValue('open');
    await expect(setting(page, 'allowRename')).not.toBeChecked();
    await expect(setting(page, 'modalResizable')).toBeChecked();
    expect(await page.locator('[data-setting]').count()).toBe(29);
  });

  test('choosing the single click action takes effect immediately', async ({ page }) => {
    await openPanel(page);
    await setting(page, 'clickAction').selectOption('menu');
    await row(page, 'report').click();
    await expect(menu(page)).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);
  });

  test('appearance follows the system and remembers an explicit theme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await openPanel(page);
    const panel = page.locator('.ps-panel');
    await expect(page.getByRole('region', { name: 'Appearance' })).toBeVisible();
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(panel).toHaveCSS('background-color', 'rgb(38, 43, 53)');
    await setting(page, 'theme').selectOption('light');
    await expect(panel).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await page.reload();
    await page.locator('summary', { hasText: 'Settings' }).click();
    await expect(setting(page, 'theme')).toHaveValue('light');
    await expect(panel).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(panel).toHaveCSS('transition-duration', '0s');
    await page.getByRole('button', { name: 'Reset to defaults' }).click();
    await expect(setting(page, 'theme')).toHaveValue('auto');
    await expect(panel).toHaveCSS('background-color', 'rgb(38, 43, 53)');
  });

  test('a switch takes effect the next time a file opens', async ({ page }) => {
    await openPanel(page);
    await setting(page, 'allowRename').check();
    await row(page, 'report').click();
    await expect(firstPage(page)).toBeVisible();
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    await expect(page.getByRole('textbox', { name: /File name/ })).toHaveValue('Annual report');
  });

  test('a number choice keeps working as a number', async ({ page }) => {
    await openPanel(page);
    await setting(page, 'initialZoom').selectOption('1');
    await row(page, 'report').click();
    await expect.poll(async () => Math.round((await page.locator('.pv-page[data-page="1"]').boundingBox())!.width)).toBe(612);
  });

  test('choices are remembered after a reload', async ({ page }) => {
    await openPanel(page);
    await setting(page, 'clickAction').selectOption('menu');
    await setting(page, 'showFileDetails').uncheck();
    await page.goto('/');
    await expect(row(page, 'report')).toBeVisible();
    await expect(page.locator('.pl-meta')).toHaveCount(0);
    await row(page, 'report').click();
    await expect(menu(page)).toBeVisible();
  });

  test('reset puts everything back', async ({ page }) => {
    await openPanel(page);
    await setting(page, 'clickAction').selectOption('menu');
    await setting(page, 'allowRename').check();
    await page.getByRole('button', { name: 'Reset to defaults' }).click();
    await expect(setting(page, 'clickAction')).toHaveValue('open');
    await expect(setting(page, 'allowRename')).not.toBeChecked();
    await row(page, 'report').click();
    await expect(dialog(page)).toBeVisible();
  });

  test('stays readable on a dark system, with on/off settings shown as switches', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openPanel(page);
    await expect(page.locator('.ps-panel')).toHaveCSS('background-color', 'rgb(38, 43, 53)');
    await expect(page.getByRole('button', { name: 'Reset to defaults' })).toHaveCSS('color', 'rgb(231, 234, 240)');
    await expect(page.locator('legend', { hasText: 'File list' })).toHaveCSS('color', 'rgb(231, 234, 240)');
    await expect(page.getByRole('switch', { name: 'Can be resized' })).toBeChecked();
    const pageBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(pageBackground).not.toBe('rgb(255, 255, 255)');
  });

  test('asking for a file name is turned off while downloads are off', async ({ page }) => {
    await openPanel(page);
    await setting(page, 'allowRename').check();
    await setting(page, 'allowDownload').uncheck();
    await expect(setting(page, 'allowRename')).toBeDisabled();

    await setting(page, 'allowDownload').check();
    await expect(setting(page, 'allowRename')).toBeEnabled();
    await expect(setting(page, 'allowRename')).toBeChecked();
  });

  test('settings changed in code show on the screen', async ({ page }) => {
    await openPanel(page);
    await page.evaluate(() => (window as never as { configureViewer(value: object): void }).configureViewer({ clickAction: 'none' }));
    await expect(setting(page, 'clickAction')).toHaveValue('none');
  });
});

test.describe('watermark', () => {
  const ON = { watermark: true, watermarkText: 'CONFIDENTIAL' };
  const marks = (page: Page) => page.locator('.pv-watermark text');
  const countOf = (text: string, word: string) => text.split(word).length - 1;

  test('is off by default, on screen and in the file', async ({ page }) => {
    await openViewer(page, {});
    await expect(marks(page)).toHaveCount(0);
    expect(await (await exportedPdf(page)).text(1)).not.toContain('DRAFT');
  });

  test('shows on every page and goes into the exported file', async ({ page }) => {
    await openViewer(page, ON);
    const pages = await page.locator('.pv-page').count();
    await expect(marks(page)).toHaveCount(pages);
    await expect(marks(page).first()).toHaveText('CONFIDENTIAL');
    const saved = await exportedPdf(page);
    for (let number = 1; number <= saved.pageCount; number++) expect(countOf(await saved.text(number), 'CONFIDENTIAL')).toBe(1);
  });

  test('can have several lines, on screen and in the file', async ({ page }) => {
    await openViewer(page, { watermark: true, watermarkText: 'CONFIDENTIAL\n\n  Acme Ltd  \n' });
    await expect(marks(page).first().locator('tspan')).toHaveText(['CONFIDENTIAL', 'Acme Ltd']);
    const text = await (await exportedPdf(page)).text(1);
    expect(countOf(text, 'CONFIDENTIAL')).toBe(1);
    expect(countOf(text, 'Acme Ltd')).toBe(1);
  });

  test('several lines also work on rotated pages and with other alphabets', async ({ page }) => {
    await openViewer(page, { watermark: true, watermarkText: 'First line\nSecond line' }, 'rotated.pdf');
    const rotated = await (await exportedPdf(page)).text(1);
    expect(rotated).toContain('First line');
    expect(rotated).toContain('Second line');

    await openViewer(page, { watermark: true, watermarkText: 'नमस्ते\n你好' });
    expect((await exportedPdf(page)).pageCount).toBeGreaterThan(0);
  });

  test('does nothing with blank text', async ({ page }) => {
    await openViewer(page, { watermark: true, watermarkText: '   ' });
    await expect(marks(page)).toHaveCount(0);
  });

  test('is drawn as text, not markup', async ({ page }) => {
    await openViewer(page, { watermark: true, watermarkText: '<img src=x onerror=alert(1)>' });
    await expect(marks(page).first()).toHaveText('<img src=x onerror=alert(1)>');
    await expect(page.locator('.pv-watermark img')).toHaveCount(0);
  });

  test('does not get in the way of the mouse', async ({ page }) => {
    await openViewer(page, { ...ON, initialZoom: 'fit-page' });
    await expect(page.locator('.pv-watermark').first()).toHaveCSS('pointer-events', 'none');
    await page.getByRole('button', { name: 'Draw a rectangle' }).click();
    const area = (await page.locator('.pv-page[data-page="1"]').boundingBox())!;
    await page.mouse.move(area.x + area.width / 2 - 60, area.y + area.height / 2 - 60);
    await page.mouse.down();
    await page.mouse.move(area.x + area.width / 2 + 60, area.y + area.height / 2 + 60, { steps: 4 });
    await page.mouse.up();
    await expect(page.locator('[data-kind="rect"]')).toHaveCount(1);
  });

  test('works on rotated pages and with other alphabets', async ({ page }) => {
    await openViewer(page, ON, 'rotated.pdf');
    expect(await (await exportedPdf(page)).text(1)).toContain('CONFIDENTIAL');

    await openViewer(page, { watermark: true, watermarkText: 'नमस्ते 你好' });
    expect((await exportedPdf(page)).pageCount).toBeGreaterThan(0);
  });

  test('having one does not count as an unsaved change', async ({ page }) => {
    await openList(page, ON);
    await row(page, 'report').click();
    await expect(firstPage(page)).toBeVisible();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog(page)).toHaveCount(0);
  });

  test('shows on images and goes into what they export', async ({ page }) => {
    await page.goto(viewerUrl(ON));
    await page.waitForFunction(() => Boolean((window as never as { pdfViewer?: unknown }).pdfViewer));
    await page.locator('input[type="file"]').first().setInputFiles(fixture('photo.png'));
    await expect(page.locator('.viewer-canvas img')).toBeVisible();
    await expect(marks(page)).toHaveCount(1);
    const name = await page.evaluate(async () => (await (window as never as { pdfViewer: { getImageFile(): Promise<{ name: string }> } }).pdfViewer.getImageFile()).name);
    expect(name).toMatch(/\.png$/);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download', exact: true }).click()]);
    expect(download.suggestedFilename()).toMatch(/\.png$/);
  });

  test.describe('with the API', () => {
    test.beforeEach(async () => {
      test.skip(!(await isServiceUp()), 'needs the PDF service at localhost:8080');
    });

    const openTool = async (page: Page, name: string) => {
      await page.getByRole('button', { name: 'Toggle side panel' }).click();
      await page.getByRole('button', { name: 'Document tools' }).click();
      await page.locator('details[data-tool]', { has: page.locator(`summary:text-is("${name}")`) }).locator('summary').click();
      return page.locator('details[open]', { has: page.locator(`summary:text-is("${name}")`) });
    };

    test('does not stack up when a tool changes the document', async ({ page }) => {
      await openViewer(page, ON);
      const tool = await openTool(page, 'Compress');
      await tool.getByRole('button', { name: /compress/i }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Compress: done' })).toBeVisible({ timeout: 30_000 });
      await expect(marks(page).first()).toBeVisible();
      expect(countOf(await (await exportedPdf(page)).text(1), 'CONFIDENTIAL')).toBe(1);
    });

    test('the watermark tool starts with the same text', async ({ page }) => {
      await openViewer(page, ON);
      const tool = await openTool(page, 'Watermark');
      await expect(tool.locator('[name="text"]')).toHaveValue('CONFIDENTIAL');
    });

    test('the watermark tool joins several lines, as its box only has one', async ({ page }) => {
      await openViewer(page, { watermark: true, watermarkText: 'First\nSecond' });
      const tool = await openTool(page, 'Watermark');
      await expect(tool.locator('[name="text"]')).toHaveValue('First Second');
    });

    test('a Word file downloads as a PDF, so that it can carry the watermark', async ({ page }) => {
      await openViewer(page, ON, 'note.docx');
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download', exact: true }).click()]);
      expect(download.suggestedFilename()).toBe('note.pdf');
    });
  });

  test('can be set from the settings screen', async ({ page }) => {
    await openList(page);
    await page.locator('summary', { hasText: 'Settings' }).click();
    const text = page.locator('[data-setting="watermarkText"]');
    await expect(text).toBeDisabled();
    await page.locator('[data-setting="watermark"]').check();
    await expect(text).toBeEnabled();
    await expect(page.locator('textarea[data-setting="watermarkText"]')).toHaveCount(1);
    await text.fill('For');
    await text.press('Enter');
    await text.pressSequentially('review');
    await expect(text).toHaveValue('For\nreview');
    await page.locator('[data-setting="watermarkOpacity"]').selectOption('0.35');

    await row(page, 'report').click();
    await expect(firstPage(page)).toBeVisible();
    await expect(marks(page).first().locator('tspan')).toHaveText(['For', 'review']);
    await expect(marks(page).first()).toHaveAttribute('fill-opacity', '0.35');
  });
});

test.describe('saving settings on the server', () => {
  const usedScopes: string[] = [];
  const newScope = () => {
    const scope = `test-${randomUUID()}`;
    usedScopes.push(scope);
    return scope;
  };

  test.afterEach(async ({ request }) => {
    for (const scope of usedScopes.splice(0)) await request.delete(`http://localhost:8080/api/settings/${scope}`).catch(() => undefined);
  });

  const setting = (page: Page, key: string) => page.locator(`[data-setting="${key}"]`);
  const status = (page: Page) => page.locator('.ps-status');
  const urlFor = (scope: string) => `/?save=server&scope=${scope}`;

  const openPanel = async (page: Page, scope: string) => {
    await page.goto(urlFor(scope));
    await expect(row(page, 'report')).toBeVisible();
    await page.locator('summary', { hasText: 'Settings' }).click();
    await expect(setting(page, 'clickAction')).toBeVisible();
  };

  test.describe('with the API', () => {
    test.beforeEach(async () => {
      test.skip(!(await isServiceUp()), 'needs the PDF service at localhost:8080');
    });

    test('choices reach another browser', async ({ page, browser, baseURL }) => {
      const scope = newScope();
      await openPanel(page, scope);
      await setting(page, 'clickAction').selectOption('menu');
      await setting(page, 'watermark').check();
      await setting(page, 'watermarkText').fill('Shared');
      await expect(status(page)).toHaveText('Saved');

      const other = await browser.newContext({ baseURL });
      const otherPage = await other.newPage();
      await openPanel(otherPage, scope);
      await expect(setting(otherPage, 'clickAction')).toHaveValue('menu');
      await expect(setting(otherPage, 'watermarkText')).toHaveValue('Shared');
      await row(otherPage, 'report').click();
      await expect(menu(otherPage)).toBeVisible();
      await other.close();
    });

    test('scopes stay separate', async ({ page }) => {
      const first = newScope();
      await openPanel(page, first);
      await setting(page, 'clickAction').selectOption('none');
      await expect(status(page)).toHaveText('Saved');
      await openPanel(page, newScope());
      await expect(setting(page, 'clickAction')).toHaveValue('open');
    });

    test('reset clears them on the server too', async ({ page }) => {
      const scope = newScope();
      await openPanel(page, scope);
      await setting(page, 'clickAction').selectOption('menu');
      await expect(status(page)).toHaveText('Saved');
      await page.getByRole('button', { name: 'Reset to defaults' }).click();
      await expect(setting(page, 'clickAction')).toHaveValue('open');
      await page.waitForTimeout(800);
      await page.reload();
      await page.locator('summary', { hasText: 'Settings' }).click();
      await expect(setting(page, 'clickAction')).toHaveValue('open');
    });

    test('only saves what differs from the defaults', async ({ page, request }) => {
      const scope = newScope();
      await openPanel(page, scope);
      await setting(page, 'allowRename').check();
      await expect(status(page)).toHaveText('Saved');
      expect(await (await request.get(`http://localhost:8080/api/settings/${scope}`)).json()).toEqual({ allowRename: true });
    });

    test('a slow load does not undo a change made in the meantime', async ({ page }) => {
      const scope = newScope();
      await page.route(`**/api/settings/${scope}`, async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        await new Promise((resolve) => setTimeout(resolve, 800));
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"clickAction":"none"}' });
      });
      await openPanel(page, scope);
      await setting(page, 'clickAction').selectOption('menu');
      await page.waitForTimeout(1200);
      await expect(setting(page, 'clickAction')).toHaveValue('menu');
    });
  });

  test.describe('from code', () => {
    const API = 'http://localhost:8080';
    type Store = { serviceUrl: string; scope?: string };
    type Api = {
      loadViewerSettings(options: Store): Promise<{ clickAction: string }>;
      saveViewerSettings(options: Store, settings?: object): Promise<void>;
      resetViewerSettings(): void;
      configureViewer(settings: object): void;
    };
    const load = (page: Page, scope: string, serviceUrl = API) =>
      page.evaluate(([url, name]) => (window as never as Api).loadViewerSettings({ serviceUrl: url, scope: name }).then((settings) => settings.clickAction, (error: Error) => `failed: ${error.message}`), [serviceUrl, scope]);

    test.describe('with the API', () => {
      test.beforeEach(async () => {
        test.skip(!(await isServiceUp()), 'needs the PDF service at localhost:8080');
      });

      test('a script saves settings, and an app that loads them uses them', async ({ page, request }) => {
        const scope = newScope();
        const saved = await request.put(`${API}/api/settings/${scope}`, { data: { clickAction: 'menu', toolbarPosition: 'left', watermark: true, watermarkText: 'CONFIDENTIAL' } });
        expect(saved.status()).toBe(204);
        expect(await (await request.get(`${API}/api/settings/${scope}`)).json()).toEqual({ clickAction: 'menu', toolbarPosition: 'left', watermark: true, watermarkText: 'CONFIDENTIAL' });

        await openList(page);
        expect(await load(page, scope)).toBe('menu');
        await row(page, 'report').click();
        await expect(menu(page)).toBeVisible();
        await menu(page).getByRole('menuitem', { name: 'Open' }).click();
        await expect(firstPage(page)).toBeVisible();
        await expect(page.locator('.pv-root')).toHaveAttribute('data-toolbar-position', 'left');
        await expect(page.locator('.pv-watermark text').first()).toHaveText('CONFIDENTIAL');
      });

      test('a later load adjusts an earlier one, and keeps what it does not mention', async ({ page, request }) => {
        const team = newScope();
        const user = newScope();
        await request.put(`${API}/api/settings/${team}`, { data: { clickAction: 'menu', showFileDetails: false } });
        await request.put(`${API}/api/settings/${user}`, { data: { showFileDetails: true } });

        await openList(page);
        await load(page, team);
        await expect(page.locator('.pl-meta')).toHaveCount(0);
        await load(page, user);
        await expect(page.locator('.pl-meta').first()).toBeVisible();
        await row(page, 'report').click();
        await expect(menu(page)).toBeVisible();
      });

      test('a scope with nothing saved changes nothing', async ({ page }) => {
        await openList(page, { clickAction: 'none' });
        expect(await load(page, newScope())).toBe('none');
      });

      test('resetting first means settings deleted on the server go away', async ({ page, request }) => {
        const scope = newScope();
        await request.put(`${API}/api/settings/${scope}`, { data: { clickAction: 'menu' } });
        await openList(page);
        expect(await load(page, scope)).toBe('menu');

        await request.delete(`${API}/api/settings/${scope}`);
        expect(await load(page, scope)).toBe('menu');
        await page.evaluate(() => (window as never as Api).resetViewerSettings());
        expect(await load(page, scope)).toBe('open');
      });

      test('saving from code stores what differs from the defaults, or what it is given', async ({ page, request }) => {
        const scope = newScope();
        await openList(page);
        await page.evaluate(([url, name]) => {
          const api = window as never as Api;
          api.configureViewer({ allowRename: true });
          return api.saveViewerSettings({ serviceUrl: url, scope: name });
        }, [API, scope]);
        expect(await (await request.get(`${API}/api/settings/${scope}`)).json()).toEqual({ allowRename: true });

        await page.evaluate(([url, name]) => (window as never as Api).saveViewerSettings({ serviceUrl: url, scope: name }, { theme: 'dark' }), [API, scope]);
        expect(await (await request.get(`${API}/api/settings/${scope}`)).json()).toEqual({ theme: 'dark' });
      });

      test('a scope in the wrong format is explained', async ({ page }) => {
        await openList(page);
        expect(await load(page, 'not valid!')).toContain('A scope can only contain');
      });

      test('a component setting wins over a loaded one', async ({ page, request }) => {
        const scope = newScope();
        await request.put(`${API}/api/settings/${scope}`, { data: { allowPrint: false } });
        await page.goto(viewerUrl({ allowPrint: true }));
        await page.waitForFunction(() => Boolean((window as never as { pdfViewer?: unknown }).pdfViewer));
        await load(page, scope);
        await page.locator('input[type="file"]').first().setInputFiles(fixture('report.pdf'));
        await expect(firstPage(page)).toBeVisible();
        await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeVisible();
      });
    });

    test('if the API cannot be reached, the app carries on with its settings', async ({ page }) => {
      await openList(page, { clickAction: 'menu' });
      expect(await load(page, 'any', 'http://localhost:9')).toContain("failed: Couldn't reach the PDF service");
      await row(page, 'report').click();
      await expect(menu(page)).toBeVisible();
    });
  });

  test('a failed save says so, and the choice still applies', async ({ page }) => {
    await page.route('**/api/settings/**', (route) => (route.request().method() === 'GET' ? route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }) : route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"Saving settings is turned off."}' })));
    await openPanel(page, 'unsaved');
    await setting(page, 'clickAction').selectOption('menu');
    await expect(status(page)).toContainText("Couldn't save. Saving settings is turned off.");
    await row(page, 'report').click();
    await expect(menu(page)).toBeVisible();
  });

  test('a failed load says so, and the page still works', async ({ page }) => {
    await page.route('**/api/settings/**', (route) => route.abort());
    await openPanel(page, 'offline');
    await expect(status(page)).toContainText("Couldn't load the saved settings.");
    await row(page, 'report').click();
    await expect(dialog(page)).toBeVisible();
  });

  test('saved values that make no sense are ignored', async ({ page }) => {
    await page.route('**/api/settings/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"clickAction":"explode","allowRename":"yes","unknown":1,"__proto__":{"polluted":true},"showFileDetails":false}' }));
    await openPanel(page, 'junk');
    await expect(page.locator('.pl-meta')).toHaveCount(0);
    await expect(setting(page, 'clickAction')).toHaveValue('open');
    await expect(setting(page, 'allowRename')).not.toBeChecked();
    expect(await page.evaluate(() => ({} as Record<string, unknown>).polluted)).toBeUndefined();
  });

  test('without ?save=server, nothing is sent', async ({ page }) => {
    const calls: string[] = [];
    page.on('request', (item) => {
      if (item.url().includes('/api/settings')) calls.push(item.url());
    });
    await openList(page);
    await page.locator('summary', { hasText: 'Settings' }).click();
    await setting(page, 'clickAction').selectOption('menu');
    await page.waitForTimeout(700);
    expect(calls).toEqual([]);
  });
});

test.describe('bar positions', () => {
  type Box = { x: number; y: number; width: number; height: number };
  const SIDES = ['top', 'bottom', 'left', 'right'] as const;

  const isOnSide = (side: (typeof SIDES)[number], bar: Box, content: Box) => {
    if (side === 'top') return bar.y + bar.height <= content.y + 1;
    if (side === 'bottom') return bar.y >= content.y + content.height - 1;
    if (side === 'left') return bar.x + bar.width <= content.x + 1;
    return bar.x >= content.x + content.width - 1;
  };

  const open = async (page: Page, settings: object) => {
    await openList(page, settings);
    await row(page, 'report').click();
    await expect(firstPage(page)).toBeVisible();
  };

  for (const side of SIDES) {
    test(`the toolbar can go on the ${side}, with everything still in reach`, async ({ page }) => {
      await open(page, { toolbarPosition: side });
      const toolbar = page.getByRole('toolbar', { name: 'Document tools' });
      const scroll = (await page.locator('.pv-scroll').boundingBox())!;
      expect(isOnSide(side, (await toolbar.boundingBox())!, scroll)).toBe(true);
      expect(scroll.width).toBeGreaterThan(300);
      expect(scroll.height).toBeGreaterThan(300);

      const frame = (await dialog(page).boundingBox())!;
      const close = (await page.getByRole('button', { name: 'Close', exact: true }).boundingBox())!;
      expect(close.y).toBeGreaterThanOrEqual(frame.y);

      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download', exact: true }).click()]);
      expect(download.suggestedFilename()).toBe('Annual report.pdf');
    });

    test(`with the toolbar on the ${side}, the title bar stays at the top`, async ({ page }) => {
      await open(page, { toolbarPosition: side });
      const header = (await page.locator('.pm-header').boundingBox())!;
      const viewer = (await page.locator('.pm-viewer').boundingBox())!;
      expect(isOnSide('top', header, viewer)).toBe(true);
    });
  }

  test('a side toolbar fits a normal window without scrolling', async ({ page }) => {
    await open(page, { toolbarPosition: 'left' });
    const fits = await page.getByRole('toolbar', { name: 'Document tools' }).evaluate((element) => element.scrollHeight <= element.clientHeight && element.scrollWidth <= element.clientWidth);
    expect(fits).toBe(true);
    await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeInViewport();
    await expect(page.locator('.pv-toolbar .pv-group:empty')).toBeHidden();
  });

  for (const side of ['left', 'right'] as const) {
    test(`a toolbar on the ${side} keeps related controls together`, async ({ page }) => {
      await open(page, { toolbarPosition: side });
      const box = async (label: string) => (await page.getByLabel(label, { exact: true }).boundingBox())!;
      const sameRow = async (first: string, second: string) => {
        const [a, b] = [await box(first), await box(second)];
        expect(Math.abs(a.y + a.height / 2 - (b.y + b.height / 2))).toBeLessThan(2);
        expect(a.x).toBeLessThan(b.x);
      };
      await sameRow('Previous page', 'Next page');
      await sameRow('Zoom out', 'Zoom in');
      await sameRow('Undo', 'Redo');

      const input = await box('Page number');
      const total = (await page.locator('.pv-page-total').boundingBox())!;
      expect(Math.abs(input.y + input.height / 2 - (total.y + total.height / 2))).toBeLessThan(2);
      expect(total.x).toBeGreaterThan(input.x + input.width - 1);
      expect((await box('Zoom level')).y).toBeGreaterThan((await box('Zoom in')).y);

      const toolbar = page.getByRole('toolbar', { name: 'Document tools' });
      const area = (await toolbar.boundingBox())!;
      expect(total.x + total.width).toBeLessThanOrEqual(area.x + area.width);
      expect(await toolbar.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    });
  }

  test('a side toolbar can reach everything in a short window', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 420 });
    await open(page, { toolbarPosition: 'right' });
    const download = page.getByRole('button', { name: 'Download', exact: true });
    await download.scrollIntoViewIfNeeded();
    await expect(download).toBeInViewport();
  });

  test('the search bar still opens with a side toolbar', async ({ page }) => {
    await open(page, { toolbarPosition: 'left' });
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByLabel('Find in document')).toBeVisible();
    const toolbar = (await page.getByRole('toolbar', { name: 'Document tools' }).boundingBox())!;
    const search = (await page.getByLabel('Find in document').boundingBox())!;
    expect(search.x).toBeGreaterThanOrEqual(toolbar.x + toolbar.width);
  });

  test('the position comes from settings, and dragging a bar does not change it', async ({ page }) => {
    await open(page, { toolbarPosition: 'left' });
    const toolbar = page.getByRole('toolbar', { name: 'Document tools' });
    const before = (await toolbar.boundingBox())!;
    await page.mouse.move(before.x + before.width / 2, before.y + before.height * 0.75);
    await page.mouse.down();
    await page.mouse.move(before.x + 600, before.y + 200, { steps: 5 });
    await page.mouse.up();
    expect(await toolbar.boundingBox()).toEqual(before);
    await expect(page.locator('.pv-root')).toHaveAttribute('data-toolbar-position', 'left');
    await expect(page.locator('.pv-toolbar [draggable="true"], .pm-header [draggable="true"]')).toHaveCount(0);

    const windowBefore = (await dialog(page).boundingBox())!;
    const title = (await page.locator('.pm-title').boundingBox())!;
    await page.mouse.move(title.x + 10, title.y + 8);
    await page.mouse.down();
    await page.mouse.move(title.x + 90, title.y + 58, { steps: 4 });
    await page.mouse.up();
    await expect(page.locator('.pv-root')).toHaveAttribute('data-toolbar-position', 'left');
    expect(Math.round((await dialog(page).boundingBox())!.x - windowBefore.x)).toBe(80);
  });

  for (const side of SIDES) {
    test(`the toolbar can go on the ${side} for images too`, async ({ page }) => {
      await openList(page, { toolbarPosition: side });
      await row(page, 'photo').click();
      await expect(page.locator('.viewer-canvas img')).toBeVisible();
      const toolbar = page.getByRole('toolbar', { name: 'Document tools' });
      const body = (await page.locator('.pv-body').boundingBox())!;
      expect(isOnSide(side, (await toolbar.boundingBox())!, body)).toBe(true);
      await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeInViewport();
      await expect(page.getByRole('button', { name: 'Rotate left' })).toBeInViewport();
    });
  }

  test('a title bar position saved earlier is ignored', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('document-suite-demo-settings', JSON.stringify({ modalHeaderPosition: 'left', toolbarPosition: 'left' })));
    await openList(page);
    await row(page, 'report').click();
    await expect(firstPage(page)).toBeVisible();
    await expect(page.locator('.pv-root')).toHaveAttribute('data-toolbar-position', 'left');
    const header = (await page.locator('.pm-header').boundingBox())!;
    expect(isOnSide('top', header, (await page.locator('.pm-viewer').boundingBox())!)).toBe(true);
  });

  test('can be chosen on the settings screen', async ({ page }) => {
    await openList(page);
    await page.locator('summary', { hasText: 'Settings' }).click();
    await page.locator('[data-setting="toolbarPosition"]').selectOption('right');
    await row(page, 'report').click();
    await expect(firstPage(page)).toBeVisible();
    await expect(page.locator('.pv-root')).toHaveAttribute('data-toolbar-position', 'right');
  });
});
