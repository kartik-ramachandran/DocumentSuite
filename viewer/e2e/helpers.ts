import { expect, type Page } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = join(here, '.fixtures');
export const SERVICE = 'http://localhost:8080';

export const fixture = (name: string) => join(FIXTURES, name);

export function demoUrl(options: Record<string, string> = {}): string {
  return `/?${new URLSearchParams(options)}`;
}

export async function openDemo(page: Page, url = demoUrl()): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => Boolean((window as never as { pdfViewer?: unknown }).pdfViewer));
  await expect(page.getByRole('button', { name: 'Open file' })).toBeVisible();
  (page as Page & { pageErrors?: string[] }).pageErrors = errors;
}

export async function openFile(page: Page, name: string, expectedPages?: number): Promise<void> {
  await page.getByLabel('Choose a file to open').setInputFiles(fixture(name));
  await waitForDocument(page, expectedPages);
}

export async function waitForDocument(page: Page, expectedPages?: number): Promise<void> {
  await expect(page.locator('.pv-page').first()).toBeVisible({ timeout: 30_000 });
  if (expectedPages) await expect(page.locator('.pv-page')).toHaveCount(expectedPages);
  await expect(page.locator('.pv-page[data-page="1"] canvas.pv-canvas')).toBeVisible({ timeout: 30_000 });
}

/** True when a page's canvas shows more than a blank sheet. */
export function pageHasInk(page: Page, pageNumber: number): Promise<boolean> {
  return page.locator(`.pv-page[data-page="${pageNumber}"] canvas.pv-canvas`).evaluate((canvas: HTMLCanvasElement) => {
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] > 0 && (data[index] < 200 || data[index + 1] < 200 || data[index + 2] < 200)) return true;
    }
    return false;
  });
}

/** Drags on a page, with positions given in points on the unzoomed page. */
export async function dragOnPage(page: Page, pageNumber: number, from: [number, number], to: [number, number]): Promise<void> {
  const box = (await page.locator(`.pv-page[data-page="${pageNumber}"]`).boundingBox())!;
  const scale = await page.evaluate(() => (window as never as { pdfViewer: { zoom: number } }).pdfViewer.zoom);
  const toScreen = ([x, y]: [number, number]) => [box.x + x * scale, box.y + y * scale] as const;
  await page.mouse.move(...toScreen(from));
  await page.mouse.down();
  await page.mouse.move(...toScreen([(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]), { steps: 4 });
  await page.mouse.move(...toScreen(to), { steps: 4 });
  await page.mouse.up();
}

export async function clickOnPage(page: Page, pageNumber: number, point: [number, number]): Promise<void> {
  const box = (await page.locator(`.pv-page[data-page="${pageNumber}"]`).boundingBox())!;
  const scale = await page.evaluate(() => (window as never as { pdfViewer: { zoom: number } }).pdfViewer.zoom);
  await page.mouse.click(box.x + point[0] * scale, box.y + point[1] * scale);
}

/** The current document as it would be downloaded, read back by a separate copy of PDF.js. */
export async function exportedPdf(page: Page) {
  const base64 = await page.evaluate(() => (window as never as { pdfViewer: { getBase64(): Promise<string> } }).pdfViewer.getBase64());
  return readPdf(Buffer.from(base64, 'base64'));
}

export async function readPdf(bytes: Buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  return {
    bytes,
    pageCount: document.numPages,
    async text(pageNumber: number): Promise<string> {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      return content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
    },
    async annotations(pageNumber: number) {
      const page = await document.getPage(pageNumber);
      return page.getAnnotations();
    },
    async operators(pageNumber: number): Promise<number> {
      const page = await document.getPage(pageNumber);
      return (await page.getOperatorList()).fnArray.length;
    },
    async fieldValues(): Promise<Record<string, unknown>> {
      const values: Record<string, unknown> = {};
      for (let number = 1; number <= document.numPages; number++) {
        const page = await document.getPage(number);
        for (const annotation of await page.getAnnotations()) {
          if (annotation.fieldName) values[annotation.fieldName] = annotation.fieldValue;
        }
      }
      return values;
    },
  };
}

export async function isServiceUp(): Promise<boolean> {
  try {
    return (await fetch(`${SERVICE}/swagger/index.html`, { signal: AbortSignal.timeout(3000) })).ok;
  } catch {
    return false;
  }
}
