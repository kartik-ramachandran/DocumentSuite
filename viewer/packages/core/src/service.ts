import { base64ToBytes, bytesToBase64 } from './sources';
import type { ServiceResult } from './types';

/** Thin client for the PDF API. Every call uses the JSON form of the API unless told otherwise. */
export class ServiceClient {
  constructor(
    private readonly baseUrl: string | undefined,
    private readonly headers: Record<string, string> = {},
    readonly transport: 'multipart' | 'json' = 'multipart',
  ) {}

  get isConfigured(): boolean {
    return Boolean(this.baseUrl);
  }

  url(path: string): string {
    if (!this.baseUrl) throw new Error('This needs a PDF service. Set the serviceUrl option.');
    return `${this.baseUrl.replace(/\/+$/, '')}${path}`;
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const url = this.url(path);
    let response: Response;
    try {
      response = await fetch(url, { ...init, headers: { ...this.headers, ...init.headers } });
    } catch (error) {
      if ((error as Error).name === 'AbortError') throw error;
      // fetch only rejects when no response arrives, and its own message doesn't say what to check.
      throw new Error(`Couldn't reach the PDF service at ${this.baseUrl}. Check that it's running and accepts requests from this site.`);
    }
    if (!response.ok) throw new Error(await readError(response));
    return response;
  }

  /** Calls a route at /api/json. Uint8Array values are sent as base64 files. */
  async callJson(operation: string, body: Record<string, unknown>): Promise<ServiceResult> {
    const response = await this.request(`/api/json/${operation.replace(/^\/+/, '')}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body, (_, value) => (value instanceof Uint8Array ? bytesToBase64(value) : value)),
    });
    return response.json() as Promise<ServiceResult>;
  }

  /** Uploads a document to a route under /api/pdf, as JSON or as a multipart form depending on the transport option. */
  async uploadFile(operation: string, bytes: Uint8Array, name: string): Promise<ServiceResult> {
    if (this.transport === 'json') return this.callJson(operation, { file: { name, data: bytes } });

    const response = await this.request(`/api/pdf/${operation}`, { method: 'POST', body: toForm(bytes, name) });
    return response.json() as Promise<ServiceResult>;
  }

  /** Converts a non-PDF document to PDF. */
  async convertToPdf(bytes: Uint8Array, name: string): Promise<Uint8Array> {
    if (this.transport === 'json') {
      const result = await this.callJson('any-to-pdf', { file: { name, data: bytes } });
      if (!result.data) throw new Error('The PDF service returned no document.');
      return base64ToBytes(result.data);
    }

    const response = await this.request('/api/pdf/any-to-pdf', { method: 'POST', body: toForm(bytes, name) });
    return new Uint8Array(await response.arrayBuffer());
  }
}

function toForm(bytes: Uint8Array, name: string): FormData {
  const form = new FormData();
  form.append('file', new Blob([bytes as BlobPart]), name);
  return form;
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string; title?: string };
    return body.error ?? body.title ?? `The PDF service returned HTTP ${response.status}.`;
  } catch {
    return `The PDF service returned HTTP ${response.status}.`;
  }
}
