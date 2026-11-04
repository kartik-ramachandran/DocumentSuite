import type { PdfViewer } from './viewer';

/** A document to open. Base64 strings can also be data URLs. */
export type DocumentSource =
  | string
  | URL
  | ArrayBuffer
  | Uint8Array
  | Blob
  | { url: string; name?: string; headers?: Record<string, string> }
  | { base64: string; name?: string };

export type ZoomValue = number | 'fit-width' | 'fit-page';
export type RenderMode = 'client' | 'server';
export type ViewRotation = 0 | 90 | 180 | 270;
/** What's open, which decides the interface shown. */
export type DocumentKind = 'pdf' | 'image';

export interface ViewerOptions {
  source?: DocumentSource;
  /** File name used for downloads, and to detect non-PDF documents. */
  fileName?: string;
  /** client renders in the browser. server has your API render pages. Defaults to client. */
  mode?: RenderMode;
  /** Base URL of the PDF API, such as https://pdf.example.com. Needed for server mode, Office and text files, and server tools. Images and PDFs in client mode don't need it. */
  serviceUrl?: string;
  serviceHeaders?: Record<string, string>;
  /** How documents are sent to the API. Defaults to multipart. */
  serviceTransport?: 'multipart' | 'json';
  /** Where to load the PDF.js worker from. By default it's bundled, which needs CSP worker-src blob:. */
  workerSrc?: string;
  theme?: 'light' | 'dark' | 'auto';
  initialZoom?: ZoomValue;
  /** Shows the toolbar. Defaults to true. */
  toolbar?: boolean;
  /** Opens the page thumbnails on load. Defaults to false. */
  sidebarOpen?: boolean;
  /** Shows a button for opening local files. Defaults to true. */
  allowOpen?: boolean;
  plugins?: ViewerPlugin[];
  /** Asks for a PDF's password. By default the viewer shows its own prompt. */
  onPassword?: (retry: boolean) => Promise<string | null>;
}

export interface PageSize {
  width: number;
  height: number;
}

/** A piece of text on a page, in points from the top-left of the unrotated page. */
export interface TextRun {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface DocumentEngine {
  readonly pageCount: number;
  getPageSize(pageNumber: number): PageSize;
  render(pageNumber: number, canvas: HTMLCanvasElement, scale: number, rotation: ViewRotation, signal: AbortSignal): Promise<void>;
  getTextRuns(pageNumber: number): Promise<TextRun[]>;
  getBytes(): Promise<Uint8Array>;
  destroy(): void;
}

export interface SearchMatch {
  pageNumber: number;
  rects: Array<{ left: number; top: number; width: number; height: number }>;
}

export interface ViewerEvents {
  documentLoaded: { pageCount: number; fileName: string; kind: DocumentKind };
  documentError: { error: Error };
  pageChanged: { pageNumber: number };
  zoomChanged: { scale: number };
  rotationChanged: { rotation: ViewRotation };
  searchChanged: { query: string; matchCount: number; current: number };
  pageLayersReady: { pageNumber: number; layer: HTMLElement; size: PageSize };
}

export interface ToolbarButton {
  id: string;
  label: string;
  /** The inside of a 24x24 SVG. */
  icon: string;
  onClick: () => void;
  toggle?: boolean;
  group?: string;
}

export interface SidebarPanel {
  id: string;
  label: string;
  icon: string;
  element: HTMLElement;
  onShow?: () => void;
  /** Also show this panel while an image is open. */
  forImages?: boolean;
}

/** Changes the document on its way out, such as adding annotations to a download. */
export type ExportStep = (bytes: Uint8Array) => Promise<Uint8Array>;
/** Draws a plugin's content onto a printed page. Drawing units are points. */
export type PrintPainter = (context: CanvasRenderingContext2D, pageNumber: number, size: PageSize, target: 'print' | 'image') => void | Promise<void>;

export interface ViewerContext {
  readonly viewer: PdfViewer;
  /** The shadow root, for adding styles and dialogs. */
  readonly root: ShadowRoot;
  addStyles(css: string): void;
  addToolbarButton(button: ToolbarButton): HTMLButtonElement;
  addSidebarPanel(panel: SidebarPanel): void;
  addExportStep(step: ExportStep): void;
  addPrintPainter(painter: PrintPainter): void;
  /** Reports whether a plugin has changed the open image, so that exports need its drawing added. */
  addImageChangeCheck(check: () => boolean): void;
  /** The raw PDF.js document in client mode, otherwise null. */
  getPdfJsDocument(): unknown;
  /** True when the serviceUrl option is set. */
  readonly hasService: boolean;
  /** Calls the PDF API. Throws if serviceUrl isn't set or the API returns an error. */
  callService(path: string, body: Record<string, unknown>): Promise<ServiceResult>;
  /** Shows a short message to the user. */
  notify(message: string, kind?: 'info' | 'error'): void;
}

export interface ServiceResult {
  fileName?: string;
  contentType?: string;
  bytes?: number;
  data?: string;
  [key: string]: unknown;
}

export interface ViewerPlugin {
  readonly name: string;
  install(context: ViewerContext): void | Promise<void>;
  destroy?(): void;
}
