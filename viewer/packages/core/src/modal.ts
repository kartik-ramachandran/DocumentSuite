import { ICONS } from './icons';
import { resolveSettings, type PdfSuiteSettings } from './settings';
import type { DocumentSource, ViewerOptions } from './types';
import { PdfViewer } from './viewer';

export interface ViewerModalOptions extends ViewerOptions {
  /** Shown in the title bar. Defaults to the file name. */
  title?: string;
  /** Initial size in pixels. Defaults to most of the window, or the size the last modal was left at. */
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  /** Asks before closing when there are unsaved changes. Defaults to the confirmClose setting. */
  confirmClose?: boolean;
  /** Called after the modal has closed. */
  onClose?: () => void;
}

interface ModalRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const EDGES: ResizeEdge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
const DEFAULT_MIN_WIDTH = 360;
const DEFAULT_MIN_HEIGHT = 280;
const DEFAULT_WIDTH_RATIO = 0.8;
const DEFAULT_HEIGHT_RATIO = 0.85;
const KEYBOARD_STEP = 24;
const HEADER_KEEP_VISIBLE = 48;
const PHONE_WIDTH = 560;

const MAXIMIZE_ICON = '<rect x="4" y="4" width="16" height="16" rx="2"/>';
const RESTORE_ICON = '<rect x="4" y="8" width="12" height="12" rx="2"/><path d="M8 8V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2"/>';

const MODAL_CSS = `
:host {
  --pm-surface: #ffffff;
  --pm-text: #1c2230;
  --pm-border: #d7dbe2;
  --pm-hover: #e6e9ef;
  --pm-accent: #2f5fd0;
  --pm-accent-text: #ffffff;
  font: 13px/1.4 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}
:host([data-theme='dark']) {
  --pm-surface: #262b35;
  --pm-text: #e7eaf0;
  --pm-border: #3a404c;
  --pm-hover: #333946;
  --pm-accent: #7ea2f5;
  --pm-accent-text: #10141c;
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
dialog {
  position: fixed;
  margin: 0;
  padding: 0;
  max-width: none;
  max-height: none;
  overflow: visible;
  border: 1px solid var(--pm-border);
  border-radius: 16px;
  background: var(--pm-surface);
  color: var(--pm-text);
  box-shadow: 0 12px 48px rgba(10, 16, 30, 0.35);
}
dialog[open] { animation: pm-enter 200ms ease-out; }
dialog::backdrop { background: rgba(10, 16, 30, 0.45); backdrop-filter: blur(4px); animation: pm-enter 200ms ease-out; }
.pm-button, .pm-action { transition: background-color 160ms ease, color 160ms ease; }
@keyframes pm-enter { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { *, *::backdrop { animation: none !important; transition: none !important; } }
dialog[data-maximized='true'] { border-radius: 0; border-width: 0; }
.pm-frame { display: flex; flex-direction: column; width: 100%; height: 100%; overflow: hidden; border-radius: inherit; }
.pm-header { display: flex; align-items: center; gap: 8px; flex-shrink: 0; height: 40px; padding: 0 6px 0 14px; border-bottom: 1px solid var(--pm-border); cursor: move; touch-action: none; user-select: none; }
dialog[data-maximized='true'] .pm-header, dialog[data-movable='false'] .pm-header { cursor: default; }
.pm-title { flex: 1; min-width: 0; margin: 0; overflow: hidden; font-size: 14px; font-weight: 600; white-space: nowrap; text-overflow: ellipsis; }
.pm-button { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
.pm-button:hover { background: var(--pm-hover); }
.pm-button svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.pm-button:focus-visible, .pm-action:focus-visible, .pm-handle:focus-visible { outline: 2px solid var(--pm-accent); outline-offset: 1px; }
.pm-viewer { flex: 1; min-height: 0; }
.pm-handle { position: absolute; z-index: 2; touch-action: none; }
dialog[data-maximized='true'] .pm-handle { display: none; }
.pm-handle[data-edge='n'] { top: -4px; left: 10px; right: 10px; height: 8px; cursor: ns-resize; }
.pm-handle[data-edge='s'] { bottom: -4px; left: 10px; right: 10px; height: 8px; cursor: ns-resize; }
.pm-handle[data-edge='e'] { top: 10px; right: -4px; bottom: 10px; width: 8px; cursor: ew-resize; }
.pm-handle[data-edge='w'] { top: 10px; left: -4px; bottom: 10px; width: 8px; cursor: ew-resize; }
.pm-handle[data-edge='ne'] { top: -5px; right: -5px; width: 16px; height: 16px; cursor: nesw-resize; }
.pm-handle[data-edge='nw'] { top: -5px; left: -5px; width: 16px; height: 16px; cursor: nwse-resize; }
.pm-handle[data-edge='se'] { bottom: -5px; right: -5px; width: 16px; height: 16px; cursor: nwse-resize; }
.pm-handle[data-edge='sw'] { bottom: -5px; left: -5px; width: 16px; height: 16px; cursor: nesw-resize; }
.pm-confirm { position: absolute; inset: 0; z-index: 3; display: flex; align-items: center; justify-content: center; padding: 16px; border-radius: inherit; background: rgba(10, 16, 30, 0.45); }
.pm-confirm-box { display: flex; flex-direction: column; gap: 10px; width: min(100%, 380px); padding: 16px; border: 1px solid var(--pm-border); border-radius: 8px; background: var(--pm-surface); }
.pm-confirm-box h3 { margin: 0; font-size: 15px; }
.pm-confirm-box p { margin: 0; }
.pm-confirm-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 6px; }
.pm-action { min-height: 32px; padding: 0 12px; border: 1px solid var(--pm-border); border-radius: 6px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
.pm-action:hover { background: var(--pm-hover); }
.pm-action[data-primary] { border-color: var(--pm-accent); background: var(--pm-accent); color: var(--pm-accent-text); }
`;

// The next modal opens at the size the last one was left at.
let rememberedRect: ModalRect | null = null;

/** A movable, resizable modal holding a viewer. Closing it removes it and frees the viewer's resources. */
export class ViewerModal {
  /** The viewer inside the modal, with its full API. */
  readonly viewer: PdfViewer;

  private readonly host = document.createElement('div');
  private readonly dialog = document.createElement('dialog');
  private readonly titleElement = document.createElement('h2');
  private readonly maximizeButton: HTMLButtonElement;
  private readonly settings: PdfSuiteSettings;
  private readonly minWidth: number;
  private readonly minHeight: number;
  private rect: ModalRect;
  private maximized = false;
  private closed = false;
  private readonly unsubscribe: () => void;
  private readonly handleWindowResize = () => this.applyRect();

  constructor(private readonly options: ViewerModalOptions = {}) {
    this.settings = resolveSettings(options.settings, { confirmClose: options.confirmClose, theme: options.theme });
    this.minWidth = options.minWidth ?? DEFAULT_MIN_WIDTH;
    this.minHeight = options.minHeight ?? DEFAULT_MIN_HEIGHT;
    this.rect = this.initialRect();

    const shadow = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = MODAL_CSS;
    const dark = this.settings.theme === 'dark' || (this.settings.theme !== 'light' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
    this.host.dataset.theme = dark ? 'dark' : 'light';
    this.host.dataset.pdfModal = '';

    const frame = document.createElement('div');
    frame.className = 'pm-frame';

    const header = document.createElement('header');
    header.className = 'pm-header';
    this.titleElement.className = 'pm-title';
    this.titleElement.id = 'pm-title';
    this.dialog.setAttribute('aria-labelledby', 'pm-title');
    this.setTitle(options.title ?? options.fileName ?? 'Document');
    this.maximizeButton = this.createHeaderButton('Maximize', MAXIMIZE_ICON, () => this.toggleMaximize());
    this.maximizeButton.hidden = !this.settings.modalMaximizable;
    header.append(this.titleElement, this.maximizeButton, this.createHeaderButton('Close', ICONS.close, () => void this.close()));
    this.dialog.dataset.movable = String(this.settings.modalMovable);
    this.enableMoving(header);

    const viewerHost = document.createElement('div');
    viewerHost.className = 'pm-viewer';
    frame.append(header, viewerHost);
    this.dialog.append(frame);
    if (this.settings.modalResizable) this.dialog.append(...EDGES.map((edge) => this.createHandle(edge)));

    // Esc asks first when there's unsaved work, and the viewer's own uses of Esc are handled before this.
    this.dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      if (this.settings.closeOnEscape) void this.close();
    });

    // The dialog itself is only the target of a click when it lands on the backdrop outside it.
    this.dialog.addEventListener('click', (event) => {
      if (!this.settings.closeOnBackdropClick || event.target !== this.dialog) return;
      const area = this.dialog.getBoundingClientRect();
      const inside = event.clientX >= area.left && event.clientX <= area.right && event.clientY >= area.top && event.clientY <= area.bottom;
      if (!inside) void this.close();
    });

    shadow.append(style, this.dialog);
    document.body.append(this.host);
    this.applyRect();
    this.dialog.showModal();
    window.addEventListener('resize', this.handleWindowResize);

    const { title: _title, width: _width, height: _height, minWidth: _minWidth, minHeight: _minHeight, confirmClose: _confirmClose, onClose: _onClose, ...viewerOptions } = options;
    this.viewer = new PdfViewer(viewerHost, viewerOptions);
    this.unsubscribe = this.viewer.on('documentLoaded', ({ fileName }) => {
      if (!options.title) this.setTitle(fileName);
    });
  }

  get isMaximized(): boolean {
    return this.maximized;
  }

  /** The modal's current position and size, in pixels. */
  get bounds(): Readonly<ModalRect> {
    return { ...this.rect };
  }

  load(source: DocumentSource, fileName?: string): Promise<void> {
    return this.viewer.load(source, fileName);
  }

  setTitle(title: string): void {
    this.titleElement.textContent = title;
  }

  toggleMaximize(): void {
    this.maximized = !this.maximized;
    this.dialog.dataset.maximized = String(this.maximized);
    this.maximizeButton.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${this.maximized ? RESTORE_ICON : MAXIMIZE_ICON}</svg>`;
    const label = this.maximized ? 'Restore size' : 'Maximize';
    this.maximizeButton.title = label;
    this.maximizeButton.setAttribute('aria-label', label);
    this.applyRect();
  }

  /** Closes the modal. Returns false if the user chose to keep working. Use force to skip the unsaved changes question. */
  async close(force = false): Promise<boolean> {
    if (this.closed) return true;
    if (!force && this.settings.confirmClose && this.viewer.hasUnsavedChanges && !(await this.confirmDiscard())) return false;
    if (this.closed) return true;

    this.closed = true;
    if (!this.maximized && this.settings.rememberModalSize) rememberedRect = this.rect;
    window.removeEventListener('resize', this.handleWindowResize);
    this.unsubscribe();
    this.viewer.destroy();
    this.dialog.close();
    this.host.remove();
    this.options.onClose?.();
    return true;
  }

  private initialRect(): ModalRect {
    const { innerWidth, innerHeight } = window;
    const remembered = this.settings.rememberModalSize ? rememberedRect : null;
    const width = this.options.width ?? remembered?.width ?? innerWidth * DEFAULT_WIDTH_RATIO;
    const height = this.options.height ?? remembered?.height ?? innerHeight * DEFAULT_HEIGHT_RATIO;
    const fittedWidth = Math.min(width, innerWidth);
    const fittedHeight = Math.min(height, innerHeight);
    return { width: fittedWidth, height: fittedHeight, left: (innerWidth - fittedWidth) / 2, top: (innerHeight - fittedHeight) / 2 };
  }

  private applyRect(): void {
    const { innerWidth, innerHeight } = window;
    // Small screens have no room for a floating window, so it fills them.
    const fill = this.maximized || innerWidth < PHONE_WIDTH;
    if (fill) {
      Object.assign(this.dialog.style, { left: '0', top: '0', width: '100vw', height: '100dvh' });
      return;
    }

    this.rect.width = Math.max(Math.min(this.rect.width, innerWidth), Math.min(this.minWidth, innerWidth));
    this.rect.height = Math.max(Math.min(this.rect.height, innerHeight), Math.min(this.minHeight, innerHeight));
    this.rect.left = Math.min(Math.max(this.rect.left, HEADER_KEEP_VISIBLE - this.rect.width), innerWidth - HEADER_KEEP_VISIBLE);
    this.rect.top = Math.min(Math.max(this.rect.top, 0), innerHeight - HEADER_KEEP_VISIBLE);

    Object.assign(this.dialog.style, {
      left: `${this.rect.left}px`,
      top: `${this.rect.top}px`,
      width: `${this.rect.width}px`,
      height: `${this.rect.height}px`,
    });
  }

  private createHeaderButton(label: string, icon: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pm-button';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>`;
    button.addEventListener('click', onClick);
    return button;
  }

  private enableMoving(header: HTMLElement): void {
    header.addEventListener('dblclick', (event) => {
      if (this.settings.modalMaximizable && !(event.target as HTMLElement).closest('button')) this.toggleMaximize();
    });
    header.addEventListener('pointerdown', (event) => {
      if (!this.settings.modalMovable || event.button !== 0 || this.maximized || (event.target as HTMLElement).closest('button')) return;
      const start = { x: event.clientX, y: event.clientY, left: this.rect.left, top: this.rect.top };
      this.trackPointer(header, event, (moved) => {
        this.rect.left = start.left + moved.clientX - start.x;
        this.rect.top = start.top + moved.clientY - start.y;
        this.applyRect();
      });
    });
  }

  private createHandle(edge: ResizeEdge): HTMLElement {
    const handle = document.createElement('div');
    handle.className = 'pm-handle';
    handle.dataset.edge = edge;

    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const start = { x: event.clientX, y: event.clientY, ...this.rect };
      this.trackPointer(handle, event, (moved) => this.resizeFrom(edge, start, moved.clientX - start.x, moved.clientY - start.y));
    });

    // The corner handle gives keyboard users a way to resize.
    if (edge === 'se') {
      handle.tabIndex = 0;
      handle.setAttribute('role', 'slider');
      handle.setAttribute('aria-label', 'Resize. Use the arrow keys');
      handle.setAttribute('aria-valuetext', 'Resizable');
      handle.addEventListener('keydown', (event) => {
        const steps: Record<string, [number, number]> = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] };
        const step = steps[event.key];
        if (!step) return;
        event.preventDefault();
        this.resizeFrom('se', this.rect, step[0] * KEYBOARD_STEP, step[1] * KEYBOARD_STEP);
      });
    }
    return handle;
  }

  private resizeFrom(edge: ResizeEdge, start: ModalRect, dx: number, dy: number): void {
    const { innerWidth, innerHeight } = window;
    let { left, top, width, height } = start;

    if (edge.includes('e')) width = Math.min(Math.max(start.width + dx, this.minWidth), innerWidth - start.left);
    if (edge.includes('s')) height = Math.min(Math.max(start.height + dy, this.minHeight), innerHeight - start.top);
    if (edge.includes('w')) {
      const right = start.left + start.width;
      left = Math.max(Math.min(start.left + dx, right - this.minWidth), 0);
      width = right - left;
    }
    if (edge.includes('n')) {
      const bottom = start.top + start.height;
      top = Math.max(Math.min(start.top + dy, bottom - this.minHeight), 0);
      height = bottom - top;
    }

    this.rect = { left, top, width, height };
    this.applyRect();
  }

  private trackPointer(element: HTMLElement, event: PointerEvent, onMove: (moved: PointerEvent) => void): void {
    element.setPointerCapture(event.pointerId);
    const finish = () => {
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerup', finish);
      element.removeEventListener('pointercancel', finish);
    };
    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerup', finish);
    element.addEventListener('pointercancel', finish);
  }

  private confirmDiscard(): Promise<boolean> {
    const existing = this.dialog.querySelector('.pm-confirm');
    if (existing) return Promise.resolve(false);

    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'pm-confirm';
      const box = document.createElement('div');
      box.className = 'pm-confirm-box';
      box.setAttribute('role', 'alertdialog');
      box.setAttribute('aria-labelledby', 'pm-confirm-title');
      const heading = document.createElement('h3');
      heading.id = 'pm-confirm-title';
      heading.textContent = 'Discard your changes?';
      const message = document.createElement('p');
      message.textContent = "This document has changes you haven't saved.";
      const actions = document.createElement('div');
      actions.className = 'pm-confirm-actions';

      const finish = (result: boolean) => {
        overlay.remove();
        resolve(result);
      };
      const addAction = (label: string, onClick: () => void, primary = false) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'pm-action';
        button.textContent = label;
        if (primary) button.dataset.primary = '';
        button.addEventListener('click', onClick);
        actions.append(button);
        return button;
      };

      addAction('Discard', () => finish(true));
      if (this.settings.allowDownload) {
        addAction('Download and close', () => {
          void this.viewer.download().then(() => finish(!this.viewer.hasUnsavedChanges));
        });
      }
      const keep = addAction('Keep editing', () => finish(false), true);

      overlay.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finish(false);
        }
      });
      box.append(heading, message, actions);
      overlay.append(box);
      this.dialog.append(overlay);
      keep.focus();
    });
  }
}

/** Opens a document in a resizable modal. */
export function openViewerModal(options: ViewerModalOptions = {}): ViewerModal {
  return new ViewerModal(options);
}
