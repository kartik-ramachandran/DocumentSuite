import { PdfViewer } from './viewer';
import type { ViewerOptions } from './types';

export { PdfViewer, findMatches } from './viewer';
export { base64ToBytes, bytesToBase64, detectImage } from './sources';
export type * from './types';

/** Starts a viewer inside an element. The element needs a height. */
export function createViewer(element: HTMLElement, options: ViewerOptions = {}): PdfViewer {
  return new PdfViewer(element, options);
}
