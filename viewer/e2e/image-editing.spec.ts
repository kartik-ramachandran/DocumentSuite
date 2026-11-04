import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { demoUrl, fixture, isServiceUp, openDemo, openFile, pageHasInk, waitForDocument } from './helpers';

const IMAGE_WIDTH = 320; // photo.png, which is small enough to be annotated in its real pixels
const IMAGE_HEIGHT = 200;
const RED = [198, 40, 40];

const shownImage = (page: Page) => page.locator('.viewer-canvas img');

async function openImage(page: Page, name = 'photo.png'): Promise<void> {
  await page.getByLabel('Choose a file to open').setInputFiles(fixture(name));
  await expect(shownImage(page)).toBeVisible();
  await expect(page.locator('.pv-image-layer')).toHaveCount(1);
}

/** Drags from one point to another, given as fractions of the image as it appears on screen. */
async function dragOnImage(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const box = (await shownImage(page).boundingBox())!;
  const point = ([x, y]: [number, number]) => [box.x + box.width * x, box.y + box.height * y] as const;
  await page.mouse.move(...point(from));
  await page.mouse.down();
  await page.mouse.move(...point(to), { steps: 6 });
  await page.mouse.up();
}

const annotations = (page: Page) => page.evaluate(() => (window as never as { pdfPlugin: { annotations: { getAnnotations(): Array<Record<string, number>> } } }).pdfPlugin.annotations.getAnnotations());

/** Reads pixels from the file the viewer would save, at positions in the image's own pixels. */
function savedPixels(page: Page, points: Array<[number, number]>) {
  return page.evaluate(async (positions) => {
    const base64 = await (window as never as { pdfViewer: { getBase64(): Promise<string> } }).pdfViewer.getBase64();
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    return { width: canvas.width, height: canvas.height, pixels: positions.map(([x, y]) => Array.from(context.getImageData(x, y, 1, 1).data).slice(0, 3)) };
  }, points);
}

const isNear = (actual: number[], expected: number[], tolerance = 40) => actual.every((value, index) => Math.abs(value - expected[index]) <= tolerance);

test.beforeEach(async ({ page }) => {
  await openDemo(page, demoUrl());
});

test.describe('one toolbar', () => {
  test('Viewer.js has no separate toolbar', async ({ page }) => {
    await openImage(page);
    await expect(page.locator('.viewer-toolbar')).toBeHidden();
  });

  test('shared controls stay in place when switching viewers', async ({ page }) => {
    await openFile(page, 'report.pdf', 5);
    const before = (await page.getByRole('button', { name: 'Zoom in' }).boundingBox())!;
    await openImage(page);
    const during = (await page.getByRole('button', { name: 'Zoom in' }).boundingBox())!;
    expect(Math.abs(during.y - before.y)).toBeLessThan(2);
  });

  test('image controls only appear for images', async ({ page }) => {
    const names = ['Rotate left', 'Flip horizontally', 'Flip vertically', 'Actual size'];
    await openImage(page);
    for (const name of names) await expect(page.getByRole('button', { name })).toBeVisible();
    await openFile(page, 'report.pdf', 5);
    for (const name of names) await expect(page.getByRole('button', { name })).toBeHidden();
  });

  test('the zoom box controls and reflects the image', async ({ page }) => {
    await openImage(page);
    const width = () => shownImage(page).evaluate((image) => Math.round(image.getBoundingClientRect().width));

    await page.getByLabel('Zoom level').selectOption('2');
    await expect.poll(width).toBe(640);
    await expect(page.getByLabel('Zoom level')).toHaveValue('2');

    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect.poll(width).toBe(960);
    await expect(page.getByLabel('Zoom level')).toHaveValue('3');

    await page.getByRole('button', { name: 'Zoom out' }).click();
    await expect.poll(width).toBe(640);
  });

  test('fitting keeps the rotation and centres the image', async ({ page }) => {
    await openImage(page);
    await page.getByRole('button', { name: 'Rotate view' }).click();
    await page.getByLabel('Zoom level').selectOption('fit-page');
    await expect.poll(() => shownImage(page).evaluate((image) => image.style.transform)).toContain('rotate(90deg)');

    const host = (await page.locator('.pv-image').boundingBox())!;
    await expect.poll(async () => {
      const box = (await shownImage(page).boundingBox())!;
      return Math.abs(box.x + box.width / 2 - (host.x + host.width / 2));
    }).toBeLessThan(2);
    const box = (await shownImage(page).boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(host.height);
    expect(box.height).toBeGreaterThan(host.height * 0.9);
  });

  test('opening the side panel keeps the zoom', async ({ page }) => {
    await openImage(page);
    const zoom = () => page.evaluate(() => (window as never as { pdfViewer: { zoom: number } }).pdfViewer.zoom);
    await page.getByLabel('Zoom level').selectOption('2');
    await expect.poll(zoom).toBeCloseTo(2, 2);

    await page.getByRole('button', { name: 'Toggle side panel' }).click();
    await page.waitForTimeout(200);
    expect(await zoom()).toBeCloseTo(2, 2);
    await expect(page.getByLabel('Zoom level')).toHaveValue('2');
    expect(Math.round((await shownImage(page).boundingBox())!.width)).toBe(640);
  });

  test('a fitted image refits when the space changes', async ({ page }) => {
    await openImage(page);
    await page.getByLabel('Zoom level').selectOption('fit-page');
    await page.waitForTimeout(100);
    const before = (await shownImage(page).boundingBox())!.width;

    await page.getByRole('button', { name: 'Toggle side panel' }).click();
    await page.setViewportSize({ width: 800, height: 600 });
    await expect.poll(async () => (await shownImage(page).boundingBox())!.width).toBeLessThan(before);
    // The side panel and the window each resize it, so this waits for both to have happened.
    await expect.poll(async () => (await shownImage(page).boundingBox())!.width - (await page.locator('.pv-image').boundingBox())!.width).toBeLessThanOrEqual(0);
    const host = (await page.locator('.pv-image').boundingBox())!;
    const image = (await shownImage(page).boundingBox())!;
    expect(image.width).toBeLessThanOrEqual(host.width);
    expect(image.height).toBeLessThanOrEqual(host.height);
    expect(Math.abs(image.x + image.width / 2 - (host.x + host.width / 2))).toBeLessThan(3);
  });

  test('an active button stays readable under the mouse', async ({ page }) => {
    await openImage(page);
    const button = page.getByRole('button', { name: 'Draw', exact: true });
    const colors = () => button.evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.backgroundColor, style.color];
    });
    await button.click();
    await button.hover();
    const hovered = await colors();
    await page.mouse.move(0, 400);
    expect(await colors()).toEqual(hovered);
  });

  test('rotate left and both flips work', async ({ page }) => {
    await openImage(page);
    const transform = () => shownImage(page).evaluate((image) => image.style.transform);
    await page.getByRole('button', { name: 'Rotate left' }).click();
    await expect.poll(transform).toContain('rotate(-90deg)');
    await page.getByRole('button', { name: 'Flip horizontally' }).click();
    await expect.poll(transform).toContain('scaleX(-1)');
    await page.getByRole('button', { name: 'Flip vertically' }).click();
    await expect.poll(transform).toContain('scaleY(-1)');
  });

  test('the image re-centres when the side panel opens', async ({ page }) => {
    await openImage(page);
    await page.getByRole('button', { name: 'Toggle side panel' }).click();
    const host = (await page.locator('.pv-image').boundingBox())!;
    const panel = (await page.locator('.pv-sidebar').boundingBox())!;
    expect(host.x).toBeGreaterThanOrEqual(panel.x + panel.width - 1);
    await expect.poll(async () => {
      const box = (await shownImage(page).boundingBox())!;
      return Math.abs(box.x + box.width / 2 - (host.x + host.width / 2));
    }).toBeLessThan(3);
  });
});

test.describe('annotations on images', () => {
  test('a drawn rectangle lands on exactly the right pixels of the saved file', async ({ page }) => {
    await openImage(page);
    await page.getByRole('button', { name: 'Draw a rectangle' }).click();
    await dragOnImage(page, [0.25, 0.25], [0.75, 0.75]);
    await expect(page.locator('[data-kind="rect"]')).toHaveCount(1);

    const [rect] = await annotations(page);
    expect(rect.x).toBeCloseTo(80, -1);
    expect(rect.y).toBeCloseTo(50, -1);

    const left = Math.round(rect.x);
    const top = Math.round(rect.y);
    const saved = await savedPixels(page, [[left, Math.round(100)], [160, top], [160, 100]]);
    expect([saved.width, saved.height]).toEqual([320, 200]);
    expect(isNear(saved.pixels[0], RED)).toBe(true);
    expect(isNear(saved.pixels[1], RED)).toBe(true);
    expect(isNear(saved.pixels[2], RED)).toBe(false);
  });

  test('a highlight looks the same in the saved file as on screen', async ({ page }) => {
    await openImage(page);
    await page.getByRole('button', { name: 'Highlight text' }).click();
    await dragOnImage(page, [0.05, 0.05], [0.5, 0.5]);
    const point: [number, number] = [80, 50];
    const original = [Math.floor((point[0] / 320) * 255), Math.floor((point[1] / 200) * 255), 140];
    const yellow = [255, 212, 0];
    const expected = original.map((value, index) => value * 0.6 + yellow[index] * 0.4);
    const saved = await savedPixels(page, [point]);
    expect(isNear(saved.pixels[0], expected, 8)).toBe(true);
  });

  test('annotations are saved at the full resolution of a large image', async ({ page }) => {
    const zoomed = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 3000;
      canvas.height = 2000;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#88aacc';
      context.fillRect(0, 0, 3000, 2000);
      const url = canvas.toDataURL('image/png');
      await (window as never as { pdfViewer: { load(source: string, name: string): Promise<void> } }).pdfViewer.load(url, 'big.png');
      return url.length;
    });
    expect(zoomed).toBeGreaterThan(0);
    await expect(page.locator('.pv-image-layer')).toHaveCount(1);
    await page.getByRole('button', { name: 'Draw a rectangle' }).click();
    await dragOnImage(page, [0.25, 0.25], [0.75, 0.75]);
    const saved = await savedPixels(page, [[0, 0]]);
    expect([saved.width, saved.height]).toEqual([3000, 2000]);
  });

  for (const [name, setup] of [
    ['zoomed', async (page: Page) => page.getByLabel('Zoom level').selectOption('2')],
    ['rotated', async (page: Page) => page.getByRole('button', { name: 'Rotate view' }).click()],
    ['flipped', async (page: Page) => page.getByRole('button', { name: 'Flip horizontally' }).click()],
    ['rotated and flipped', async (page: Page) => {
      await page.getByRole('button', { name: 'Rotate left' }).click();
      await page.getByRole('button', { name: 'Flip vertically' }).click();
    }],
  ] as const) {
    test(`drawing where you point works when the image is ${name}`, async ({ page }) => {
      await openImage(page);
      await setup(page);
      await page.waitForTimeout(100);
      await page.getByRole('button', { name: 'Draw a rectangle' }).click();
      const box = (await shownImage(page).boundingBox())!;
      const from = [box.x + box.width * 0.3, box.y + box.height * 0.3] as const;
      const to = [box.x + box.width * 0.6, box.y + box.height * 0.7] as const;
      await page.mouse.move(...from);
      await page.mouse.down();
      await page.mouse.move(...to, { steps: 5 });
      await page.mouse.up();

      const shape = (await page.locator('[data-kind="rect"] rect').boundingBox())!;
      expect(Math.abs(shape.x - from[0])).toBeLessThan(4);
      expect(Math.abs(shape.y - from[1])).toBeLessThan(4);
      expect(Math.abs(shape.x + shape.width - to[0])).toBeLessThan(4);
      expect(Math.abs(shape.y + shape.height - to[1])).toBeLessThan(4);
    });
  }

  for (const [name, change] of [
    ['zoomed', async (page: Page) => page.getByLabel('Zoom level').selectOption('2')],
    ['moved', async (page: Page) => {
      await page.getByRole('button', { name: 'Draw a rectangle' }).click();
      const box = (await shownImage(page).boundingBox())!;
      await page.mouse.move(box.x + 10, box.y + 10);
      await page.mouse.down();
      await page.mouse.move(box.x + 90, box.y + 50, { steps: 4 });
      await page.mouse.up();
    }],
    ['rotated', async (page: Page) => page.getByRole('button', { name: 'Rotate view' }).click()],
    ['flipped', async (page: Page) => page.getByRole('button', { name: 'Flip vertically' }).click()],
  ] as const) {
    test(`annotations stay on the image when it is ${name}`, async ({ page }) => {
      await openImage(page);
      await page.getByRole('button', { name: 'Draw a rectangle' }).click();
      await dragOnImage(page, [0.2, 0.2], [0.6, 0.5]);
      await page.getByRole('button', { name: 'Draw a rectangle' }).click();
      const [rect] = await annotations(page);

      if (name === 'moved') {
        const before = (await shownImage(page).boundingBox())!;
        await page.mouse.move(before.x + before.width * 0.9, before.y + before.height * 0.9);
        await page.mouse.down();
        await page.mouse.move(before.x + before.width * 0.9 + 70, before.y + before.height * 0.9 + 40, { steps: 4 });
        await page.mouse.up();
        await expect.poll(async () => Math.round((await shownImage(page).boundingBox())!.x - before.x)).toBe(70);
      } else {
        await change(page);
        await page.waitForTimeout(100);
      }

      // The drawing has to overlap the same part of the image, wherever the image is now.
      const image = (await shownImage(page).boundingBox())!;
      const shape = (await page.locator('[data-kind="rect"] rect').boundingBox())!;
      const imageWidth = IMAGE_WIDTH;
      const imageHeight = IMAGE_HEIGHT;
      const shownSideways = name === 'rotated';
      const expectedWidth = (shownSideways ? rect.height / imageHeight : rect.width / imageWidth) * image.width;
      expect(Math.abs(shape.width - expectedWidth)).toBeLessThan(6); // the outline's thickness counts towards its size
      expect(shape.x).toBeGreaterThanOrEqual(image.x - 2);
      expect(shape.x + shape.width).toBeLessThanOrEqual(image.x + image.width + 2);
      expect(shape.y).toBeGreaterThanOrEqual(image.y - 2);
      expect(shape.y + shape.height).toBeLessThanOrEqual(image.y + image.height + 2);
    });
  }

  test('a tool draws instead of dragging the image, and without one it drags', async ({ page }) => {
    await openImage(page);
    const before = (await shownImage(page).boundingBox())!;
    await page.getByRole('button', { name: 'Draw', exact: true }).click();
    await dragOnImage(page, [0.3, 0.3], [0.6, 0.6]);
    expect((await shownImage(page).boundingBox())!.x).toBe(before.x);
    await expect(page.locator('[data-kind="ink"]')).toHaveCount(1);

    await page.getByRole('button', { name: 'Draw', exact: true }).click();
    await dragOnImage(page, [0.3, 0.3], [0.6, 0.6]);
    await expect.poll(async () => (await shownImage(page).boundingBox())!.x).toBeGreaterThan(before.x + 20);
    await expect(page.locator('[data-kind="ink"]')).toHaveCount(1);
  });

  test('highlight, text, comment and picture all work', async ({ page }) => {
    await openImage(page);
    await page.getByRole('button', { name: 'Highlight text' }).click();
    await dragOnImage(page, [0.1, 0.1], [0.4, 0.2]);
    await expect(page.locator('[data-kind="highlight"]')).toHaveCount(1);

    await page.getByRole('button', { name: 'Add text' }).click();
    await dragOnImage(page, [0.5, 0.5], [0.5, 0.5]);
    await page.getByLabel('Annotation text').fill('On the photo');
    await page.getByLabel('Annotation text').press('Control+Enter');
    await expect(page.locator('[data-kind="text"]')).toHaveCount(1);

    await page.getByRole('button', { name: 'Add a comment' }).click();
    await dragOnImage(page, [0.7, 0.2], [0.7, 0.2]);
    await page.getByRole('dialog').getByRole('textbox').fill('Check this');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('[data-kind="note"]')).toHaveCount(1);

    await page.getByLabel('Choose a picture').setInputFiles(fixture('photo.gif'));
    await expect(page.getByRole('button', { name: 'Add a picture or signature' })).toHaveAttribute('aria-pressed', 'true');
    await dragOnImage(page, [0.1, 0.6], [0.1, 0.6]);
    await expect(page.locator('[data-kind="stamp"]')).toHaveCount(1);

    const saved = await savedPixels(page, [[0, 0]]);
    expect(saved.width).toBe(320);
  });

  test('select, move, delete and undo work', async ({ page }) => {
    await openImage(page);
    await page.getByRole('button', { name: 'Draw a rectangle' }).click();
    await dragOnImage(page, [0.2, 0.2], [0.4, 0.4]);
    const [before] = await annotations(page);

    await page.getByRole('button', { name: 'Select annotations' }).click();
    await dragOnImage(page, [0.2, 0.3], [0.5, 0.6]);
    await expect.poll(async () => (await annotations(page))[0].x).toBeGreaterThan(before.x + 80);

    await page.keyboard.press('Delete');
    await expect(page.locator('[data-kind="rect"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator('[data-kind="rect"]')).toHaveCount(1);
  });

  test('undoing everything restores the original file exactly', async ({ page }) => {
    await openImage(page, 'photo.jpg');
    await page.getByLabel('Zoom level').selectOption('fit-page');
    const base64 = readFileSync(fixture('photo.jpg')).toString('base64');
    const current = () => page.evaluate(() => (window as never as { pdfViewer: { getBase64(): Promise<string> } }).pdfViewer.getBase64());
    expect(await current()).toBe(base64);

    await page.getByRole('button', { name: 'Draw a rectangle' }).click();
    await dragOnImage(page, [0.2, 0.2], [0.8, 0.8]);
    await expect.poll(current).not.toBe(base64);

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(current).toBe(base64);
  });

  test('an annotated JPEG downloads as a new PNG, and an untouched one is left alone', async ({ page }) => {
    await openImage(page, 'photo.jpg');
    await page.getByLabel('Zoom level').selectOption('fit-page');
    let [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download' }).click()]);
    expect(download.suggestedFilename()).toBe('photo.jpg');

    await page.getByRole('button', { name: 'Draw a rectangle' }).click();
    await dragOnImage(page, [0.2, 0.2], [0.8, 0.8]);
    [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download' }).click()]);
    expect(download.suggestedFilename()).toBe('photo.png');
    expect(readFileSync(await download.path()).subarray(1, 4).toString()).toBe('PNG');
  });

  for (const name of ['photo.gif', 'photo.webp', 'photo.bmp', 'drawing.svg']) {
    test(`annotates and saves ${name}`, async ({ page }) => {
      await openImage(page, name);
      await page.getByLabel('Zoom level').selectOption('fit-page');
      await page.getByRole('button', { name: 'Draw a rectangle' }).click();
      await dragOnImage(page, [0.2, 0.2], [0.8, 0.8]);
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download' }).click()]);
      expect(download.suggestedFilename()).toMatch(/\.png$/);
      expect(readFileSync(await download.path()).subarray(1, 4).toString()).toBe('PNG');
    });
  }

  test('marks on a tiny image stay readable when saved', async ({ page }) => {
    await openImage(page, 'photo.gif');
    await page.getByLabel('Zoom level').selectOption('fit-page');
    await page.getByRole('button', { name: 'Draw a rectangle' }).click();
    await dragOnImage(page, [0.2, 0.2], [0.8, 0.8]);
    const [rect] = await annotations(page);
    const saved = await savedPixels(page, [[Math.round(rect.x), 128]]);
    expect(saved.width).toBe(256);
    expect(isNear(saved.pixels[0], RED)).toBe(true);
  });

  test('printing includes annotations', async ({ page }) => {
    await openImage(page);
    await page.getByRole('button', { name: 'Draw a rectangle' }).click();
    await dragOnImage(page, [0.2, 0.2], [0.8, 0.8]);
    await page.evaluate(() => {
      new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node instanceof HTMLIFrameElement) node.contentWindow!.print = () => {
              const image = node.contentDocument!.images[0];
              const canvas = document.createElement('canvas');
              canvas.width = image.naturalWidth;
              canvas.height = image.naturalHeight;
              const context = canvas.getContext('2d')!;
              context.drawImage(image, 0, 0);
              (window as never as { printedRedPixels: number }).printedRedPixels = Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data)
                .filter((value, index, data) => index % 4 === 0 && value > 180 && data[index + 1] < 70 && data[index + 2] < 70).length;
            };
          }
        }
      }).observe(document.body, { childList: true });
    });
    await page.getByRole('button', { name: 'Print' }).click();
    await expect.poll(() => page.evaluate(() => (window as never as { printedRedPixels?: number }).printedRedPixels ?? 0)).toBeGreaterThan(100);
  });

  test('a new document starts with no annotations', async ({ page }) => {
    await openImage(page);
    await page.getByRole('button', { name: 'Draw a rectangle' }).click();
    await dragOnImage(page, [0.2, 0.2], [0.8, 0.8]);
    await page.getByRole('button', { name: 'Draw a rectangle' }).click();

    await openImage(page, 'photo.jpg');
    await expect(page.locator('[data-kind="rect"]')).toHaveCount(0);
    expect(await annotations(page)).toEqual([]);

    await page.getByRole('button', { name: 'Draw a rectangle' }).click();
    await dragOnImage(page, [0.2, 0.2], [0.8, 0.8]);
    await openFile(page, 'report.pdf', 5);
    expect(await annotations(page)).toEqual([]);
  });

  test('without the editor plugin images have no editing tools or side panel', async ({ page }) => {
    await openDemo(page, demoUrl({ editor: '0' }));
    await openImage(page);
    await expect(page.getByRole('button', { name: 'Draw', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Toggle side panel' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible();
    await openFile(page, 'report.pdf', 5);
    await expect(page.getByRole('button', { name: 'Toggle side panel' })).toBeVisible();
  });
});

test.describe('document tools on images', () => {
  test.beforeAll(async () => {
    test.skip(!(await isServiceUp()), 'needs the PDF service at localhost:8080');
  });

  const openTools = async (page: Page) => {
    await page.getByRole('button', { name: 'Toggle side panel' }).click();
    await page.getByRole('button', { name: 'Document tools' }).click();
  };
  const openTool = async (page: Page, id: string) => {
    await page.locator(`details[data-tool="${id}"] summary`).click();
    return page.locator(`details[data-tool="${id}"]`);
  };
  const kind = (page: Page) => page.evaluate(() => (window as never as { pdfViewer: { kind: string } }).pdfViewer.kind);

  test('shows only the tools that apply', async ({ page }) => {
    await openImage(page);
    await openTools(page);
    await expect(page.getByRole('button', { name: 'Pages', exact: true })).toBeHidden();
    await expect(page.getByText('the image is converted to a PDF first')).toBeVisible();
    for (const id of ['image-to-pdf', 'compress', 'redact', 'searchable', 'watermark', 'convert']) {
      await expect(page.locator(`details[data-tool="${id}"]`)).toBeVisible();
    }
    for (const id of ['organize', 'remove-pages', 'extract-images']) {
      await expect(page.locator(`details[data-tool="${id}"]`)).toBeHidden();
    }

    await openFile(page, 'report.pdf', 5);
    await expect(page.getByRole('button', { name: 'Pages', exact: true })).toBeVisible();
    await expect(page.getByText('the image is converted to a PDF first')).toBeHidden();
    await expect(page.locator('details[data-tool="organize"]')).toBeVisible();
    await expect(page.locator('details[data-tool="image-to-pdf"]')).toBeHidden();
  });

  test('converting to PDF switches to the PDF viewer, and undo brings the image back', async ({ page }) => {
    await openImage(page);
    await openTools(page);
    const tool = await openTool(page, 'image-to-pdf');
    await tool.getByRole('button', { name: 'Convert to PDF' }).click();
    await waitForDocument(page, 1);
    expect(await kind(page)).toBe('pdf');
    expect(await pageHasInk(page, 1)).toBe(true);
    expect(await page.evaluate(() => (window as never as { pdfViewer: { fileName: string } }).pdfViewer.fileName)).toBe('photo.pdf');

    await page.getByRole('button', { name: 'Undo last tool' }).click();
    await expect(shownImage(page)).toBeVisible();
    expect(await kind(page)).toBe('image');
    const restored = await page.evaluate(() => (window as never as { pdfViewer: { getBase64(): Promise<string> } }).pdfViewer.getBase64());
    expect(restored).toBe(readFileSync(fixture('photo.png')).toString('base64'));
  });

  test('a tool runs on the image, including its annotations', async ({ page }) => {
    await openImage(page);
    await page.getByRole('button', { name: 'Draw a rectangle' }).click();
    await dragOnImage(page, [0.2, 0.2], [0.8, 0.8]);
    await page.getByRole('button', { name: 'Draw a rectangle' }).click();
    await openTools(page);
    const tool = await openTool(page, 'watermark');
    await tool.getByRole('button', { name: 'Add watermark' }).click();
    await waitForDocument(page, 1);
    expect(await kind(page)).toBe('pdf');

    const reds = await page.locator('.pv-page canvas.pv-canvas').evaluate((canvas: HTMLCanvasElement) => {
      const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
      let count = 0;
      for (let index = 0; index < data.length; index += 4) if (data[index] > 170 && data[index + 1] < 80 && data[index + 2] < 80) count++;
      return count;
    });
    expect(reds).toBeGreaterThan(50);
  });

  for (const name of ['photo.jpg', 'photo.webp', 'photo.gif', 'photo.bmp', 'drawing.svg']) {
    test(`tools accept ${name}`, async ({ page }) => {
      await openImage(page, name);
      await openTools(page);
      const tool = await openTool(page, 'image-to-pdf');
      await tool.getByRole('button', { name: 'Convert to PDF' }).click();
      await waitForDocument(page, 1);
      expect(await kind(page)).toBe('pdf');
    });
  }

  test('convert and download goes straight to an Office file', async ({ page }) => {
    await openImage(page);
    await openTools(page);
    const tool = await openTool(page, 'convert');
    const [download] = await Promise.all([page.waitForEvent('download'), tool.getByRole('button', { name: 'Convert', exact: true }).click()]);
    expect(download.suggestedFilename()).toBe('photo.docx');
    expect(await kind(page)).toBe('image');
  });

  test('explains itself without a service', async ({ page }) => {
    await page.goto(demoUrl({ service: '' }));
    await page.waitForFunction(() => Boolean((window as never as { pdfViewer?: unknown }).pdfViewer));
    await openImage(page);
    await openTools(page);
    await expect(page.getByText('Document tools need a PDF service')).toBeVisible();
  });
});

test('comments on images open when clicked, rather than starting another', async ({ page }) => {
  await openDemo(page, demoUrl());
  await openImage(page);
  await page.getByRole('button', { name: 'Add a comment' }).click();
  await dragOnImage(page, [0.5, 0.5], [0.5, 0.5]);
  await page.getByRole('dialog', { name: 'Add a comment' }).getByRole('textbox').fill('On the photo');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: 'Add a comment' })).toHaveAttribute('aria-pressed', 'false');

  await page.locator('[data-kind="note"]').click();
  await expect(page.getByRole('dialog', { name: 'Edit comment' }).getByRole('textbox')).toHaveValue('On the photo');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('[data-kind="note"]')).toHaveCount(1);
});
