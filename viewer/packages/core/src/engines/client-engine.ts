import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { DocumentEngine, PageSize, TextRun, ViewRotation } from '../types';

let workerConfigured = false;

// The worker is bundled as text and started from a blob, which works in every bundler without extra setup.
async function configureWorker(workerSrc: string | undefined): Promise<void> {
  if (workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
    return;
  }
  if (workerConfigured) return;
  const { default: source } = await import('pdfjs-dist/build/pdf.worker.min.mjs?raw');
  pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  workerConfigured = true;
}

export interface ClientEngineOptions {
  workerSrc?: string;
  onPassword: (retry: boolean) => Promise<string | null>;
}

/** Renders in the browser with PDF.js, so documents never leave the user's device. */
export class ClientEngine implements DocumentEngine {
  private constructor(
    readonly document: PDFDocumentProxy,
    private readonly pages: PDFPageProxy[],
    private readonly originalBytes: Uint8Array,
    private readonly task: PDFDocumentLoadingTask,
  ) {}

  static async open(bytes: Uint8Array, options: ClientEngineOptions): Promise<ClientEngine> {
    await configureWorker(options.workerSrc);

    // PDF.js takes ownership of the array it's given, so it gets a copy.
    const task = pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: true });
    task.onPassword = (provide: (password: string) => void, reason: number) => {
      void options.onPassword(reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD).then((password) => {
        if (password === null) void task.destroy();
        else provide(password);
      });
    };

    const document = await task.promise;
    const pages: PDFPageProxy[] = [];
    for (let number = 1; number <= document.numPages; number++) pages.push(await document.getPage(number));
    return new ClientEngine(document, pages, bytes, task);
  }

  get pageCount(): number {
    return this.document.numPages;
  }

  getPageSize(pageNumber: number): PageSize {
    const { width, height } = this.pages[pageNumber - 1].getViewport({ scale: 1 });
    return { width, height };
  }

  async render(pageNumber: number, canvas: HTMLCanvasElement, scale: number, rotation: ViewRotation, signal: AbortSignal): Promise<void> {
    const page = this.pages[pageNumber - 1];
    const viewport = page.getViewport({ scale, rotation: (page.rotate + rotation) % 360 });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);

    const task = page.render({ canvas, viewport });
    const cancel = () => task.cancel();
    signal.addEventListener('abort', cancel, { once: true });
    try {
      await task.promise;
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  }

  async getTextRuns(pageNumber: number): Promise<TextRun[]> {
    const page = this.pages[pageNumber - 1];
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const runs: TextRun[] = [];

    for (const item of content.items) {
      if (!('str' in item) || item.str.trim().length === 0) continue;
      const transform = pdfjs.Util.transform(viewport.transform, item.transform);
      const height = Math.hypot(transform[2], transform[3]);
      runs.push({ text: item.str, left: transform[4], top: transform[5] - height, width: item.width, height });
    }
    return runs;
  }

  getBytes(): Promise<Uint8Array> {
    return Promise.resolve(this.originalBytes);
  }

  destroy(): void {
    void this.task.destroy();
  }
}
