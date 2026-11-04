import { base64ToBytes, bytesToBase64, type ServiceResult, type ViewerContext } from '@pdf-suite/viewer';

export const TOOLS_CSS = `
.pv-tools { display: flex; flex-direction: column; gap: 2px; padding: 8px; }
.pv-tools details { border-bottom: 1px solid var(--pv-border); padding: 4px 0; }
.pv-tools summary { padding: 6px 2px; cursor: pointer; font-weight: 600; }
.pv-tools form { display: flex; flex-direction: column; gap: 8px; padding: 4px 2px 10px; }
.pv-tools label { display: flex; flex-direction: column; gap: 3px; color: var(--pv-muted); }
.pv-tools .pv-input, .pv-tools .pv-select { width: 100%; color: var(--pv-text); }
.pv-tools textarea.pv-input { height: 64px; padding: 4px 6px; }
.pv-tools .pv-tool-hint { margin: 0; color: var(--pv-muted); font-size: 12px; }
.pv-organize-list { display: flex; flex-direction: column; gap: 4px; max-height: 320px; overflow: auto; }
.pv-organize-row { display: flex; align-items: center; gap: 4px; padding: 3px; border: 1px solid var(--pv-border); border-radius: 5px; background: var(--pv-surface); cursor: grab; }
.pv-organize-row[data-dragging='true'] { opacity: 0.5; }
.pv-organize-row canvas { width: 36px; background: #fff; box-shadow: var(--pv-page-shadow); }
.pv-organize-row span { flex: 1; }
.pv-organize-row .pv-btn { min-width: 26px; height: 26px; padding: 0; }
`;

type FieldKind = 'text' | 'textarea' | 'select' | 'number';

interface ToolField {
  name: string;
  label: string;
  kind: FieldKind;
  value?: string;
  options?: Array<[string, string]>;
  placeholder?: string;
  required?: boolean;
  /** Sends the value as a list, with one entry per line. */
  lines?: boolean;
}

interface ToolDefinition {
  id: string;
  label: string;
  operation: string;
  fields?: ToolField[];
  action: string;
  hint?: string;
  /** Downloads the result instead of opening it in the viewer. */
  download?: boolean;
  /** Which documents this tool applies to. Defaults to both PDFs and images. */
  appliesTo?: 'pdf' | 'image';
}

const TOOLS: ToolDefinition[] = [
  { id: 'image-to-pdf', label: 'Convert to PDF', operation: '', action: 'Convert to PDF', appliesTo: 'image', hint: 'Opens this image as a PDF, including any annotations.' },
  { id: 'compress', label: 'Compress', operation: 'compress', action: 'Compress', fields: [{ name: 'quality', label: 'Quality', kind: 'select', value: 'recommended', options: [['less', 'Less compression'], ['recommended', 'Recommended'], ['extreme', 'Smallest file']] }] },
  { id: 'redact', label: 'Redact', operation: 'redact', action: 'Redact permanently', hint: 'Matching text is removed for good, and pages containing it become pictures.', fields: [{ name: 'terms', label: 'Words or phrases, one per line', kind: 'textarea', lines: true, required: true }] },
  { id: 'searchable', label: 'Make searchable (OCR)', operation: 'searchable', action: 'Run OCR', hint: 'Adds selectable text to scanned pages.' },
  { id: 'rotate', label: 'Rotate pages', operation: 'rotate', action: 'Rotate', fields: [{ name: 'degrees', label: 'Rotation', kind: 'select', value: '90', options: [['90', '90° right'], ['180', '180°'], ['270', '90° left']] }, { name: 'pages', label: 'Pages (blank for all)', kind: 'text', placeholder: '1,3,5-8' }] },
  { id: 'remove-pages', label: 'Remove pages', operation: 'remove-pages', action: 'Remove', appliesTo: 'pdf', fields: [{ name: 'pages', label: 'Pages', kind: 'text', placeholder: '2,4-6', required: true }] },
  { id: 'watermark', label: 'Watermark', operation: 'watermark', action: 'Add watermark', fields: [{ name: 'text', label: 'Text', kind: 'text', value: 'DRAFT', required: true }] },
  { id: 'page-numbers', label: 'Page numbers', operation: 'page-numbers', action: 'Add numbers', fields: [{ name: 'position', label: 'Position', kind: 'select', value: 'bottom-center', options: [['bottom-center', 'Bottom center'], ['bottom-left', 'Bottom left'], ['bottom-right', 'Bottom right'], ['top-center', 'Top center'], ['top-left', 'Top left'], ['top-right', 'Top right']] }] },
  { id: 'crop', label: 'Crop', operation: 'crop', action: 'Crop', hint: 'Hidden content stays in the file. Use Redact for anything secret.', fields: [{ name: 'left', label: 'Left (points)', kind: 'number', value: '0' }, { name: 'right', label: 'Right (points)', kind: 'number', value: '0' }, { name: 'top', label: 'Top (points)', kind: 'number', value: '0' }, { name: 'bottom', label: 'Bottom (points)', kind: 'number', value: '0' }] },
  { id: 'metadata', label: 'Title and author', operation: 'metadata/update', action: 'Save details', fields: [{ name: 'title', label: 'Title', kind: 'text' }, { name: 'author', label: 'Author', kind: 'text' }] },
  { id: 'protect', label: 'Password protect', operation: 'protect', action: 'Protect', download: true, fields: [{ name: 'userPassword', label: 'Password', kind: 'text', required: true }, { name: 'ownerPassword', label: 'Owner password', kind: 'text', required: true }] },
  { id: 'convert', label: 'Convert and download', operation: 'convert', action: 'Convert', download: true, fields: [{ name: 'format', label: 'Format', kind: 'select', value: 'word', options: [['word', 'Word (.docx)'], ['excel', 'Excel (.xlsx)'], ['powerpoint', 'PowerPoint (.pptx)'], ['text', 'Text (.txt)'], ['images', 'Images']] }] },
  { id: 'extract-images', label: 'Extract pictures', operation: 'extract-images', action: 'Download pictures', download: true, appliesTo: 'pdf' },
];

/** The document tools panel, which calls the PDF API. */
export class ToolsController {
  private readonly panel = document.createElement('div');
  private readonly history: Array<{ bytes: Uint8Array; name: string }> = [];
  private undoButton!: HTMLButtonElement;
  private imageHint!: HTMLElement;
  private organizeList!: HTMLElement;
  private busy = false;
  private order: number[] = [];

  constructor(
    private readonly context: ViewerContext,
    private readonly hasService: boolean,
  ) {}

  install(): void {
    this.context.addStyles(TOOLS_CSS);
    this.panel.className = 'pv-tools';
    this.build();
    this.context.addSidebarPanel({
      id: 'tools',
      label: 'Document tools',
      icon: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5l-6 6a2 2 0 0 0 2.8 2.8l6-6a4 4 0 0 0 5-5.4l-2.6 2.6-2.4-2.4z"/>',
      element: this.panel,
      onShow: () => this.rebuildOrganizeList(),
      forImages: true,
    });
    this.context.viewer.on('documentLoaded', ({ kind }) => {
      this.rebuildOrganizeList();
      this.showToolsFor(kind);
    });
    this.showToolsFor('pdf');
  }

  private showToolsFor(kind: 'pdf' | 'image'): void {
    if (!this.hasService) return;
    this.panel.querySelectorAll<HTMLElement>('details[data-tool]').forEach((details) => {
      const appliesTo = details.dataset.appliesTo;
      details.hidden = Boolean(appliesTo) && appliesTo !== kind;
    });
    this.imageHint.hidden = kind !== 'image';
  }

  private build(): void {
    if (!this.hasService) {
      const message = document.createElement('p');
      message.className = 'pv-tool-hint';
      message.textContent = 'Document tools need a PDF service. Set the serviceUrl option to enable them.';
      this.panel.append(message);
      return;
    }

    this.undoButton = document.createElement('button');
    this.undoButton.type = 'button';
    this.undoButton.className = 'pv-btn';
    this.undoButton.textContent = 'Undo last tool';
    this.undoButton.disabled = true;
    this.undoButton.dataset.tool = 'undo-tool';
    this.undoButton.addEventListener('click', () => void this.undoLastTool());
    this.imageHint = document.createElement('p');
    this.imageHint.className = 'pv-tool-hint';
    this.imageHint.textContent = 'These tools work on PDFs, so the image is converted to a PDF first. Undo brings the image back.';
    this.panel.append(this.imageHint, this.undoButton, this.buildOrganize());
    for (const tool of TOOLS) this.panel.append(this.buildTool(tool));
  }

  private buildOrganize(): HTMLElement {
    const details = document.createElement('details');
    details.dataset.tool = 'organize';
    details.dataset.appliesTo = 'pdf';
    const summary = document.createElement('summary');
    summary.textContent = 'Organize pages';
    const form = document.createElement('form');
    this.organizeList = document.createElement('div');
    this.organizeList.className = 'pv-organize-list';
    const apply = document.createElement('button');
    apply.type = 'submit';
    apply.className = 'pv-btn pv-primary';
    apply.textContent = 'Apply new order';
    form.append(this.organizeList, apply);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (this.order.length === 0) {
        this.context.notify('A PDF needs at least one page.', 'error');
        return;
      }
      void this.run({ id: 'organize', label: 'Organize', operation: 'organize', action: '' }, { pages: this.order.join(',') });
    });
    details.append(summary, form);
    details.addEventListener('toggle', () => this.rebuildOrganizeList());
    return details;
  }

  private rebuildOrganizeList(): void {
    if (!this.hasService) return;
    const count = this.context.viewer.pageCount;
    this.order = Array.from({ length: count }, (_, index) => index + 1);
    this.renderOrganizeList();
  }

  private renderOrganizeList(): void {
    this.organizeList.replaceChildren();
    this.order.forEach((pageNumber, index) => {
      const row = document.createElement('div');
      row.className = 'pv-organize-row';
      row.draggable = true;
      row.dataset.page = String(pageNumber);
      row.addEventListener('dragstart', (event) => {
        row.dataset.dragging = 'true';
        event.dataTransfer?.setData('text/plain', String(index));
      });
      row.addEventListener('dragend', () => delete row.dataset.dragging);
      row.addEventListener('dragover', (event) => event.preventDefault());
      row.addEventListener('drop', (event) => {
        event.preventDefault();
        const from = Number(event.dataTransfer?.getData('text/plain'));
        if (Number.isInteger(from)) this.moveOrganizeRow(from, index);
      });

      const label = document.createElement('span');
      label.textContent = `Page ${pageNumber}`;
      const up = this.smallButton('↑', `Move page ${pageNumber} up`, () => this.moveOrganizeRow(index, index - 1));
      up.disabled = index === 0;
      const down = this.smallButton('↓', `Move page ${pageNumber} down`, () => this.moveOrganizeRow(index, index + 1));
      down.disabled = index === this.order.length - 1;
      const remove = this.smallButton('×', `Remove page ${pageNumber}`, () => {
        this.order.splice(index, 1);
        this.renderOrganizeList();
      });
      row.append(label, up, down, remove);
      this.organizeList.append(row);
    });
  }

  private moveOrganizeRow(from: number, to: number): void {
    if (to < 0 || to >= this.order.length) return;
    const [page] = this.order.splice(from, 1);
    this.order.splice(to, 0, page);
    this.renderOrganizeList();
  }

  private smallButton(text: string, label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pv-btn';
    button.textContent = text;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.addEventListener('click', onClick);
    return button;
  }

  private buildTool(tool: ToolDefinition): HTMLElement {
    const details = document.createElement('details');
    details.dataset.tool = tool.id;
    if (tool.appliesTo) details.dataset.appliesTo = tool.appliesTo;
    const summary = document.createElement('summary');
    summary.textContent = tool.label;
    const form = document.createElement('form');
    if (tool.hint) {
      const hint = document.createElement('p');
      hint.className = 'pv-tool-hint';
      hint.textContent = tool.hint;
      form.append(hint);
    }

    const controls = new Map<ToolField, HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>();
    for (const field of tool.fields ?? []) {
      const label = document.createElement('label');
      label.textContent = field.label;
      const control = this.createFieldControl(field);
      controls.set(field, control);
      label.append(control);
      form.append(label);
    }

    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'pv-btn pv-primary';
    submit.textContent = tool.action;
    form.append(submit);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const values: Record<string, unknown> = {};
      for (const [field, control] of controls) {
        const value = control.value.trim();
        if (!value) continue;
        values[field.name] = field.lines ? value.split('\n').map((line) => line.trim()).filter(Boolean) : value;
      }
      void this.run(tool, values);
    });

    details.append(summary, form);
    return details;
  }

  private createFieldControl(field: ToolField): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
    if (field.kind === 'select') {
      const select = document.createElement('select');
      select.className = 'pv-select';
      select.name = field.name;
      for (const [value, label] of field.options ?? []) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        select.append(option);
      }
      if (field.value) select.value = field.value;
      return select;
    }

    const control = document.createElement(field.kind === 'textarea' ? 'textarea' : 'input') as HTMLInputElement | HTMLTextAreaElement;
    control.className = 'pv-input';
    control.name = field.name;
    if (control instanceof HTMLInputElement) control.type = field.kind === 'number' ? 'number' : 'text';
    if (field.value) control.value = field.value;
    if (field.placeholder) control.placeholder = field.placeholder;
    control.required = Boolean(field.required);
    return control;
  }

  private async run(tool: ToolDefinition, values: Record<string, unknown>): Promise<void> {
    if (this.busy) return;
    const { viewer } = this.context;
    if (viewer.pageCount === 0) {
      this.context.notify('Open a document first.', 'error');
      return;
    }

    this.busy = true;
    this.setDisabled(true);
    try {
      const isImage = viewer.kind === 'image';
      const { bytes, name } = isImage ? await viewer.getImageFile() : { bytes: await viewer.getBytes(), name: viewer.fileName };
      const pdfName = name.replace(/\.[^.]+$/, '') + '.pdf';
      const pdf = isImage ? await this.convertImageToPdf(bytes, name) : bytes;
      let operation = tool.operation;
      if (tool.id === 'convert') {
        operation = `pdf-to-${values.format as string}`;
        delete values.format;
      }

      const result: ServiceResult = tool.id === 'image-to-pdf'
        ? { data: bytesToBase64(pdf) }
        : await this.context.callService(operation, { file: { name: pdfName, data: bytesToBase64(pdf) }, ...values });
      const data = this.requireData(result);
      if (tool.download) {
        this.saveFile(data, result.fileName ?? 'result', result.contentType);
        this.context.notify(`${tool.label}: saved ${result.fileName ?? 'the file'}.`);
      } else {
        this.history.push({ bytes, name });
        await viewer.load(data, isImage ? pdfName : name);
        this.undoButton.disabled = false;
        this.context.notify(`${tool.label}: done. File size ${formatSize(bytes.length)} → ${formatSize(data.length)}.`);
      }
    } catch (error) {
      this.context.notify(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      this.busy = false;
      this.setDisabled(false);
    }
  }

  private async convertImageToPdf(bytes: Uint8Array, name: string): Promise<Uint8Array> {
    return this.requireData(await this.context.callService('images-to-pdf', { files: [{ name, data: bytesToBase64(bytes) }] }));
  }

  private requireData(result: ServiceResult): Uint8Array {
    if (!result.data) throw new Error('The PDF service returned no file.');
    return base64ToBytes(result.data);
  }

  private setDisabled(disabled: boolean): void {
    this.panel.querySelectorAll<HTMLButtonElement>('button[type="submit"]').forEach((button) => {
      button.disabled = disabled;
    });
  }

  private async undoLastTool(): Promise<void> {
    const previous = this.history.pop();
    if (!previous) return;
    await this.context.viewer.load(previous.bytes, previous.name);
    this.undoButton.disabled = this.history.length === 0;
  }

  private saveFile(data: Uint8Array, fileName: string, contentType?: string): void {
    const url = URL.createObjectURL(new Blob([data as BlobPart], { type: contentType ?? 'application/octet-stream' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
