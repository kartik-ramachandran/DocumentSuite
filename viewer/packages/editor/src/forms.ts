import type { ViewerContext } from '@document-suite/viewer';

export const FORMS_CSS = `
.pv-form-layer { position: absolute; inset: 0; pointer-events: none; }
.pv-field { position: absolute; margin: 0; padding: 0 2px; border: 0; background: rgba(47, 95, 208, 0.12); color: #111; font-family: Helvetica, Arial, sans-serif; pointer-events: auto; }
.pv-field:focus { outline: 1px solid #2f5fd0; background: rgba(47, 95, 208, 0.2); }
.pv-field[type='checkbox'], .pv-field[type='radio'] { accent-color: #2f5fd0; }
.pv-field[disabled] { background: transparent; }
`;

interface PdfJsAnnotation {
  id: string;
  subtype: string;
  fieldType?: string;
  fieldName?: string;
  fieldValue?: string | string[];
  buttonValue?: string;
  exportValue?: string;
  rect: [number, number, number, number];
  readOnly?: boolean;
  checkBox?: boolean;
  radioButton?: boolean;
  pushButton?: boolean;
  multiLine?: boolean;
  options?: Array<{ exportValue: string; displayValue: string }>;
  textAlignment?: number;
}

interface PdfJsPage {
  getViewport(options: { scale: number }): { transform: number[] };
  getAnnotations(options: { intent: string }): Promise<PdfJsAnnotation[]>;
}

interface PdfJsDocument {
  annotationStorage: { setValue(key: string, value: Record<string, unknown>): void };
  getPage(pageNumber: number): Promise<PdfJsPage>;
  saveDocument(): Promise<Uint8Array>;
}

/** Fillable form fields drawn over the page. Values are written into the PDF when it's exported. */
export class FormController {
  private isDirty = false;
  private readonly unsubscribes: Array<() => void> = [];

  constructor(private readonly context: ViewerContext) {}

  install(): void {
    this.context.addStyles(FORMS_CSS);
    this.unsubscribes.push(
      this.context.viewer.on('documentLoaded', () => {
        this.isDirty = false;
      }),
      this.context.viewer.on('pageLayersReady', ({ pageNumber, layer }) => {
        this.renderFields(pageNumber, layer).catch((error: Error) => this.context.notify(`Form fields on page ${pageNumber} could not be shown. ${error.message}`, 'error'));
      }),
    );
    this.context.addExportStep(async (bytes) => {
      const document = this.context.getPdfJsDocument() as PdfJsDocument | null;
      if (!document || !this.isDirty) return bytes;
      return new Uint8Array(await document.saveDocument());
    });
  }

  destroy(): void {
    this.unsubscribes.forEach((unsubscribe) => unsubscribe());
  }

  private async renderFields(pageNumber: number, layer: HTMLElement): Promise<void> {
    const document = this.context.getPdfJsDocument() as PdfJsDocument | null;
    if (!document) return;

    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const widgets = (await page.getAnnotations({ intent: 'display' })).filter((annotation) => annotation.subtype === 'Widget' && annotation.fieldType && !annotation.pushButton && annotation.fieldType !== 'Sig');
    if (widgets.length === 0) return;

    const container = window.document.createElement('div');
    container.className = 'pv-form-layer';
    for (const widget of widgets) {
      const control = this.createControl(widget, document);
      if (!control) continue;
      const [a, b, c, d, e, f] = viewport.transform;
      const [left, bottom, right, top] = widget.rect;
      const x1 = a * left + c * bottom + e;
      const y1 = b * left + d * bottom + f;
      const x2 = a * right + c * top + e;
      const y2 = b * right + d * top + f;
      const height = Math.abs(y2 - y1);
      control.classList.add('pv-field');
      control.style.left = `${Math.min(x1, x2)}px`;
      control.style.top = `${Math.min(y1, y2)}px`;
      control.style.width = `${Math.abs(x2 - x1)}px`;
      control.style.height = `${height}px`;
      if (!widget.checkBox && !widget.radioButton) control.style.fontSize = `${widget.multiLine ? 12 : Math.max(Math.min(height * 0.7, 14), 8)}px`;
      control.dataset.field = widget.fieldName ?? '';
      control.setAttribute('aria-label', widget.fieldName ?? 'Form field');
      if (widget.readOnly) control.setAttribute('disabled', '');
      container.append(control);
    }
    layer.append(container);
  }

  private createControl(widget: PdfJsAnnotation, document: PdfJsDocument): HTMLElement | null {
    const store = (value: Record<string, unknown>) => {
      document.annotationStorage.setValue(widget.id, value);
      this.isDirty = true;
      this.context.markChanged();
    };

    if (widget.fieldType === 'Tx') {
      const input = window.document.createElement(widget.multiLine ? 'textarea' : 'input') as HTMLInputElement | HTMLTextAreaElement;
      input.value = typeof widget.fieldValue === 'string' ? widget.fieldValue : '';
      input.addEventListener('input', () => store({ value: input.value }));
      return input;
    }

    if (widget.fieldType === 'Btn') {
      const input = window.document.createElement('input');
      input.type = widget.radioButton ? 'radio' : 'checkbox';
      if (widget.radioButton) input.name = widget.fieldName ?? widget.id;
      input.checked = widget.radioButton ? widget.fieldValue === widget.buttonValue : Boolean(widget.fieldValue) && widget.fieldValue !== 'Off';
      input.addEventListener('change', () => store({ value: input.checked }));
      return input;
    }

    if (widget.fieldType === 'Ch') {
      const select = window.document.createElement('select');
      for (const option of widget.options ?? []) {
        const element = window.document.createElement('option');
        element.value = option.exportValue;
        element.textContent = option.displayValue;
        select.append(element);
      }
      const current = Array.isArray(widget.fieldValue) ? widget.fieldValue[0] : widget.fieldValue;
      if (current) select.value = current;
      select.addEventListener('change', () => store({ value: [select.value] }));
      return select;
    }

    return null;
  }
}
