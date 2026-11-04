import type { PageSize, ViewerContext } from '@document-suite/viewer';
import type { Annotation, AnnotationTool, Point, Rect } from './annotation-types';

const SVG_NS = 'http://www.w3.org/2000/svg';
const DOUBLE_CLICK_MS = 400;
const DEFAULT_COLORS: Record<string, string> = { highlight: '#ffd400', ink: '#c62828', rect: '#c62828', text: '#1c2230', note: '#f5a623', stamp: '#000000' };
const INK_WIDTH = 2;
const TEXT_SIZE = 14;
const STAMP_WIDTH = 140;
const NOTE_SIZE = 18;
const MIN_DRAG = 3;
const MAX_HISTORY = 100;

const ICONS: Record<Exclude<AnnotationTool, null>, string> = {
  select: '<path d="m5 3 14 8-6 2-2 6z"/>',
  highlight: '<path d="m4 20 5-1 10-10-4-4L5 15z"/><path d="M3 22h18"/>',
  ink: '<path d="M3 17c3-6 6-9 8-8s-2 7 1 8 5-5 9-6"/>',
  rect: '<rect x="4" y="5" width="16" height="14" rx="1"/>',
  text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  note: '<path d="M4 4h16v12H9l-5 4z"/>',
  stamp: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5L5 20"/>',
};
const LABELS: Record<Exclude<AnnotationTool, null>, string> = {
  select: 'Select annotations',
  highlight: 'Highlight text',
  ink: 'Draw',
  rect: 'Draw a rectangle',
  text: 'Add text',
  note: 'Add a comment',
  stamp: 'Add a picture or signature',
};

export const ANNOTATION_CSS = `
.pv-annotations { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
.pv-annotations[data-active='true'] { pointer-events: auto; cursor: crosshair; touch-action: none; }
.pv-annotations[data-tool='select'] { cursor: default; }
.pv-annotations [data-annotation] { pointer-events: auto; }
.pv-annotations:not([data-tool='select']) [data-annotation] { pointer-events: none; }
.pv-annotations:not([data-tool]) [data-kind='note'], .pv-annotations[data-tool='note'] [data-kind='note'] { pointer-events: auto; cursor: pointer; }
.pv-annotations [data-selected='true'] { filter: drop-shadow(0 0 2px #2f5fd0) drop-shadow(0 0 2px #2f5fd0); }
.pv-text-editor { position: absolute; z-index: 4; min-width: 120px; padding: 1px 2px; border: 1px dashed var(--pv-accent); background: rgba(255, 255, 255, 0.9); color: #111; font-family: Helvetica, Arial, sans-serif; line-height: 1.2; resize: both; pointer-events: auto; }
.pv-color { width: 28px; height: 28px; padding: 2px; border: 1px solid var(--pv-border); border-radius: 5px; background: transparent; cursor: pointer; }
`;

interface PageLayer {
  svg: SVGSVGElement;
  host: HTMLElement;
  size: PageSize;
}

/** Drawing, comments and stamps. Coordinates are points from the top-left of the page. */
export class AnnotationController {
  private annotations: Annotation[] = [];
  private undoStack: Annotation[][] = [];
  private redoStack: Annotation[][] = [];
  private layers = new Map<number, PageLayer>();
  private buttons = new Map<Exclude<AnnotationTool, null>, HTMLButtonElement>();
  private tool: AnnotationTool = null;
  /** Closes the open text box and saves it, while one is open. */
  private finishTextEdit: (() => void) | null = null;
  private editingId: string | null = null;
  private lastPress: { id: string; time: number } | null = null;
  private selectedId: string | null = null;
  private color: string | null = null;
  private nextId = 1;
  private pendingStamp: { dataUrl: string; ratio: number } | null = null;
  private readonly changeListeners = new Set<(annotations: Annotation[]) => void>();
  private readonly unsubscribes: Array<() => void> = [];
  private fileInput!: HTMLInputElement;

  constructor(private readonly context: ViewerContext) {}

  install(): void {
    const { context } = this;
    context.addStyles(ANNOTATION_CSS);
    for (const tool of Object.keys(ICONS) as Array<Exclude<AnnotationTool, null>>) {
      const button = context.addToolbarButton({ id: `annotate-${tool}`, label: LABELS[tool], icon: ICONS[tool], toggle: true, group: 'annotate', onClick: () => this.setTool(this.tool === tool ? null : tool) });
      this.buttons.set(tool, button);
    }

    const group = this.buttons.get('select')!.parentElement!;
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'pv-color';
    colorInput.value = DEFAULT_COLORS.ink;
    colorInput.title = 'Annotation color';
    colorInput.setAttribute('aria-label', 'Annotation color');
    colorInput.addEventListener('input', () => {
      this.color = colorInput.value;
      this.recolorSelection(colorInput.value);
    });
    group.append(colorInput);

    context.addToolbarButton({ id: 'annotate-undo', label: 'Undo', icon: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>', group: 'annotate', onClick: () => this.undo() });
    context.addToolbarButton({ id: 'annotate-redo', label: 'Redo', icon: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>', group: 'annotate', onClick: () => this.redo() });

    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'image/png,image/jpeg';
    this.fileInput.className = 'pv-file-input';
    this.fileInput.setAttribute('aria-label', 'Choose a picture');
    this.fileInput.addEventListener('change', () => void this.handleStampFile());
    context.root.append(this.fileInput);

    this.unsubscribes.push(
      context.viewer.on('pageLayersReady', ({ pageNumber, layer, size }) => this.createLayer(pageNumber, layer, size)),
      context.viewer.on('documentLoaded', () => this.resetForNewDocument()),
    );
    context.root.addEventListener('keydown', (event) => this.handleKey(event as KeyboardEvent));
    context.addPrintPainter((canvas, pageNumber, _size, target) => this.paintForPrint(canvas, pageNumber, target));
    context.addImageChangeCheck(() => this.annotations.length > 0);
  }

  destroy(): void {
    this.unsubscribes.forEach((unsubscribe) => unsubscribe());
    this.changeListeners.clear();
  }

  // ── Public API ─────────────────────────────────────────────────────

  getAnnotations(): Annotation[] {
    return structuredClone(this.annotations);
  }

  /** Restores saved annotations, such as ones returned earlier by getAnnotations. */
  setAnnotations(annotations: Annotation[]): void {
    this.commit(() => {
      this.annotations = structuredClone(annotations);
    });
  }

  clear(): void {
    this.commit(() => {
      this.annotations = [];
    });
    this.undoStack = [];
    this.redoStack = [];
  }

  onChange(listener: (annotations: Annotation[]) => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  setTool(tool: AnnotationTool): void {
    if (tool === 'stamp') {
      this.fileInput.click();
      return;
    }
    this.applyTool(tool);
  }

  undo(): void {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.context.markChanged();
    this.redoStack.push(this.annotations);
    this.annotations = previous;
    this.selectedId = null;
    this.afterChange();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.context.markChanged();
    this.undoStack.push(this.annotations);
    this.annotations = next;
    this.selectedId = null;
    this.afterChange();
  }

  // ── Tools ──────────────────────────────────────────────────────────

  private applyTool(tool: AnnotationTool): void {
    this.finishTextEdit?.();
    this.tool = tool;
    this.selectedId = null;
    for (const [name, button] of this.buttons) button.setAttribute('aria-pressed', String(name === tool));
    for (const { svg } of this.layers.values()) {
      svg.dataset.active = String(tool !== null);
      if (tool) svg.dataset.tool = tool;
      else delete svg.dataset.tool;
    }
    this.renderAll();
  }

  private async handleStampFile(): Promise<void> {
    const file = this.fileInput.files?.[0];
    this.fileInput.value = '';
    if (!file) return;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    this.pendingStamp = { dataUrl, ratio: image.naturalHeight / Math.max(image.naturalWidth, 1) };
    this.applyTool('stamp');
    this.context.notify('Click on the page to place the picture.');
  }

  private colorFor(kind: string): string {
    return this.color ?? DEFAULT_COLORS[kind];
  }

  private createId(): string {
    return `a${this.nextId++}`;
  }

  private commit(change: () => void): void {
    this.context.markChanged();
    this.undoStack.push(this.annotations);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
    this.annotations = [...this.annotations];
    change();
    this.afterChange();
  }

  private afterChange(): void {
    this.renderAll();
    const snapshot = this.getAnnotations();
    this.changeListeners.forEach((listener) => listener(snapshot));
  }

  private recolorSelection(color: string): void {
    if (!this.selectedId) return;
    const id = this.selectedId;
    this.commit(() => {
      this.annotations = this.annotations.map((annotation) => (annotation.id === id ? { ...annotation, color } : annotation));
    });
  }

  private resetForNewDocument(): void {
    this.annotations = [];
    this.undoStack = [];
    this.redoStack = [];
    this.selectedId = null;
    this.renderAll();
  }

  private handleKey(event: KeyboardEvent): void {
    const target = event.composedPath()[0] as HTMLElement;
    if (target.matches?.('input, textarea, select')) return;
    const isModifier = event.ctrlKey || event.metaKey;
    if (isModifier && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) this.redo();
      else this.undo();
    } else if (isModifier && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      this.redo();
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && this.selectedId) {
      event.preventDefault();
      const id = this.selectedId;
      this.selectedId = null;
      this.commit(() => {
        this.annotations = this.annotations.filter((annotation) => annotation.id !== id);
      });
    } else if (event.key === 'Escape' && this.tool) {
      event.preventDefault();
      event.stopPropagation();
      this.applyTool(null);
    }
  }

  // ── Page layers ────────────────────────────────────────────────────

  private createLayer(pageNumber: number, host: HTMLElement, size: PageSize): void {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.classList.add('pv-annotations');
    svg.setAttribute('viewBox', `0 0 ${size.width} ${size.height}`);
    svg.dataset.page = String(pageNumber);
    svg.dataset.active = String(this.tool !== null);
    if (this.tool) svg.dataset.tool = this.tool;
    host.append(svg);
    this.layers.set(pageNumber, { svg, host, size });
    svg.addEventListener('pointerdown', (event) => this.handlePointerDown(event, pageNumber));
    // While a tool is active, a double click belongs to the tool, not the image viewer's zoom.
    svg.addEventListener('dblclick', (event) => event.stopPropagation());
    this.renderPage(pageNumber);
  }

  private toPagePoint(event: PointerEvent, svg: SVGSVGElement): Point {
    const matrix = svg.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: point.y };
  }

  private handlePointerDown(event: PointerEvent, pageNumber: number): void {
    if (event.button !== 0) return;
    const note = this.tool === null || this.tool === 'note' ? this.noteAt(event) : undefined;
    if (!note && !this.tool && !this.finishTextEdit) return;
    const layer = this.layers.get(pageNumber)!;
    event.preventDefault();
    // On images, this stops the viewer underneath dragging the picture while a tool is in use.
    event.stopPropagation();

    // A click away from an open text box only closes it, rather than starting another one.
    if (this.finishTextEdit) {
      this.finishTextEdit();
      return;
    }
    const start = this.toPagePoint(event, layer.svg);
    if (note) {
      void this.editNote(note.page, start, note);
      return;
    }

    switch (this.tool) {
      case 'select':
        this.beginMove(event, layer, start);
        break;
      case 'ink':
        this.beginInk(event, layer, pageNumber, start);
        break;
      case 'rect':
      case 'highlight':
        this.beginDrag(event, layer, pageNumber, start, this.tool);
        break;
      case 'text':
        this.editText(layer, pageNumber, start);
        break;
      case 'note':
        void this.editNote(pageNumber, start);
        break;
      case 'stamp':
        this.placeStamp(pageNumber, start);
        break;
    }
  }

  private noteAt(event: PointerEvent): Extract<Annotation, { kind: 'note' }> | undefined {
    const id = (event.target as Element).closest?.('[data-kind="note"]')?.getAttribute('data-annotation');
    const annotation = this.annotations.find((item) => item.id === id);
    return annotation?.kind === 'note' ? annotation : undefined;
  }

  private editAnnotation(annotation: Annotation): void {
    if (annotation.kind === 'note') void this.editNote(annotation.page, annotation, annotation);
    else if (annotation.kind === 'text') this.editText(this.layers.get(annotation.page)!, annotation.page, annotation, annotation);
  }

  private trackPointer(event: PointerEvent, svg: SVGSVGElement, onMove: (point: Point) => void, onEnd: (point: Point) => void): void {
    svg.setPointerCapture(event.pointerId);
    const move = (next: PointerEvent) => onMove(this.toPagePoint(next, svg));
    const finish = (next: PointerEvent) => {
      svg.removeEventListener('pointermove', move);
      svg.removeEventListener('pointerup', finish);
      svg.removeEventListener('pointercancel', finish);
      onEnd(this.toPagePoint(next, svg));
    };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerup', finish);
    svg.addEventListener('pointercancel', finish);
  }

  private beginInk(event: PointerEvent, layer: PageLayer, pageNumber: number, start: Point): void {
    const color = this.colorFor('ink');
    const points = [start];
    const preview = document.createElementNS(SVG_NS, 'polyline');
    preview.setAttribute('fill', 'none');
    preview.setAttribute('stroke', color);
    preview.setAttribute('stroke-width', String(INK_WIDTH));
    preview.setAttribute('stroke-linecap', 'round');
    preview.setAttribute('stroke-linejoin', 'round');
    layer.svg.append(preview);

    this.trackPointer(event, layer.svg, (point) => {
      points.push(point);
      preview.setAttribute('points', points.map((p) => `${p.x},${p.y}`).join(' '));
    }, () => {
      preview.remove();
      if (points.length < 2) return;
      const annotation: Annotation = { id: this.createId(), kind: 'ink', page: pageNumber, color, strokes: [points], width: INK_WIDTH };
      this.commit(() => this.annotations.push(annotation));
    });
  }

  private beginDrag(event: PointerEvent, layer: PageLayer, pageNumber: number, start: Point, kind: 'rect' | 'highlight'): void {
    const color = this.colorFor(kind);
    const preview = document.createElementNS(SVG_NS, 'rect');
    preview.setAttribute('fill', kind === 'highlight' ? color : 'none');
    preview.setAttribute('fill-opacity', '0.4');
    preview.setAttribute('stroke', kind === 'rect' ? color : 'none');
    preview.setAttribute('stroke-width', String(INK_WIDTH));
    layer.svg.append(preview);
    const toRect = (end: Point): Rect => ({ x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) });

    this.trackPointer(event, layer.svg, (point) => {
      const rect = toRect(point);
      preview.setAttribute('x', String(rect.x));
      preview.setAttribute('y', String(rect.y));
      preview.setAttribute('width', String(rect.width));
      preview.setAttribute('height', String(rect.height));
    }, (end) => {
      preview.remove();
      const rect = toRect(end);
      if (rect.width < MIN_DRAG && rect.height < MIN_DRAG) return;
      if (kind === 'rect') {
        const annotation: Annotation = { id: this.createId(), kind: 'rect', page: pageNumber, color, ...rect, strokeWidth: INK_WIDTH };
        this.commit(() => this.annotations.push(annotation));
      } else {
        void this.addHighlight(pageNumber, rect, start, end, color);
      }
    });
  }

  // Dragging over text highlights the words on each line, like selecting in a word processor.
  private async addHighlight(pageNumber: number, drag: Rect, start: Point, end: Point, color: string): Promise<void> {
    const runs = await this.context.viewer.getPageText(pageNumber).catch(() => []);
    const touched = runs.filter((run) => {
      const overlap = Math.min(run.top + run.height, drag.y + drag.height) - Math.max(run.top, drag.y);
      const crossesX = run.left < drag.x + drag.width && run.left + run.width > drag.x;
      return overlap > Math.min(run.height, drag.height) * 0.4 && crossesX;
    });

    let rects: Rect[];
    if (touched.length === 0) {
      rects = [drag];
    } else {
      const firstLineTop = Math.min(...touched.map((run) => run.top));
      const lastLineTop = Math.max(...touched.map((run) => run.top));
      const startFirst = start.y <= end.y ? start.x : end.x;
      const endLast = start.y <= end.y ? end.x : start.x;
      rects = touched.map((run) => {
        const isFirst = Math.abs(run.top - firstLineTop) < 1;
        const isLast = Math.abs(run.top - lastLineTop) < 1;
        const singleLine = isFirst && isLast;
        const left = singleLine ? Math.max(run.left, drag.x) : isFirst ? Math.max(run.left, startFirst) : run.left;
        const right = singleLine ? Math.min(run.left + run.width, drag.x + drag.width) : isLast ? Math.min(run.left + run.width, endLast) : run.left + run.width;
        return { x: left, y: run.top, width: Math.max(right - left, 0), height: run.height };
      }).filter((rect) => rect.width > 0);
    }

    const annotation: Annotation = { id: this.createId(), kind: 'highlight', page: pageNumber, color, rects };
    this.commit(() => this.annotations.push(annotation));
  }

  private editText(layer: PageLayer, pageNumber: number, start: Point, existing?: Extract<Annotation, { kind: 'text' }>): void {
    const editor = document.createElement('textarea');
    editor.className = 'pv-text-editor';
    editor.style.left = `${start.x}px`;
    editor.style.top = `${start.y}px`;
    editor.style.fontSize = `${existing?.fontSize ?? TEXT_SIZE}px`;
    editor.style.color = existing?.color ?? this.colorFor('text');
    editor.value = existing?.text ?? '';
    editor.setAttribute('aria-label', 'Annotation text');
    layer.host.append(editor);
    setTimeout(() => editor.focus());

    let finished = false;
    const finish = (save: boolean) => {
      if (finished) return;
      finished = true;
      this.finishTextEdit = null;
      this.editingId = null;
      const text = editor.value.trim();
      editor.remove();
      if (existing) {
        if (save && text !== existing.text) {
          this.commit(() => {
            this.annotations = text
              ? this.annotations.map((annotation) => (annotation.id === existing.id ? { ...existing, text } : annotation))
              : this.annotations.filter((annotation) => annotation.id !== existing.id);
          });
        } else {
          this.renderAll();
        }
        return;
      }
      if (!save || !text) return;
      const annotation: Annotation = { id: this.createId(), kind: 'text', page: pageNumber, color: this.colorFor('text'), x: start.x, y: start.y, text, fontSize: TEXT_SIZE };
      this.commit(() => this.annotations.push(annotation));
      this.applyTool(null);
    };
    this.finishTextEdit = () => finish(true);
    if (existing) {
      // The box replaces the text while it's being edited.
      this.editingId = existing.id;
      this.renderAll();
    }
    editor.addEventListener('blur', () => finish(true));
    editor.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) finish(true);
    });
  }

  private async editNote(pageNumber: number, start: Point, existing?: Extract<Annotation, { kind: 'note' }>): Promise<void> {
    const text = await this.askForText(existing ? 'Edit comment' : 'Add a comment', existing?.text ?? '');
    if (text === null) return;
    if (existing) {
      this.commit(() => {
        this.annotations = text
          ? this.annotations.map((annotation) => (annotation.id === existing.id ? { ...existing, text } : annotation))
          : this.annotations.filter((annotation) => annotation.id !== existing.id);
      });
    } else if (text) {
      const annotation: Annotation = { id: this.createId(), kind: 'note', page: pageNumber, color: this.colorFor('note'), x: start.x, y: start.y, text };
      this.commit(() => this.annotations.push(annotation));
      this.applyTool(null);
    }
  }

  private askForText(title: string, initial: string): Promise<string | null> {
    return new Promise((resolve) => {
      const previousFocus = this.context.root.activeElement as HTMLElement | null;
      const form = document.createElement('form');
      form.className = 'pv-dialog';
      form.setAttribute('role', 'dialog');
      form.setAttribute('aria-label', title);
      const heading = document.createElement('h2');
      heading.textContent = title;
      const input = document.createElement('textarea');
      input.className = 'pv-input';
      input.style.height = '90px';
      input.value = initial;
      input.setAttribute('aria-label', title);
      const actions = document.createElement('div');
      actions.className = 'pv-dialog-actions';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'pv-btn';
      cancel.textContent = 'Cancel';
      const save = document.createElement('button');
      save.type = 'submit';
      save.className = 'pv-btn pv-primary';
      save.textContent = 'Save';
      actions.append(cancel, save);
      form.append(heading, input, actions);
      const done = (value: string | null) => {
        form.remove();
        // Keeps focus in the viewer, so its keyboard shortcuts keep working.
        (previousFocus?.isConnected ? previousFocus : this.buttons.get('note'))?.focus();
        resolve(value);
      };
      cancel.addEventListener('click', () => done(null));
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        done(input.value.trim());
      });
      form.addEventListener('keydown', (event) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          done(null);
        }
      });
      this.context.root.querySelector('.pv-root')!.append(form);
      input.focus();
    });
  }

  private placeStamp(pageNumber: number, point: Point): void {
    if (!this.pendingStamp) return;
    const { dataUrl, ratio } = this.pendingStamp;
    const annotation: Annotation = { id: this.createId(), kind: 'stamp', page: pageNumber, color: '#000000', x: point.x, y: point.y, width: STAMP_WIDTH, height: STAMP_WIDTH * ratio, dataUrl };
    this.pendingStamp = null;
    this.commit(() => this.annotations.push(annotation));
    this.applyTool('select');
  }

  private beginMove(event: PointerEvent, layer: PageLayer, start: Point): void {
    const target = (event.target as Element).closest?.('[data-annotation]');
    if (!target) {
      this.selectedId = null;
      this.renderAll();
      return;
    }

    const id = target.getAttribute('data-annotation')!;
    const annotation = this.annotations.find((item) => item.id === id)!;
    // Selecting redraws the annotation, so the browser doesn't see two clicks on one element and never sends dblclick.
    const isDoubleClick = this.lastPress?.id === id && event.timeStamp - this.lastPress.time < DOUBLE_CLICK_MS;
    this.lastPress = isDoubleClick ? null : { id, time: event.timeStamp };
    this.selectedId = id;
    this.context.root.querySelector<HTMLElement>('.pv-scroll')?.focus();
    this.renderAll();
    if (isDoubleClick && (annotation.kind === 'note' || annotation.kind === 'text')) {
      this.editAnnotation(annotation);
      return;
    }

    const element = layer.svg.querySelector<SVGGraphicsElement>(`[data-annotation="${id}"]`);
    let last = start;
    this.trackPointer(event, layer.svg, (point) => {
      last = point;
      element?.setAttribute('transform', `translate(${point.x - start.x} ${point.y - start.y})`);
    }, () => {
      const dx = last.x - start.x;
      const dy = last.y - start.y;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      this.commit(() => {
        this.annotations = this.annotations.map((item) => (item.id === id ? moveAnnotation(item, dx, dy) : item));
      });
    });
  }

  // ── Drawing ────────────────────────────────────────────────────────

  private renderAll(): void {
    for (const pageNumber of this.layers.keys()) this.renderPage(pageNumber);
  }

  private renderPage(pageNumber: number): void {
    const layer = this.layers.get(pageNumber);
    if (!layer) return;
    layer.svg.replaceChildren(...this.annotations.filter((annotation) => annotation.page === pageNumber && annotation.id !== this.editingId).map((annotation) => this.toSvg(annotation)));
  }

  private toSvg(annotation: Annotation): SVGElement {
    const group = document.createElementNS(SVG_NS, 'g');
    group.dataset.annotation = annotation.id;
    group.dataset.kind = annotation.kind;
    if (annotation.id === this.selectedId) group.dataset.selected = 'true';

    const add = (tag: string, attributes: Record<string, string | number>): SVGElement => {
      const node = document.createElementNS(SVG_NS, tag);
      for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
      group.append(node);
      return node;
    };

    switch (annotation.kind) {
      case 'highlight':
        for (const rect of annotation.rects) add('rect', { x: rect.x, y: rect.y, width: rect.width, height: rect.height, fill: annotation.color, 'fill-opacity': 0.4, style: 'mix-blend-mode:multiply' });
        break;
      case 'ink':
        for (const stroke of annotation.strokes) {
          add('polyline', { points: stroke.map((point) => `${point.x},${point.y}`).join(' '), fill: 'none', stroke: annotation.color, 'stroke-width': annotation.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
        }
        break;
      case 'rect':
        add('rect', { x: annotation.x, y: annotation.y, width: annotation.width, height: annotation.height, fill: 'transparent', stroke: annotation.color, 'stroke-width': annotation.strokeWidth });
        break;
      case 'text':
        annotation.text.split('\n').forEach((line, index) => {
          const node = add('text', { x: annotation.x, y: annotation.y + annotation.fontSize * (0.9 + index * 1.2), fill: annotation.color, 'font-size': annotation.fontSize, 'font-family': 'Helvetica, Arial, sans-serif' });
          node.textContent = line;
        });
        break;
      case 'note': {
        add('path', { d: notePath(annotation.x, annotation.y), fill: annotation.color, stroke: '#7a5200', 'stroke-width': 0.7 });
        const title = add('title', {});
        title.textContent = annotation.text;
        break;
      }
      case 'stamp':
        add('image', { x: annotation.x, y: annotation.y, width: annotation.width, height: annotation.height, href: annotation.dataUrl });
        break;
    }
    return group;
  }

  private async paintForPrint(context: CanvasRenderingContext2D, pageNumber: number, target: 'print' | 'image'): Promise<void> {
    for (const annotation of this.annotations) {
      if (annotation.page !== pageNumber) continue;
      context.save();
      context.fillStyle = annotation.color;
      context.strokeStyle = annotation.color;
      switch (annotation.kind) {
        case 'highlight':
          context.globalAlpha = 0.4;
          // Paper is white, so multiplying looks like a real highlighter. On a photo it would turn dark, unlike the view on screen.
          if (target === 'print') context.globalCompositeOperation = 'multiply';
          for (const rect of annotation.rects) context.fillRect(rect.x, rect.y, rect.width, rect.height);
          break;
        case 'ink':
          context.lineWidth = annotation.width;
          context.lineCap = 'round';
          context.lineJoin = 'round';
          for (const stroke of annotation.strokes) {
            context.beginPath();
            stroke.forEach((point, index) => (index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y)));
            context.stroke();
          }
          break;
        case 'rect':
          context.lineWidth = annotation.strokeWidth;
          context.strokeRect(annotation.x, annotation.y, annotation.width, annotation.height);
          break;
        case 'text':
          context.font = `${annotation.fontSize}px Helvetica, Arial, sans-serif`;
          annotation.text.split('\n').forEach((line, index) => context.fillText(line, annotation.x, annotation.y + annotation.fontSize * (0.9 + index * 1.2)));
          break;
        case 'note':
          context.fill(new Path2D(notePath(annotation.x, annotation.y)));
          // An image can't hold a real comment, so its text is drawn beside the icon instead of being lost.
          if (target === 'image') drawNoteText(context, annotation.text, annotation.x + NOTE_SIZE + 3, annotation.y);
          break;
        case 'stamp': {
          const image = new Image();
          image.src = annotation.dataUrl;
          await image.decode();
          context.drawImage(image, annotation.x, annotation.y, annotation.width, annotation.height);
          break;
        }
      }
      context.restore();
    }
  }
}

function notePath(x: number, y: number): string {
  return `M${x} ${y}h${NOTE_SIZE}v${NOTE_SIZE * 0.7}h-${NOTE_SIZE * 0.6}l-${NOTE_SIZE * 0.25} ${NOTE_SIZE * 0.3}v-${NOTE_SIZE * 0.3}h-${NOTE_SIZE * 0.15}z`;
}

function drawNoteText(context: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  const size = 11;
  const padding = 3;
  const lines = text.split('\n');
  context.font = `${size}px Helvetica, Arial, sans-serif`;
  const width = Math.max(...lines.map((line) => context.measureText(line).width));
  context.fillStyle = '#fff4cc';
  context.fillRect(x, y, width + padding * 2, lines.length * size * 1.2 + padding * 2);
  context.fillStyle = '#1c2230';
  lines.forEach((line, index) => context.fillText(line, x + padding, y + padding + size * (0.9 + index * 1.2)));
}

function moveAnnotation(annotation: Annotation, dx: number, dy: number): Annotation {
  switch (annotation.kind) {
    case 'highlight':
      return { ...annotation, rects: annotation.rects.map((rect) => ({ ...rect, x: rect.x + dx, y: rect.y + dy })) };
    case 'ink':
      return { ...annotation, strokes: annotation.strokes.map((stroke) => stroke.map((point) => ({ x: point.x + dx, y: point.y + dy }))) };
    default:
      return { ...annotation, x: annotation.x + dx, y: annotation.y + dy };
  }
}
