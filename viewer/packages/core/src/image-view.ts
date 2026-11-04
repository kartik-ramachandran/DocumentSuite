import Viewer from 'viewerjs';
import viewerCss from 'viewerjs/dist/viewer.css?inline';

export const IMAGE_VIEW_CSS = `${viewerCss}
.pv-image { position: absolute; inset: 0; overflow: hidden; background: var(--pv-bg); }
.pv-image > img { display: none; }
.pv-image .viewer-container { position: absolute; inset: 0; width: 100% !important; height: 100% !important; background: transparent; }
.pv-image .viewer-backdrop { background: transparent; }
.pv-image .viewer-canvas { background: transparent; }
.pv-image .viewer-toolbar > ul > li:focus-visible { outline: 2px solid var(--pv-accent); outline-offset: 1px; }
`;

const TOOLBAR_LABELS: Record<string, string> = {
  'zoom-in': 'Zoom in',
  'zoom-out': 'Zoom out',
  'one-to-one': 'Actual size',
  reset: 'Fit to view',
  'rotate-left': 'Rotate left',
  'rotate-right': 'Rotate right',
  'flip-horizontal': 'Flip horizontally',
  'flip-vertical': 'Flip vertically',
};

/** Displays an image with Viewer.js, inside the viewer's shadow root. */
export class ImageView {
  private constructor(
    private readonly element: HTMLElement,
    private readonly viewer: Viewer,
    private readonly url: string,
  ) {}

  /** Checks that the browser can decode the image before anything on screen changes. */
  static async validate(bytes: Uint8Array, mimeType: string): Promise<string> {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeType }));
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      return url;
    } catch {
      URL.revokeObjectURL(url);
      throw new Error('This image is damaged, or this browser cannot display its format.');
    }
  }

  static open(parent: HTMLElement, url: string, name: string, onZoom: (ratio: number) => void): Promise<ImageView> {
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
        toolbar: { zoomIn: 1, zoomOut: 1, oneToOne: 1, reset: 1, rotateLeft: 1, rotateRight: 1, flipHorizontal: 1, flipVertical: 1 },
        minZoomRatio: 0.02,
        maxZoomRatio: 32,
        zoomed: (event) => onZoom(event.detail.ratio),
        ready: () => {
          makeToolbarAccessible(element);
          resolve(new ImageView(element, viewer, url));
        },
      });
    });
  }

  get ratio(): number {
    return (this.viewer as unknown as { imageData?: { ratio?: number } }).imageData?.ratio ?? 1;
  }

  zoomTo(ratio: number): void {
    this.viewer.zoomTo(ratio);
  }

  zoomBy(ratio: number): void {
    this.viewer.zoom(ratio);
  }

  fit(): void {
    this.viewer.reset();
  }

  rotate(degrees: number): void {
    this.viewer.rotate(degrees);
  }

  /** Viewer.js only watches the window, so changes to the host element's size are passed on. */
  resize(): void {
    (this.viewer as unknown as { resize(): void }).resize();
  }

  destroy(): void {
    this.viewer.destroy();
    this.element.remove();
    URL.revokeObjectURL(this.url);
  }
}

// The toolbar is built from plain list items, so they need names and keyboard support added.
function makeToolbarAccessible(root: HTMLElement): void {
  root.querySelector('.viewer-toolbar ul')?.setAttribute('role', 'toolbar');
  root.querySelector('.viewer-toolbar ul')?.setAttribute('aria-label', 'Image tools');
  root.querySelectorAll<HTMLElement>('.viewer-toolbar li').forEach((button) => {
    const action = button.dataset.viewerAction;
    const label = (action && TOOLBAR_LABELS[action]) ?? action ?? 'Image tool';
    button.setAttribute('role', 'button');
    button.setAttribute('aria-label', label);
    button.title = label;
    button.tabIndex = 0;
    button.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        button.click();
      }
    });
  });
}
