import type { PageSize, ViewerContext } from '@pdf-suite/viewer';

const SVG_NS = 'http://www.w3.org/2000/svg';
const WATERMARK_COLOR = '#6b7280';
const WATERMARK_ANGLE = 45;
const MIN_FONT_SIZE = 12;
const MAX_FONT_SIZE = 96;
const AVERAGE_CHARACTER_WIDTH = 0.6;
export const WATERMARK_LINE_HEIGHT = 1.2;

const WATERMARK_CSS = `
.pv-watermark { position: absolute; inset: 0; width: 100%; height: 100%; overflow: hidden; pointer-events: none; user-select: none; }
`;

export function watermarkLines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

/** A size that keeps the text inside the page when it's drawn diagonally. */
export function watermarkFontSize(text: string, size: PageSize): number {
  const lines = watermarkLines(text);
  const longest = Math.max(...lines.map((line) => line.length), 1);
  const available = Math.min(size.width, size.height) * 1.2;
  const fitted = Math.min(available / (longest * AVERAGE_CHARACTER_WIDTH), available / (Math.max(lines.length, 1) * WATERMARK_LINE_HEIGHT));
  return Math.min(Math.max(fitted, MIN_FONT_SIZE), MAX_FONT_SIZE);
}

/** Shows the watermark setting's text on every page, and adds it to prints and exports. */
export class WatermarkController {
  private paused = false;

  constructor(private readonly context: ViewerContext) {}

  private get text(): string {
    return this.context.settings.watermarkText.trim();
  }

  install(): void {
    const { context } = this;
    const { watermark, watermarkOpacity } = context.settings;
    if (!watermark || !this.text) return;

    context.addStyles(WATERMARK_CSS);
    context.viewer.on('pageLayersReady', ({ layer, size }) => this.showOnPage(layer, size));

    // A file can't be passed through as uploaded, because it needs the watermark added.
    context.addImageChangeCheck(() => !this.paused);

    context.addExportStep(async (bytes) => {
      if (this.paused) return bytes;
      // The PDF writer is large, so it's only loaded when there's something to write.
      const { writeWatermark } = await import('./pdf-export');
      return writeWatermark(bytes, this.text, watermarkOpacity, WATERMARK_COLOR, WATERMARK_ANGLE);
    });

    context.addPrintPainter((canvas, _pageNumber, size) => {
      if (this.paused) return;
      canvas.save();
      canvas.translate(size.width / 2, size.height / 2);
      canvas.rotate((-WATERMARK_ANGLE * Math.PI) / 180);
      canvas.globalAlpha = watermarkOpacity;
      canvas.fillStyle = WATERMARK_COLOR;
      const fontSize = watermarkFontSize(this.text, size);
      canvas.font = `bold ${fontSize}px Helvetica, Arial, sans-serif`;
      canvas.textAlign = 'center';
      canvas.textBaseline = 'middle';
      const lines = watermarkLines(this.text);
      lines.forEach((line, index) => canvas.fillText(line, 0, (index - (lines.length - 1) / 2) * fontSize * WATERMARK_LINE_HEIGHT));
      canvas.restore();
    });
  }

  /**
   * Reads the document without the watermark. Document tools use this when their result comes back into
   * the viewer, because the watermark would otherwise become part of the document and stack on every export.
   */
  async withoutWatermark<T>(read: () => Promise<T>): Promise<T> {
    this.paused = true;
    try {
      return await read();
    } finally {
      this.paused = false;
    }
  }

  private showOnPage(layer: HTMLElement, size: PageSize): void {
    layer.querySelector(':scope > .pv-watermark')?.remove();
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.classList.add('pv-watermark');
    svg.setAttribute('viewBox', `0 0 ${size.width} ${size.height}`);
    svg.setAttribute('aria-hidden', 'true');

    const x = size.width / 2;
    const y = size.height / 2;
    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', String(x));
    text.setAttribute('y', String(y));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.setAttribute('transform', `rotate(${-WATERMARK_ANGLE} ${x} ${y})`);
    text.setAttribute('fill', WATERMARK_COLOR);
    text.setAttribute('fill-opacity', String(this.context.settings.watermarkOpacity));
    text.setAttribute('font-family', 'Helvetica, Arial, sans-serif');
    text.setAttribute('font-weight', 'bold');
    text.setAttribute('font-size', String(watermarkFontSize(this.text, size)));
    const lines = watermarkLines(this.text);
    lines.forEach((line, index) => {
      const span = document.createElementNS(SVG_NS, 'tspan');
      span.setAttribute('x', String(x));
      span.setAttribute('dy', `${index === 0 ? (-(lines.length - 1) / 2) * WATERMARK_LINE_HEIGHT : WATERMARK_LINE_HEIGHT}em`);
      span.textContent = line;
      text.append(span);
    });
    svg.append(text);
    layer.prepend(svg);
  }
}
