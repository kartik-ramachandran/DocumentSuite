import { expect, test, type Page } from '@playwright/test';
import { demoUrl, fixture } from './helpers';

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
  await expect(firstPage(page)).toBeVisible();
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
    expect(await page.locator('[data-setting]').count()).toBe(25);
  });

  test('choosing the single click action takes effect immediately', async ({ page }) => {
    await openPanel(page);
    await setting(page, 'clickAction').selectOption('menu');
    await row(page, 'report').click();
    await expect(menu(page)).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);
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

  test('settings changed in code show on the screen', async ({ page }) => {
    await openPanel(page);
    await page.evaluate(() => (window as never as { configureViewer(value: object): void }).configureViewer({ clickAction: 'none' }));
    await expect(setting(page, 'clickAction')).toHaveValue('none');
  });
});
