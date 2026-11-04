import type { DocumentSource } from './types';

export interface LoadedSource {
  bytes: Uint8Array;
  name: string;
}

const NON_PDF_EXTENSIONS = /\.(docx?|xlsx?|pptx?|html?|md|markdown|txt)$/i;
const IMAGE_EXTENSIONS: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  bmp: 'image/bmp', svg: 'image/svg+xml', avif: 'image/avif', ico: 'image/x-icon',
};
const EXTENSION_FOR_TYPE: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/bmp': 'bmp', 'image/svg+xml': 'svg', 'image/avif': 'avif', 'image/x-icon': 'ico',
};

export type ImageDetection = { mimeType: string } | { unsupported: string } | null;

function startsWith(bytes: Uint8Array, ...signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

/** Identifies an image from its first bytes, so a wrong file name doesn't matter. The name is only used if they're unclear. */
export function detectImage({ bytes, name }: LoadedSource): ImageDetection {
  if (hasPdfHeader(bytes)) return null;
  if (startsWith(bytes, 0x89, 0x50, 0x4e, 0x47)) return { mimeType: 'image/png' };
  if (startsWith(bytes, 0xff, 0xd8, 0xff)) return { mimeType: 'image/jpeg' };
  if (['GIF87a', 'GIF89a'].includes(asciiAt(bytes, 0, 6))) return { mimeType: 'image/gif' };
  if (asciiAt(bytes, 0, 4) === 'RIFF' && asciiAt(bytes, 8, 4) === 'WEBP') return { mimeType: 'image/webp' };
  if (isBitmap(bytes)) return { mimeType: 'image/bmp' };
  if (startsWith(bytes, 0x00, 0x00, 0x01, 0x00)) return { mimeType: 'image/x-icon' };
  if (startsWith(bytes, 0x49, 0x49, 0x2a, 0x00) || startsWith(bytes, 0x4d, 0x4d, 0x00, 0x2a)) return { unsupported: 'TIFF' };

  if (asciiAt(bytes, 4, 4) === 'ftyp') {
    const brand = asciiAt(bytes, 8, 4);
    if (brand === 'avif' || brand === 'avis') return { mimeType: 'image/avif' };
    if (brand === 'heic' || brand === 'heix' || brand === 'mif1' || brand === 'msf1') return { unsupported: 'HEIC' };
  }

  const head = new TextDecoder().decode(bytes.subarray(0, 1024)).trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!doctype svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return { mimeType: 'image/svg+xml' };

  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXTENSIONS[extension] ? { mimeType: IMAGE_EXTENSIONS[extension] } : null;
}

/** Gives a file the extension matching its real type when a download would otherwise be wrongly named. */
export function nameForType(name: string, mimeType: string): string {
  const extension = EXTENSION_FOR_TYPE[mimeType];
  const current = name.split('.').pop()?.toLowerCase() ?? '';
  if (!extension || EXTENSION_FOR_TYPE[IMAGE_EXTENSIONS[current]] === extension) return name;
  return `${name.replace(/\.[^.]+$/, '')}.${extension}`;
}

// "BM" alone would also match ordinary text, so the size of the bitmap's header is checked as well.
function isBitmap(bytes: Uint8Array): boolean {
  const headerSize = bytes[14] | (bytes[15] << 8) | (bytes[16] << 16) | (bytes[17] << 24);
  return startsWith(bytes, 0x42, 0x4d) && [12, 40, 52, 56, 64, 108, 124].includes(headerSize);
}

function hasPdfHeader(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

export function isPdf(source: LoadedSource): boolean {
  return hasPdfHeader(source.bytes) || !NON_PDF_EXTENSIONS.test(source.name);
}

export function base64ToBytes(value: string): Uint8Array {
  const comma = value.startsWith('data:') ? value.indexOf(',') : -1;
  const binary = atob(comma >= 0 ? value.slice(comma + 1) : value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  // Encoded in chunks because passing a whole file as function arguments overflows the stack.
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function nameFromUrl(url: string): string {
  try {
    const last = new URL(url, location.href).pathname.split('/').pop();
    return last ? decodeURIComponent(last) : 'document.pdf';
  } catch {
    return 'document.pdf';
  }
}

async function fetchBytes(url: string, headers?: Record<string, string>, signal?: AbortSignal): Promise<Uint8Array> {
  const response = await fetch(url, { headers, signal });
  if (!response.ok) throw new Error(`Could not load the document (HTTP ${response.status}).`);
  return new Uint8Array(await response.arrayBuffer());
}

function looksLikeBase64(value: string): boolean {
  if (value.startsWith('data:')) return true;
  // PDF and common image base64 always start this way, so a URL is never mistaken for a document.
  return /^(JVBERi0|iVBORw0|\/9j\/|R0lGOD|UklGR)/.test(value) || (value.length > 256 && /^[A-Za-z0-9+/\s]+=*$/.test(value.slice(0, 256)));
}

export async function loadSource(source: DocumentSource, fileName: string | undefined, signal?: AbortSignal): Promise<LoadedSource> {
  if (typeof source === 'string') {
    if (looksLikeBase64(source)) return { bytes: base64ToBytes(source), name: fileName ?? 'document.pdf' };
    return { bytes: await fetchBytes(source, undefined, signal), name: fileName ?? nameFromUrl(source) };
  }
  if (source instanceof URL) return { bytes: await fetchBytes(source.href, undefined, signal), name: fileName ?? nameFromUrl(source.href) };
  if (source instanceof Uint8Array) return { bytes: source, name: fileName ?? 'document.pdf' };
  if (source instanceof ArrayBuffer) return { bytes: new Uint8Array(source), name: fileName ?? 'document.pdf' };
  if (source instanceof Blob) {
    const name = fileName ?? (source instanceof File ? source.name : 'document.pdf');
    return { bytes: new Uint8Array(await source.arrayBuffer()), name };
  }
  if ('base64' in source) return { bytes: base64ToBytes(source.base64), name: fileName ?? source.name ?? 'document.pdf' };
  return { bytes: await fetchBytes(source.url, source.headers, signal), name: fileName ?? source.name ?? nameFromUrl(source.url) };
}
