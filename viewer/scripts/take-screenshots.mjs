// Takes the screenshots used in the READMEs. Every document in them is a generated sample.
//
//   docker compose up -d        (from the repository root)
//   npm run build && npm run build:examples
//   npm run preview -w example-react
//   npm run screenshots
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEMO = process.env.DEMO_URL ?? 'http://localhost:5173';
const OUTPUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'screenshots');
const VIEWPORT = { width: 1280, height: 800 };

mkdirSync(OUTPUT, { recursive: true });

const listUrl = (settings = {}) => `${DEMO}/?settings=${encodeURIComponent(JSON.stringify(settings))}`;
const row = (page, id) => page.locator(`li[data-file="${id}"]`);
const firstPage = (page) => page.locator('.pv-page[data-page="1"] canvas.pv-canvas');
const save = (target, name, options = {}) => target.screenshot({ path: join(OUTPUT, `${name}.png`), ...options });

async function openList(browser, settings, colorScheme = 'light') {
  const context = await browser.newContext({ viewport: VIEWPORT, colorScheme });
  const page = await context.newPage();
  await page.goto(listUrl(settings));
  await row(page, 'report').waitFor();
  return page;
}

async function openFile(page, id) {
  await row(page, id).click();
  if (id === 'photo') await page.locator('.viewer-canvas img').waitFor();
  else await firstPage(page).waitFor({ timeout: 40_000 });
  await page.waitForTimeout(700);
}

async function drag(page, from, to) {
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 4 });
  await page.mouse.move(...to, { steps: 4 });
  await page.mouse.up();
}

async function settingsPanel(page) {
  await page.locator('summary', { hasText: 'Settings' }).click();
  const panel = page.locator('.ps-panel');
  await panel.waitFor();
  await page.waitForTimeout(200);
  return panel;
}

const shots = {
  async 'file-list'(browser) {
    const page = await openList(browser);
    await row(page, 'report').click({ button: 'right' });
    await page.getByRole('menu').waitFor();
    await save(page, 'file-list', { clip: { x: 0, y: 0, width: VIEWPORT.width, height: 460 } });
  },

  async 'viewer-modal'(browser) {
    const page = await openList(browser);
    await openFile(page, 'report');
    const box = await page.locator('.pv-page[data-page="1"]').boundingBox();
    await page.getByRole('button', { name: 'Highlight text' }).click();
    await drag(page, [box.x + 118, box.y + 196], [box.x + 560, box.y + 198]);
    await page.getByRole('button', { name: 'Draw a rectangle' }).click();
    await drag(page, [box.x + 108, box.y + 270], [box.x + 770, box.y + 346]);
    await page.getByRole('button', { name: 'Add text' }).click();
    await page.mouse.click(box.x + 782, box.y + 298);
    await page.getByLabel('Annotation text').fill('Check these figures');
    await page.getByLabel('Annotation text').press('Control+Enter');
    await page.getByRole('button', { name: 'Add a comment' }).click();
    await page.mouse.click(box.x + 782, box.y + 188);
    await page.getByRole('dialog', { name: 'Add a comment' }).getByRole('textbox').fill('Is this still correct?');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.waitForTimeout(200);
    await save(page, 'viewer-modal');
  },

  async 'document-tools'(browser) {
    const page = await openList(browser);
    await openFile(page, 'report');
    await page.getByRole('button', { name: 'Toggle side panel' }).click();
    await page.getByRole('button', { name: 'Document tools' }).click();
    await page.locator('details[data-tool]', { has: page.locator('summary:text-is("Watermark")') }).locator('summary').click();
    await page.waitForTimeout(300);
    await save(page, 'document-tools');
  },

  async 'image-viewer'(browser) {
    const page = await openList(browser);
    await openFile(page, 'photo');
    await save(page, 'image-viewer');
  },

  async 'word-document'(browser) {
    const page = await openList(browser);
    await openFile(page, 'word');
    await save(page, 'word-document');
  },

  async watermark(browser) {
    const page = await openList(browser, { watermark: true, watermarkText: 'CONFIDENTIAL', initialZoom: 'fit-page' });
    await openFile(page, 'report');
    await save(page, 'watermark');
  },

  async 'toolbar-left'(browser) {
    const page = await openList(browser, { toolbarPosition: 'left', initialZoom: 'fit-page' });
    await openFile(page, 'report');
    await save(page, 'toolbar-left');
  },

  async 'settings-panel'(browser) {
    const page = await openList(browser, { watermark: true });
    await save(await settingsPanel(page), 'settings-panel');
  },

  async 'settings-panel-dark'(browser) {
    const page = await openList(browser, { watermark: true }, 'dark');
    await save(await settingsPanel(page), 'settings-panel-dark');
  },
};

const browser = await chromium.launch();
try {
  for (const [name, take] of Object.entries(shots)) {
    await take(browser);
    console.log(`took ${name}`);
  }
} finally {
  await browser.close();
}
