import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fixture } from './helpers';

const dialog = (page: Page) => page.locator('dialog');
const row = (page: Page, id: string) => page.locator(`li[data-file="${id}"]`);
const menu = (page: Page) => page.getByRole('menu');
const box = async (page: Page) => (await dialog(page).boundingBox())!;

async function openList(page: Page, query = ''): Promise<void> {
  await page.goto(`/${query}`);
  await expect(row(page, 'report')).toBeVisible();
}

async function openReport(page: Page): Promise<void> {
  await row(page, 'report').click();
  await expect(dialog(page)).toBeVisible();
  await expect(page.locator('.pv-page[data-page="1"] canvas.pv-canvas')).toBeVisible();
}

/** Drags part of the modal by an amount, using its edge or corner name. */
async function dragHandle(page: Page, edge: string, dx: number, dy: number): Promise<void> {
  const handle = (await page.locator(`.pm-handle[data-edge="${edge}"]`).boundingBox())!;
  const x = handle.x + handle.width / 2;
  const y = handle.y + handle.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 5 });
  await page.mouse.up();
}

async function addAnnotation(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Draw a rectangle' }).click();
  const area = (await page.locator('.pv-page[data-page="1"]').boundingBox())!;
  await page.mouse.move(area.x + 60, area.y + 60);
  await page.mouse.down();
  await page.mouse.move(area.x + 160, area.y + 140, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('[data-kind="rect"]')).toHaveCount(1);
}

test.describe('file list', () => {
  test.beforeEach(async ({ page }) => openList(page));

  test('shows each file with its type and size', async ({ page }) => {
    await expect(page.locator('li[data-file]')).toHaveCount(5);
    await expect(row(page, 'report')).toContainText('Annual report.pdf');
    await expect(row(page, 'report').locator('.pl-badge')).toHaveText('pdf');
    await expect(row(page, 'report').locator('.pl-meta')).toContainText('KB');
  });

  test('clicking a file opens it in the modal', async ({ page }) => {
    await expect(dialog(page)).toHaveCount(0);
    await openReport(page);
    await expect(page.locator('.pm-title')).toHaveText('Annual report.pdf');
    await expect(page.locator('.pv-page')).toHaveCount(4);
  });

  test('an image opens in the image viewer inside the modal', async ({ page }) => {
    await row(page, 'photo').click();
    await expect(dialog(page)).toBeVisible();
    await expect(page.locator('.viewer-canvas img')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Flip horizontally' })).toBeVisible();
  });

  test('a text file opens through the API', async ({ page }) => {
    await row(page, 'notes').click();
    await expect(page.locator('.pv-page[data-page="1"] canvas.pv-canvas')).toBeVisible({ timeout: 20_000 });
  });

  test('files can be added and opened', async ({ page }) => {
    await page.getByLabel('Add files').setInputFiles(fixture('rotated.pdf'));
    await expect(page.locator('li[data-file]')).toHaveCount(6);
    await page.locator('li[data-file^="rotated.pdf"]').click();
    await expect(page.locator('.pm-title')).toHaveText('rotated.pdf');
    await expect(page.locator('.pv-page')).toHaveCount(1);
  });

  test('works from the keyboard', async ({ page }) => {
    await row(page, 'report').focus();
    await page.keyboard.press('ArrowDown');
    await expect(row(page, 'form')).toBeFocused();
    await page.keyboard.press('End');
    await expect(row(page, 'notes')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(row(page, 'report')).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(dialog(page)).toBeVisible();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(row(page, 'report')).toBeFocused();

    await page.keyboard.press('Shift+F10');
    await expect(menu(page)).toBeVisible();
  });
});

test.describe('context menu', () => {
  test.beforeEach(async ({ page }) => openList(page));

  test('right-clicking shows the menu at the pointer without opening the file', async ({ page }) => {
    const target = (await row(page, 'report').boundingBox())!;
    const point = { x: target.x + 120, y: target.y + target.height / 2 };
    await row(page, 'report').click({ button: 'right', position: { x: 120, y: target.height / 2 } });

    await expect(menu(page)).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);
    const position = (await menu(page).boundingBox())!;
    expect(Math.abs(position.x - point.x)).toBeLessThan(3);
    expect(Math.abs(position.y - point.y)).toBeLessThan(3);
    await expect(menu(page).getByRole('menuitem')).toHaveText(['Open', 'Download', 'Remove from list']);
  });

  test('Open opens the file in the modal', async ({ page }) => {
    await row(page, 'form').click({ button: 'right' });
    await menu(page).getByRole('menuitem', { name: 'Open' }).click();
    await expect(menu(page)).toHaveCount(0);
    await expect(page.locator('.pm-title')).toHaveText('Application form.pdf');
    await expect(page.locator('.pv-page')).toHaveCount(1);
  });

  test('Download saves the original file', async ({ page }) => {
    await row(page, 'photo').click({ button: 'right' });
    const [download] = await Promise.all([page.waitForEvent('download'), menu(page).getByRole('menuitem', { name: 'Download' }).click()]);
    expect(download.suggestedFilename()).toBe('Site photo.png');
    expect(readFileSync(await download.path()).subarray(1, 4).toString()).toBe('PNG');
    await expect(dialog(page)).toHaveCount(0);
  });

  test('custom actions run with the right file', async ({ page }) => {
    await row(page, 'form').click({ button: 'right' });
    await menu(page).getByRole('menuitem', { name: 'Remove from list' }).click();
    await expect(row(page, 'form')).toHaveCount(0);
    await expect(page.locator('li[data-file]')).toHaveCount(4);
  });

  test('closes with Esc, or a click elsewhere, and only one is open at a time', async ({ page }) => {
    await row(page, 'report').click({ button: 'right' });
    await page.keyboard.press('Escape');
    await expect(menu(page)).toHaveCount(0);

    await row(page, 'report').click({ button: 'right' });
    await page.locator('h1').click();
    await expect(menu(page)).toHaveCount(0);

    await row(page, 'report').click({ button: 'right' });
    await row(page, 'form').click({ button: 'right' });
    await expect(menu(page)).toHaveCount(1);
    await expect(menu(page)).toHaveAttribute('aria-label', 'Actions for Application form.pdf');
  });

  test('works from the keyboard', async ({ page }) => {
    await row(page, 'report').click({ button: 'right' });
    await expect(menu(page).getByRole('menuitem', { name: 'Open' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu(page).getByRole('menuitem', { name: 'Download' })).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toBeVisible();
  });

  test('stays inside the window near its edge', async ({ page }) => {
    const first = (await row(page, 'report').boundingBox())!;
    const width = Math.ceil(first.x + first.width);
    const height = Math.ceil(first.y + first.height);
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(200); // the menu closes on window resize, so this lets that event pass
    const target = (await row(page, 'report').boundingBox())!;
    await page.mouse.click(target.x + target.width - 60, target.y + target.height - 4, { button: 'right' });
    await expect(menu(page)).toBeVisible();
    const position = (await menu(page).boundingBox())!;
    expect(position.x + position.width).toBeLessThanOrEqual(width);
    expect(position.y + position.height).toBeLessThanOrEqual(height);
  });

  test('the menu button on a row shows the same menu', async ({ page }) => {
    await row(page, 'report').hover();
    await page.getByRole('button', { name: 'More actions for Annual report.pdf' }).click();
    await expect(menu(page)).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);
  });

  test('a click can show the menu instead of opening, by option', async ({ page }) => {
    await openList(page, '?click=menu');
    await row(page, 'report').click();
    await expect(menu(page)).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);
  });
});

test.describe('modal resizing and moving', () => {
  test.beforeEach(async ({ page }) => {
    await openList(page);
    await openReport(page);
  });

  for (const [edge, dx, dy, grows] of [
    ['e', 60, 0, 'width'],
    ['w', -60, 0, 'width'],
    ['s', 0, 40, 'height'],
    ['n', 0, -40, 'height'],
  ] as const) {
    test(`resizes from the ${edge} edge`, async ({ page }) => {
      const before = await box(page);
      await dragHandle(page, edge, dx, dy);
      const after = await box(page);
      expect(Math.round(after[grows] - before[grows])).toBe(Math.abs(dx || dy));
      const opposite = grows === 'width' ? 'height' : 'width';
      expect(after[opposite]).toBe(before[opposite]);
      if (edge === 'e') expect(after.x).toBe(before.x);
      if (edge === 'w') expect(Math.round(after.x - before.x)).toBe(dx);
      if (edge === 's') expect(after.y).toBe(before.y);
      if (edge === 'n') expect(Math.round(after.y - before.y)).toBe(dy);
    });
  }

  for (const [edge, dx, dy] of [['se', 50, 30], ['sw', -50, 30], ['ne', 50, -30], ['nw', -50, -30]] as const) {
    test(`resizes from the ${edge} corner`, async ({ page }) => {
      const before = await box(page);
      await dragHandle(page, edge, dx, dy);
      const after = await box(page);
      expect(Math.round(after.width - before.width)).toBe(50);
      expect(Math.round(after.height - before.height)).toBe(30);
    });
  }

  test('the document refits as the modal is resized', async ({ page }) => {
    const pageBox = () => page.locator('.pv-page[data-page="1"]').boundingBox();
    const before = (await pageBox())!.width;
    await dragHandle(page, 'w', 60, 0);
    await expect.poll(async () => (await pageBox())!.width).toBeLessThan(before);
    await expect.poll(() => page.locator('.pv-page[data-page="1"] canvas.pv-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.getBoundingClientRect().width > 0)).toBe(true);
  });

  test('resizing keeps your place in the document', async ({ page }) => {
    await page.getByLabel('Page number').fill('3');
    await page.getByLabel('Page number').press('Enter');
    await expect(page.getByLabel('Page number')).toHaveValue('3');
    await dragHandle(page, 'e', 40, 0);
    await page.waitForTimeout(300);
    await expect(page.getByLabel('Page number')).toHaveValue('3');
  });

  test('cannot shrink below the minimum or grow past the window', async ({ page }) => {
    await dragHandle(page, 'se', -3000, -3000);
    let current = await box(page);
    expect(current.width).toBeCloseTo(360, 0);
    expect(current.height).toBeCloseTo(280, 0);

    await dragHandle(page, 'se', 5000, 5000);
    current = await box(page);
    const window = page.viewportSize()!;
    expect(current.x + current.width).toBeLessThanOrEqual(window.width + 1);
    expect(current.y + current.height).toBeLessThanOrEqual(window.height + 1);
  });

  test('moves by its title bar and stays reachable', async ({ page }) => {
    const before = await box(page);
    const title = (await page.locator('.pm-title').boundingBox())!;
    await page.mouse.move(title.x + 10, title.y + 8);
    await page.mouse.down();
    await page.mouse.move(title.x - 40, title.y + 38, { steps: 4 });
    await page.mouse.up();
    let after = await box(page);
    expect(Math.round(after.x - before.x)).toBe(-50);
    expect(Math.round(after.y - before.y)).toBe(30);

    const moved = (await page.locator('.pm-title').boundingBox())!;
    await page.mouse.move(moved.x + 10, moved.y + 8);
    await page.mouse.down();
    await page.mouse.move(moved.x + 10, -500, { steps: 3 });
    await page.mouse.up();
    after = await box(page);
    expect(after.y).toBeGreaterThanOrEqual(0);
  });

  test('maximizes and restores', async ({ page }) => {
    const before = await box(page);
    await page.getByRole('button', { name: 'Maximize' }).click();
    const window = page.viewportSize()!;
    await expect.poll(async () => (await box(page)).width).toBe(window.width);
    expect((await box(page)).height).toBe(window.height);
    await expect(page.locator('.pm-handle[data-edge="se"]')).toBeHidden();

    await page.getByRole('button', { name: 'Restore size' }).click();
    await expect.poll(async () => (await box(page)).width).toBe(before.width);
  });

  test('double-clicking the title bar maximizes', async ({ page }) => {
    await page.locator('.pm-title').dblclick();
    await expect(page.getByRole('button', { name: 'Restore size' })).toBeVisible();
  });

  test('can be resized from the keyboard', async ({ page }) => {
    const before = await box(page);
    await page.locator('.pm-handle[data-edge="se"]').focus();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowUp');
    const after = await box(page);
    expect(after.width).toBeLessThan(before.width);
    expect(after.height).toBeLessThan(before.height);
  });

  test('stays usable when the window shrinks', async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 500 });
    await expect.poll(async () => (await box(page)).width).toBeLessThanOrEqual(700);
    const current = await box(page);
    expect(current.y).toBeGreaterThanOrEqual(0);
    await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
  });

  test('fills a phone screen', async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 720 });
    await expect.poll(async () => (await box(page)).width).toBe(400);
    expect((await box(page)).height).toBe(720);
  });

  test('the next modal opens at the size the last one was left at', async ({ page }) => {
    await dragHandle(page, 'se', -120, -80);
    const resized = await box(page);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await row(page, 'form').click();
    await expect(dialog(page)).toBeVisible();
    const reopened = await box(page);
    expect(reopened.width).toBe(resized.width);
    expect(reopened.height).toBe(resized.height);
  });
});

test.describe('closing the modal', () => {
  test.beforeEach(async ({ page }) => {
    await openList(page);
    await openReport(page);
  });

  test('closes with the button or Esc, and removes the viewer', async ({ page }) => {
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.locator('.pv-root')).toHaveCount(0);

    await openReport(page);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
  });

  test('Esc closes search first, then the modal', async ({ page }) => {
    await page.getByRole('button', { name: 'Search' }).click();
    await page.getByLabel('Find in document').fill('quarterly');
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('Find in document')).toBeHidden();
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
  });

  test('Esc leaves an annotation tool first', async ({ page }) => {
    await page.getByRole('button', { name: 'Draw a rectangle' }).click();
    await page.locator('.pv-scroll').focus();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Draw a rectangle' })).toHaveAttribute('aria-pressed', 'false');
    await expect(dialog(page)).toBeVisible();
  });

  test('the page behind cannot be used while it is open', async ({ page }) => {
    const target = (await row(page, 'form').boundingBox())!;
    await page.mouse.click(target.x + 100, target.y + target.height / 2);
    await page.waitForTimeout(200);
    await expect(page.locator('.pm-title')).toHaveText('Annual report.pdf');
    await expect(dialog(page)).toHaveCount(1);
  });

  test('an unchanged document closes without asking', async ({ page }) => {
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(dialog(page)).toHaveCount(0);
  });

  test('unsaved annotations ask first, and Keep editing keeps them', async ({ page }) => {
    await addAnnotation(page);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toContainText('Discard your changes?');
    await page.getByRole('button', { name: 'Keep editing' }).click();
    await expect(dialog(page)).toBeVisible();
    await expect(page.locator('[data-kind="rect"]')).toHaveCount(1);
  });

  test('Esc also asks first, and pressing it again keeps editing', async ({ page }) => {
    await addAnnotation(page);
    await page.getByRole('button', { name: 'Draw a rectangle' }).click();
    await page.locator('.pv-scroll').focus();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(dialog(page)).toBeVisible();
  });

  test('Discard closes and loses the changes', async ({ page }) => {
    await addAnnotation(page);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(dialog(page)).toHaveCount(0);

    await openReport(page);
    await expect(page.locator('[data-kind="rect"]')).toHaveCount(0);
  });

  test('Download and close saves the annotated file', async ({ page }) => {
    await addAnnotation(page);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download and close' }).click()]);
    expect(download.suggestedFilename()).toBe('Annual report.pdf');
    await expect(dialog(page)).toHaveCount(0);
  });

  test('downloading first means closing does not ask', async ({ page }) => {
    await addAnnotation(page);
    await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download', exact: true }).click()]);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(dialog(page)).toHaveCount(0);
  });

  test('form changes also ask first', async ({ page }) => {
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await row(page, 'form').click();
    await page.locator('[data-field="full_name"]').fill('Ada Lovelace');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
  });

  test('throws no uncaught errors across open, resize and close', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await dragHandle(page, 'e', -80, 0);
    await page.getByRole('button', { name: 'Maximize' }).click();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await row(page, 'photo').click();
    await expect(page.locator('.viewer-canvas img')).toBeVisible();
    await dragHandle(page, 'se', -60, -40);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    expect(errors).toEqual([]);
  });
});

test('an image refits as the modal is resized', async ({ page }) => {
  await openList(page);
  await row(page, 'photo').click();
  await expect(page.locator('.viewer-canvas img')).toBeVisible();
  await page.getByLabel('Zoom level').selectOption('fit-page');
  const width = async () => (await page.locator('.viewer-canvas img').boundingBox())!.width;
  await expect.poll(width).toBeGreaterThan(0);
  const before = await width();
  await dragHandle(page, 'se', -240, -160);
  await expect.poll(width).toBeLessThan(before);
  const host = (await page.locator('.pv-image').boundingBox())!;
  expect(await width()).toBeLessThanOrEqual(host.width);
});

test('a scroll just before opening the menu does not close it, but a later one does', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 260 });
  await page.goto('/?click=menu');
  const lastRow = page.locator('li[data-file="notes"]');
  await expect(lastRow).toBeAttached();
  await lastRow.evaluate((element) => {
    window.scrollBy(0, 40);
    (element as HTMLElement).click();
  });
  await page.waitForTimeout(200);
  await expect(page.getByRole('menu')).toBeVisible();

  await page.evaluate(() => window.scrollBy(0, -20));
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('a Word file opens in the modal and downloads as Word', async ({ page }) => {
  const up = await fetch('http://localhost:8080/swagger/index.html').then((response) => response.ok).catch(() => false);
  test.skip(!up, 'needs the PDF service at localhost:8080');
  await page.goto('/');
  await page.locator('li[data-file="word"]').click();
  await expect(page.locator('.pv-page[data-page="1"] canvas.pv-canvas')).toBeVisible({ timeout: 30_000 });
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download', exact: true }).click()]);
  expect(download.suggestedFilename()).toBe('Meeting notes.docx');
});

test('a Word file shows the same opening message as a PDF while it converts', async ({ page }) => {
  await page.route('**/api/pdf/any-to-pdf', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"stopped by the test"}' });
  });
  await page.goto('/');
  await page.locator('li[data-file="word"]').click();
  await expect(page.locator('[data-pdf-modal] [role="status"]')).toHaveText('Opening document…');
  await page.waitForTimeout(400);
  await expect(page.locator('[data-pdf-modal] [role="status"]')).toHaveText('Opening document…');
  await expect(page.getByText('Converting')).toHaveCount(0);
});

test('comments work the same inside the modal', async ({ page }) => {
  await page.goto('/');
  await page.locator('li[data-file="report"]').click();
  const area = page.locator('.pv-page[data-page="1"]');
  await expect(area.locator('canvas.pv-canvas')).toBeVisible();
  const box = (await area.boundingBox())!;

  await page.getByRole('button', { name: 'Add a comment' }).click();
  await page.mouse.click(box.x + 150, box.y + 150);
  await page.getByRole('dialog', { name: 'Add a comment' }).getByRole('textbox').fill('In the modal');
  await page.getByRole('button', { name: 'Save' }).click();

  await area.locator('[data-kind="note"]').click();
  await expect(page.getByRole('dialog', { name: 'Edit comment' }).getByRole('textbox')).toHaveValue('In the modal');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(area.locator('[data-kind="note"]')).toHaveCount(1);
  await expect(page.locator('[data-pdf-modal] dialog')).toBeVisible();
});
