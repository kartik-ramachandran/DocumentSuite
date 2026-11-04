import { openContextMenu, type ContextMenuItem } from './context-menu';
import { openViewerModal, type ViewerModal, type ViewerModalOptions } from './modal';
import { askFileName } from './rename-dialog';
import { onViewerSettingsChange, resolveSettings, type PdfSuiteSettings } from './settings';
import { loadSource } from './sources';
import type { DocumentSource } from './types';

export interface FileItem {
  /** Identifies the file to your code. Defaults to its name. */
  id?: string;
  name: string;
  /** The file, or a function that fetches it when it's first needed. */
  source: DocumentSource | (() => DocumentSource | Promise<DocumentSource>);
  /** Size in bytes. */
  size?: number;
  modified?: Date | string;
}

export interface FileMenuItem {
  id: string;
  label: string;
  onSelect: (file: FileItem) => void;
  disabled?: boolean | ((file: FileItem) => boolean);
  danger?: boolean;
  separator?: boolean;
}

export interface FileListOptions {
  files?: FileItem[];
  /** Settings for this list and the viewers it opens, on top of the app-wide ones from configureViewer. */
  settings?: Partial<PdfSuiteSettings>;
  /** What a click does. Defaults to the clickAction setting. */
  clickAction?: PdfSuiteSettings['clickAction'];
  /** Extra items for the menu, after Open and Download. */
  menuItems?: FileMenuItem[];
  /** Replaces opening the modal, for apps that show files their own way. */
  onOpen?: (file: FileItem) => void;
  /** Options for the viewer modal, such as serviceUrl and plugins. */
  viewer?: Omit<ViewerModalOptions, 'source' | 'fileName' | 'title' | 'onClose'>;
  /** Asks what to call a file before downloading it, from the list and in the viewer. Defaults to false. */
  allowRename?: boolean;
  /** Shown when there are no files. */
  emptyText?: string;
  theme?: 'light' | 'dark' | 'auto';
}

const FILE_ICON = '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/>';
const MENU_ICON = '<circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>';

const LIST_CSS = `
:host {
  --pl-surface: #ffffff;
  --pl-text: #1c2230;
  --pl-muted: #5b6474;
  --pl-border: #d7dbe2;
  --pl-hover: #eef1f6;
  --pl-accent: #2f5fd0;
  display: block;
  font: 13px/1.4 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  color: var(--pl-text);
}
:host([data-theme='dark']) { --pl-surface: #262b35; --pl-text: #e7eaf0; --pl-muted: #a0a8b6; --pl-border: #3a404c; --pl-hover: #333946; --pl-accent: #7ea2f5; }
* { box-sizing: border-box; }
ul { margin: 0; padding: 0; list-style: none; border: 1px solid var(--pl-border); border-radius: 12px; background: var(--pl-surface); overflow: hidden; box-shadow: 0 4px 20px #10182806; }
li { display: flex; align-items: center; gap: 12px; min-height: 56px; padding: 8px 10px 8px 16px; border-top: 1px solid var(--pl-border); cursor: pointer; }
ul, li, .pl-more, .pl-badge { transition: background-color 200ms ease, color 200ms ease, border-color 200ms ease; }
li:first-child { border-top: 0; }
li:hover { background: var(--pl-hover); }
li:focus-visible { outline: 2px solid var(--pl-accent); outline-offset: -2px; }
.pl-icon { flex-shrink: 0; width: 20px; height: 20px; fill: none; stroke: var(--pl-muted); stroke-width: 1.6; stroke-linejoin: round; }
.pl-badge { flex-shrink: 0; min-width: 40px; padding: 1px 5px; border-radius: 4px; background: var(--pl-hover); color: var(--pl-muted); font-size: 11px; font-weight: 600; text-align: center; text-transform: uppercase; }
.pl-name { flex: 1; min-width: 0; overflow: hidden; font-weight: 500; white-space: nowrap; text-overflow: ellipsis; }
.pl-meta { flex-shrink: 0; color: var(--pl-muted); white-space: nowrap; }
.pl-more { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--pl-muted); cursor: pointer; }
.pl-more:hover { background: var(--pl-border); color: var(--pl-text); }
.pl-more:focus-visible { outline: 2px solid var(--pl-accent); }
.pl-more svg { width: 16px; height: 16px; fill: currentColor; }
.pl-empty { padding: 24px; border: 1px dashed var(--pl-border); border-radius: 8px; color: var(--pl-muted); text-align: center; }
@media (max-width: 560px) { .pl-meta { display: none; } }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
`;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
}

/** A list of files. Click to open one in the viewer modal, or right-click for its menu. */
export class FileList {
  private readonly shadow: ShadowRoot;
  private readonly container = document.createElement('div');
  private files: FileItem[];
  private modal: ViewerModal | null = null;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly host: HTMLElement,
    private options: FileListOptions = {},
  ) {
    this.files = options.files ?? [];
    this.shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = LIST_CSS;
    this.shadow.replaceChildren(style, this.container);
    this.unsubscribe = onViewerSettingsChange(() => this.render());
    this.render();
  }

  setFiles(files: FileItem[]): void {
    this.files = files;
    this.render();
  }

  setOptions(options: Partial<FileListOptions>): void {
    this.options = { ...this.options, ...options };
    if (options.files) this.files = options.files;
    this.render();
  }

  /** Opens a file the same way a click would. */
  open(file: FileItem): void {
    if (this.options.onOpen) {
      this.options.onOpen(file);
      return;
    }

    // One modal at a time. If the current one keeps its unsaved work, the new file doesn't replace it.
    void this.openInModal(file);
  }

  private get settings(): PdfSuiteSettings {
    return resolveSettings(this.options.viewer?.settings, this.options.settings, {
      clickAction: this.options.clickAction,
      allowRename: this.options.allowRename ?? this.options.viewer?.allowRename,
      theme: this.options.theme,
    });
  }

  /** The open modal, if there is one. */
  get currentModal(): ViewerModal | null {
    return this.modal;
  }

  destroy(): void {
    this.unsubscribe();
    void this.modal?.close(true);
    this.shadow.replaceChildren();
  }

  private async openInModal(file: FileItem): Promise<void> {
    if (this.modal && !(await this.modal.close())) return;

    const modal = openViewerModal({
      ...this.options.viewer,
      settings: this.settings,
      title: file.name,
      fileName: file.name,
      onClose: () => {
        if (this.modal === modal) this.modal = null;
      },
    });
    this.modal = modal;
    try {
      await modal.load(await this.resolveSource(file), file.name);
    } catch (error) {
      modal.viewer.notify(error instanceof Error ? error.message : String(error), 'error');
    }
  }

  private async resolveSource(file: FileItem): Promise<DocumentSource> {
    return typeof file.source === 'function' ? file.source() : file.source;
  }

  private async downloadFile(file: FileItem): Promise<void> {
    const name = this.settings.allowRename ? await askFileName(file.name, this.host.dataset.theme === 'dark' ? 'dark' : 'light') : file.name;
    if (name === null) return;

    const { bytes } = await loadSource(await this.resolveSource(file), file.name);
    const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  private showMenu(file: FileItem, x: number, y: number): void {
    const items: ContextMenuItem[] = [
      { id: 'open', label: 'Open', onSelect: () => this.open(file) },
      ...(this.settings.allowDownload ? [{ id: 'download', label: 'Download', onSelect: () => void this.downloadFile(file) }] : []),
      ...(this.options.menuItems ?? []).map((item) => ({
        id: item.id,
        label: item.label,
        danger: item.danger,
        separator: item.separator,
        disabled: typeof item.disabled === 'function' ? item.disabled(file) : item.disabled,
        onSelect: () => item.onSelect(file),
      })),
    ];
    const theme = this.host.dataset.theme === 'dark' ? 'dark' : 'light';
    openContextMenu(x, y, items, { label: `Actions for ${file.name}`, theme });
  }

  private runAction(action: PdfSuiteSettings['clickAction'], file: FileItem, event: MouseEvent): void {
    if (action === 'open') this.open(file);
    else if (action === 'menu') this.showMenu(file, event.clientX, event.clientY);
  }

  private render(): void {
    const { theme } = this.settings;
    const dark = theme === 'dark' || (theme === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
    this.host.dataset.theme = dark ? 'dark' : 'light';

    if (this.files.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'pl-empty';
      empty.textContent = this.options.emptyText ?? 'No files yet';
      this.container.replaceChildren(empty);
      return;
    }

    const list = document.createElement('ul');
    list.setAttribute('role', 'list');
    list.setAttribute('aria-label', 'Files');
    this.files.forEach((file, index) => list.append(this.renderRow(file, index)));
    list.addEventListener('keydown', (event) => this.handleListKeys(event, list));
    this.container.replaceChildren(list);
  }

  private renderRow(file: FileItem, index: number): HTMLElement {
    const row = document.createElement('li');
    row.tabIndex = index === 0 ? 0 : -1;
    row.dataset.file = file.id ?? file.name;
    row.setAttribute('aria-label', `${file.name}. Press Enter to open, or the menu key for more actions.`);

    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    icon.classList.add('pl-icon');
    icon.innerHTML = FILE_ICON;

    const extension = file.name.includes('.') ? file.name.split('.').pop()! : '';
    const badge = document.createElement('span');
    badge.className = 'pl-badge';
    badge.textContent = extension.slice(0, 5);
    if (!extension) badge.hidden = true;

    const name = document.createElement('span');
    name.className = 'pl-name';
    name.textContent = file.name;
    name.title = file.name;
    row.append(icon, badge, name);

    const settings = this.settings;
    const details = settings.showFileDetails ? [file.size !== undefined ? formatSize(file.size) : '', file.modified ? formatDate(file.modified) : ''].filter(Boolean) : [];
    if (details.length > 0) {
      const meta = document.createElement('span');
      meta.className = 'pl-meta';
      meta.textContent = details.join(' · ');
      row.append(meta);
    }

    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'pl-more';
    more.title = 'More actions';
    more.setAttribute('aria-label', `More actions for ${file.name}`);
    more.setAttribute('aria-haspopup', 'menu');
    more.tabIndex = -1;
    more.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${MENU_ICON}</svg>`;
    more.addEventListener('click', (event) => {
      event.stopPropagation();
      const box = more.getBoundingClientRect();
      this.showMenu(file, box.left, box.bottom + 2);
    });
    if (settings.showMenuButton) row.append(more);

    row.addEventListener('click', (event) => this.runAction(this.settings.clickAction, file, event));
    row.addEventListener('dblclick', (event) => this.runAction(this.settings.doubleClickAction, file, event));
    row.addEventListener('contextmenu', (event) => {
      if (!this.settings.contextMenu) return;
      event.preventDefault();
      this.showMenu(file, event.clientX, event.clientY);
    });
    row.addEventListener('keydown', (event) => {
      if (event.target !== row) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        this.open(file);
      } else if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
        event.preventDefault();
        const box = row.getBoundingClientRect();
        this.showMenu(file, box.left + 24, box.bottom - 6);
      }
    });
    return row;
  }

  private handleListKeys(event: KeyboardEvent, list: HTMLElement): void {
    const rows = Array.from(list.children) as HTMLElement[];
    const current = rows.indexOf(this.shadow.activeElement as HTMLElement);
    if (current < 0) return;

    const targets: Record<string, number> = { ArrowDown: current + 1, ArrowUp: current - 1, Home: 0, End: rows.length - 1 };
    const target = targets[event.key];
    if (target === undefined || !rows[target]) return;
    event.preventDefault();
    rows[current].tabIndex = -1;
    rows[target].tabIndex = 0;
    rows[target].focus();
  }
}

/** Shows a list of files inside an element. */
export function createFileList(element: HTMLElement, options: FileListOptions = {}): FileList {
  return new FileList(element, options);
}
