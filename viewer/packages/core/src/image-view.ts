import Viewer from 'viewerjs';
import viewerCss from 'viewerjs/dist/viewer.css?inline';
import type { PageSize } from './types';

export const IMAGE_VIEW_CSS = `${viewerCss}
.pv-image { position: absolute; inset: 0; overflow: hidden; background: var(--pv-bg); }
.pv-image > img { display: none; }
.pv-image .viewer-container { position: absolute; inset: 0; width: 100% !important; height: 100% !important; background: transparent; }
.pv-image .viewer-backdrop { background: transparent; }
.pv-image .viewer-canvas { background: transparent; }
.pv-image-overlay { position: absolute; left: 0; top: 0; pointer-events: none; }
.pv-image-layer { position: absolute; left: 0; top: 0; transform-origin: 0 0; pointer-events: none; }
`;

const FIT_PADDING = 0.95;

interface ImageState {
  ratio: number;
  rotate?: number;
  scaleX?: number;
  scaleY?: number;
  x: number;
  y: number;
  naturalWidth: number;
  naturalHeight: number;
}

/**
 * Displays an image with Viewer.js, inside the viewer's shadow root. A layer for annotations follows the image
 * by copying its position and transform, so plugins draw in fixed coordinates however it's zoomed, moved or turned.
 */
export class ImageView {
  private observer: MutationObserver | null = null;
  private fitMode: 'width' | 'page' | null = null;
  private hostWidth = 0;
  private hostHeight = 0;

  private constructor(
    private readonly element: HTMLElement,
    private readonly viewer: Viewer,
    private readonly url: string,
    /** Where plugins draw. Its size in pixels is the logical page size given to open. */
    readonly layer: HTMLElement,
  ) {}

  /** Checks that the browser can decode the image before anything on screen changes. */
  static async validate(bytes: Uint8Array, mimeType: string): Promise<{ url: string; width: number; height: number }> {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeType }));
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      return { url, width: image.naturalWidth, height: image.naturalHeight };
    } catch {
      URL.revokeObjectURL(url);
      throw new Error('This image is damaged, or this browser cannot display its format.');
    }
  }

  static open(parent: HTMLElement, url: string, name: string, size: PageSize, onZoom: (ratio: number) => void): Promise<ImageView> {
    return new Promise((resolve) => {
      const element = document.createElement('div');
      element.className = 'pv-image';
      const image = document.createElement('img');
      image.src = url;
      image.alt = name;
      element.append(image);
      parent.append(element);

      const viewer = new Viewer(image, {
        inline: true,
        navbar: false,
        title: false,
        button: false,
        backdrop: false,
        transition: false,
        toolbar: false,
        minZoomRatio: 0.02,
        maxZoomRatio: 32,
        zoomed: (event) => onZoom(event.detail.ratio),
        viewed: () => {
          const view = new ImageView(element, viewer, url, createLayer(size));
          view.attachLayer(size);
          onZoom(view.ratio);
          resolve(view);
        },
      });
    });
  }

  private get state(): ImageState {
    return (this.viewer as unknown as { imageData: ImageState }).imageData;
  }

  get ratio(): number {
    return this.state?.ratio ?? 1;
  }

  zoomTo(ratio: number): void {
    this.fitMode = null;
    this.viewer.zoomTo(ratio);
  }

  /** Fits the image to the view, and unlike Viewer.js's reset, it keeps any rotation or flip. */
  fit(mode: 'width' | 'page'): void {
    const { naturalWidth, naturalHeight, rotate = 0 } = this.state;
    const sideways = Math.abs(rotate) % 180 === 90;
    const shownWidth = sideways ? naturalHeight : naturalWidth;
    const shownHeight = sideways ? naturalWidth : naturalHeight;
    const hostWidth = this.element.clientWidth;
    const hostHeight = this.element.clientHeight;
    this.fitMode = mode;
    const widthRatio = hostWidth / shownWidth;
    const ratio = (mode === 'width' ? widthRatio : Math.min(widthRatio, hostHeight / shownHeight)) * FIT_PADDING;

    this.viewer.zoomTo(ratio);
    this.viewer.moveTo((hostWidth - naturalWidth * ratio) / 2, (hostHeight - naturalHeight * ratio) / 2);
  }

  rotate(degrees: number): void {
    this.viewer.rotate(degrees);
  }

  flip(axis: 'horizontal' | 'vertical'): void {
    if (axis === 'horizontal') this.viewer.scaleX(-(this.state.scaleX ?? 1));
    else this.viewer.scaleY(-(this.state.scaleY ?? 1));
  }

  /**
   * Handles a change in the host's size. Viewer.js's own resize would put the image back to its default zoom,
   * so it's only told the new size. The image then refits, or keeps its zoom and stays centred.
   */
  resize(): void {
    const { clientWidth, clientHeight } = this.element;
    if (clientWidth === 0 || clientHeight === 0) return;
    const shiftX = (clientWidth - this.hostWidth) / 2;
    const shiftY = (clientHeight - this.hostHeight) / 2;
    this.hostWidth = clientWidth;
    this.hostHeight = clientHeight;

    const internals = this.viewer as unknown as { initViewer(): void; renderViewer(): void };
    internals.initViewer();
    internals.renderViewer();

    if (this.fitMode) this.fit(this.fitMode);
    else this.viewer.moveTo(this.state.x + shiftX, this.state.y + shiftY);
  }

  destroy(): void {
    this.observer?.disconnect();
    this.viewer.destroy();
    this.element.remove();
    URL.revokeObjectURL(this.url);
  }

  private attachLayer(size: PageSize): void {
    this.hostWidth = this.element.clientWidth;
    this.hostHeight = this.element.clientHeight;
    const { image, canvas } = this.viewer as unknown as { image: HTMLImageElement; canvas: HTMLElement };
    const overlay = document.createElement('div');
    overlay.className = 'pv-image-overlay';
    overlay.append(this.layer);
    canvas.append(overlay);

    const sync = () => {
      const { width, height, marginLeft, marginTop, transform } = image.style;
      Object.assign(overlay.style, { width, height, marginLeft, marginTop, transform });
      this.layer.style.transform = `scale(${Number.parseFloat(width) / size.width})`;
    };
    this.observer = new MutationObserver(sync);
    this.observer.observe(image, { attributes: true, attributeFilter: ['style'] });
    sync();
  }
}

function createLayer(size: PageSize): HTMLElement {
  const layer = document.createElement('div');
  layer.className = 'pv-image-layer';
  layer.style.width = `${size.width}px`;
  layer.style.height = `${size.height}px`;
  return layer;
}
