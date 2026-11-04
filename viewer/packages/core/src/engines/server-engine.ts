import type { ServiceClient } from '../service';
import type { DocumentEngine, PageSize, TextRun, ViewRotation } from '../types';

interface ServerDocument {
  id: string;
  pageCount: number;
  pages: PageSize[];
}

const DPI_STEP = 24;
const MIN_DPI = 48;
const MAX_DPI = 300;

/** Has the PDF API render pages, which suits weak devices and very large files. */
export class ServerEngine implements DocumentEngine {
  private readonly textCache = new Map<number, Promise<TextRun[]>>();

  private constructor(
    private readonly service: ServiceClient,
    private readonly document: ServerDocument,
  ) {}

  static async open(bytes: Uint8Array, name: string, service: ServiceClient): Promise<ServerEngine> {
    const result = await service.uploadFile('viewer/documents', bytes, name);
    return new ServerEngine(service, result as unknown as ServerDocument);
  }

  get pageCount(): number {
    return this.document.pageCount;
  }

  getPageSize(pageNumber: number): PageSize {
    return this.document.pages[pageNumber - 1];
  }

  async render(pageNumber: number, canvas: HTMLCanvasElement, scale: number, rotation: ViewRotation, signal: AbortSignal): Promise<void> {
    // Requests are rounded to fixed resolutions so that browsers and proxies can reuse cached pages.
    const dpi = Math.min(MAX_DPI, Math.max(MIN_DPI, Math.ceil((scale * 72) / DPI_STEP) * DPI_STEP));
    const response = await this.service.request(`/api/pdf/viewer/documents/${this.document.id}/pages/${pageNumber}?dpi=${dpi}`, { signal });
    const bitmap = await createImageBitmap(await response.blob());
    if (signal.aborted) {
      bitmap.close();
      throw new DOMException('Rendering was cancelled.', 'AbortError');
    }

    const size = this.getPageSize(pageNumber);
    const sideways = rotation === 90 || rotation === 270;
    canvas.width = Math.floor((sideways ? size.height : size.width) * scale);
    canvas.height = Math.floor((sideways ? size.width : size.height) * scale);

    const context = canvas.getContext('2d')!;
    context.save();
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((rotation * Math.PI) / 180);
    context.drawImage(bitmap, -(size.width * scale) / 2, -(size.height * scale) / 2, size.width * scale, size.height * scale);
    context.restore();
    bitmap.close();
  }

  getTextRuns(pageNumber: number): Promise<TextRun[]> {
    let cached = this.textCache.get(pageNumber);
    if (!cached) {
      cached = this.service
        .request(`/api/pdf/viewer/documents/${this.document.id}/pages/${pageNumber}/text`)
        .then((response) => response.json() as Promise<TextRun[]>);
      this.textCache.set(pageNumber, cached);
    }
    return cached;
  }

  async getBytes(): Promise<Uint8Array> {
    const response = await this.service.request(`/api/pdf/viewer/documents/${this.document.id}/file`);
    return new Uint8Array(await response.arrayBuffer());
  }

  destroy(): void {
    // Best effort: the server also removes documents that have been idle for a while.
    void this.service.request(`/api/pdf/viewer/documents/${this.document.id}`, { method: 'DELETE', keepalive: true }).catch(() => undefined);
  }
}
