import { ICONS } from './icons';
import { askFileName } from './rename-dialog';
import { ServiceClient } from './service';
import { resolveSettings, type PdfSuiteSettings } from './settings';
import type { ImageView } from './image-view';
import { bytesToBase64, detectImage, isPdf, loadSource, nameForType, type LoadedSource } from './sources';
import { VIEWER_CSS } from './styles';
import type {
  DocumentEngine,
  DocumentKind,
  DocumentSource,
  ExportStep,
  PageSize,
  PrintPainter,
  SearchMatch,
  SidebarPanel,
  TextRun,
  ToolbarButton,
  ViewerContext,
  ViewerEvents,
  ViewerOptions,
  ViewRotation,
  ZoomValue,
} from './types';

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 6;
const THUMBNAIL_WIDTH = 150;
const MAX_CANVAS_PIXELS = 16_000_000;
const RENDER_MARGIN = '800px';
const KEPT_PAGES_AROUND_VIEW = 4;
const ZOOM_RERENDER_DELAY_MS = 150;
const SEARCH_DELAY_MS = 200;
const PRINT_SCALE = 2;
const TOAST_MS = 4000;
// Large images are annotated at this size, so lines and text stay in proportion on any photo.
// Smaller images use their real pixels, because scaling them up would make lines blur when saved.
const IMAGE_MAX_LOGICAL_SIZE = 800;
// Tiny images such as icons are annotated, and saved, at this size so that the marks stay readable.
const IMAGE_MIN_LOGICAL_SIZE = 256;

interface PageView {
  number: number;
  size: PageSize;
  element: HTMLDivElement;
  canvas: HTMLCanvasElement | null;
  layers: HTMLDivElement;
  textLayer: HTMLDivElement;
  matchLayer: HTMLDivElement;
  pluginLayer: HTMLDivElement;
  renderedKey: string | null;
  abort: AbortController | null;
  textLoaded: boolean;
}

type Listener<K extends keyof ViewerEvents> = (event: ViewerEvents[K]) => void;

/** The viewer. Attach it to any element with createViewer, or use the framework wrappers. */
export class PdfViewer {
  /** The settings in effect. They're read when the viewer is created. */
  readonly settings: PdfSuiteSettings;
  private readonly shadow: ShadowRoot;
  private readonly listeners = new Map<keyof ViewerEvents, Set<Listener<never>>>();
  private readonly service: ServiceClient;
  private readonly exportSteps: ExportStep[] = [];
  private readonly printPainters: PrintPainter[] = [];
  private readonly imageChangeChecks: Array<() => boolean> = [];
  private readonly imageHost: HTMLElement;
  private imageSize: PageSize = { width: 0, height: 0 };
  private currentPanel = 'pages';
  private unsaved = false;
  /** The file as uploaded, when it had to be converted to PDF for viewing. */
  private originalFile: LoadedSource | null = null;
  private lastHeight = 0;
  private readonly controls: Record<string, HTMLElement> = {};
  private readonly textCache = new Map<number, TextRun[]>();
  private readonly mainGroup: HTMLElement;
  private readonly pluginGroup: HTMLElement;
  private readonly tabs: HTMLElement;
  private readonly tabPanels: HTMLElement;
  private readonly root: HTMLElement;
  private readonly scroller: HTMLElement;
  private readonly pagesHost: HTMLElement;
  private readonly sidebar: HTMLElement;
  private readonly thumbnails: HTMLElement;
  private readonly searchBar: HTMLElement;
  private readonly emptyState: HTMLElement;
  private readonly overlay: HTMLElement;

  private engine: DocumentEngine | null = null;
  private imageView: ImageView | null = null;
  private imageBytes: Uint8Array | null = null;
  private imageStylesAdded = false;
  private imageMimeType = 'image/png';
  private pageViews: PageView[] = [];
  private pageObserver: IntersectionObserver | null = null;
  private thumbObserver: IntersectionObserver | null = null;
  private scale = 1;
  private zoomSetting: ZoomValue;
  private rotation: ViewRotation = 0;
  private currentPage = 1;
  private documentName = 'document.pdf';
  private loadToken = 0;
  private zoomTimer: number | undefined;
  private searchTimer: number | undefined;
  private matches: SearchMatch[] = [];
  private matchIndex = -1;
  private searchQuery = '';
  private searchToken = 0;
  private resizeObserver: ResizeObserver | null = null;
  private lastWidth = 0;
  private destroyed = false;
  private readonly ready: Promise<void>;

  constructor(
    private readonly host: HTMLElement,
    private readonly options: ViewerOptions = {},
  ) {
    this.shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    this.shadow.replaceChildren();
    this.settings = resolveSettings(options.settings, {
      theme: options.theme,
      mode: options.mode,
      initialZoom: options.initialZoom,
      sidebarOpen: options.sidebarOpen,
      allowOpen: options.allowOpen,
      allowRename: options.allowRename,
    });
    this.zoomSetting = this.settings.initialZoom;
    this.service = new ServiceClient(options.serviceUrl, options.serviceHeaders, options.serviceTransport);
    this.applyTheme(this.settings.theme);
    this.addStyles(VIEWER_CSS);

    this.root = element('div', 'pv-root');
    const toolbar = element('div', 'pv-toolbar');
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', 'Document tools');
    if (options.toolbar === false) toolbar.hidden = true;
    this.mainGroup = element('div', 'pv-spacer');
    this.pluginGroup = element('div', 'pv-group');
    this.pluginGroup.hidden = true;
    this.buildToolbar(toolbar);

    this.searchBar = this.buildSearchBar();

    const body = element('div', 'pv-body');
    this.sidebar = element('aside', 'pv-sidebar');
    this.sidebar.setAttribute('aria-label', 'Side panel');
    this.tabs = element('div', 'pv-tabs');
    this.tabPanels = element('div', 'pv-tab-panel');
    this.tabPanels.style.display = 'contents';
    this.thumbnails = element('div', 'pv-thumbs');
    this.sidebar.append(this.tabs, this.tabPanels);

    this.scroller = element('div', 'pv-scroll');
    this.scroller.tabIndex = 0;
    this.scroller.setAttribute('aria-label', 'Document pages');
    this.pagesHost = element('div', 'pv-pages');
    this.scroller.append(this.pagesHost);
    this.scroller.addEventListener('scroll', () => this.updateCurrentPage(), { passive: true });

    this.emptyState = element('div', 'pv-empty');
    this.emptyState.textContent = 'No document open';
    this.overlay = element('div', 'pv-overlay');
    this.overlay.hidden = true;

    this.imageHost = element('div', 'pv-image-host');
    body.append(this.sidebar, this.scroller, this.imageHost, this.emptyState, this.overlay);
    this.root.append(toolbar, this.searchBar, body);
    this.shadow.append(this.root);

    this.addPanel({ id: 'pages', label: 'Pages', icon: ICONS.sidebar, element: this.thumbnails });
    if (this.settings.sidebarOpen) this.toggleSidebar(true);

    this.root.addEventListener('keydown', (event) => this.handleKey(event));
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.scroller);
    this.resizeObserver.observe(this.imageHost);

    this.ready = this.installPlugins();
    if (options.source !== undefined) void this.load(options.source, options.fileName);
  }

  // ── Public API ─────────────────────────────────────────────────────

  get pageCount(): number {
    return this.imageView ? 1 : (this.engine?.pageCount ?? 0);
  }
  /** True when the document has changed since it was opened, downloaded or marked as saved. */
  get hasUnsavedChanges(): boolean {
    return this.unsaved;
  }

  /** Tells the viewer that your app has saved the document, for example after sending getBytes() to your server. */
  markSaved(): void {
    this.unsaved = false;
  }

  /** What's currently open, or null if nothing is. */
  get kind(): DocumentKind | null {
    return this.imageView ? 'image' : this.engine ? 'pdf' : null;
  }
  get page(): number {
    return this.currentPage;
  }
  get zoom(): number {
    return this.imageView?.ratio ?? this.scale;
  }
  get fileName(): string {
    return this.documentName;
  }

  on<K extends keyof ViewerEvents>(event: K, listener: Listener<K>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<never>);
    return () => set!.delete(listener as Listener<never>);
  }

  /** Opens a document. PDFs and images open directly, and the file's contents decide which viewer is used. Office and text files are converted first, which needs serviceUrl. */
  async load(source: DocumentSource, fileName?: string): Promise<void> {
    await this.ready;
    const token = ++this.loadToken;
    this.showOverlay('Opening document…');
    try {
      let loaded = await loadSource(source, fileName);
      if (token !== this.loadToken) return;

      const image = detectImage(loaded);
      if (image && 'unsupported' in image) throw new Error(`${image.unsupported} images can't be displayed in browsers. Convert it to PNG or JPEG first.`);
      if (image) {
        await this.openImage(loaded, image.mimeType, token);
        return;
      }

      let original: LoadedSource | null = null;
      if (!isPdf(loaded)) {
        original = loaded;
        if (!this.service.isConfigured) throw new Error(`Opening ${loaded.name} needs a PDF service. Set the serviceUrl option.`);
        this.showOverlay('Converting document…');
        loaded = { bytes: await this.service.convertToPdf(loaded.bytes, loaded.name), name: loaded.name.replace(/\.[^.]+$/, '') + '.pdf' };
        if (token !== this.loadToken) return;
      }

      const engine = await this.openEngine(loaded.bytes, loaded.name);
      if (token !== this.loadToken) {
        engine.destroy();
        return;
      }

      this.closeDocument();
      this.originalFile = original;
      this.engine = engine;
      this.documentName = loaded.name;
      this.root.dataset.kind = 'pdf';
      this.applySidebarForKind('pdf');
      this.buildPages();
      this.emptyState.hidden = true;
      this.hideOverlay();
      this.emit('documentLoaded', { pageCount: engine.pageCount, fileName: loaded.name, kind: 'pdf' });
    } catch (error) {
      if (token !== this.loadToken) return;
      const failure = toError(error);
      this.hideOverlay();
      this.notify(failure.message, 'error');
      this.emptyState.hidden = this.kind !== null;
      this.emit('documentError', { error: failure });
    }
  }

  goToPage(pageNumber: number): void {
    const view = this.pageViews[pageNumber - 1];
    if (!view) return;
    this.scroller.scrollTop = view.element.offsetTop - this.pagesHost.offsetTop;
    this.setCurrentPage(pageNumber);
  }

  setZoom(zoom: ZoomValue): void {
    if (this.imageView) {
      if (typeof zoom === 'number') this.imageView.zoomTo(zoom);
      else this.imageView.fit(zoom === 'fit-width' ? 'width' : 'page');
      return;
    }
    this.zoomSetting = zoom;
    this.applyZoom();
  }

  zoomIn(): void {
    this.setZoom(ZOOM_STEPS.find((step) => step > this.zoom + 0.001) ?? MAX_ZOOM);
  }

  zoomOut(): void {
    this.setZoom([...ZOOM_STEPS].reverse().find((step) => step < this.zoom - 0.001) ?? MIN_ZOOM);
  }

  /** Turns the view by 90 degrees. This doesn't change the file. */
  rotateView(): void {
    if (this.imageView) {
      this.imageView.rotate(90);
      return;
    }
    this.rotation = ((this.rotation + 90) % 360) as ViewRotation;
    this.emit('rotationChanged', { rotation: this.rotation });
    this.applyZoom(true);
  }

  /** The current document as bytes, including any changes made by plugins. */
  async getBytes(): Promise<Uint8Array> {
    if (this.imageBytes) return this.isImageEdited() ? this.renderImage() : this.imageBytes;
    if (!this.engine) throw new Error('No document is open.');
    let bytes = await this.engine.getBytes();
    for (const step of this.exportSteps) bytes = await step(bytes);
    return bytes;
  }

  /** The open image as a PNG or JPEG file, which is what the PDF API accepts. Includes any annotations. */
  async getImageFile(): Promise<{ bytes: Uint8Array; name: string }> {
    if (!this.imageBytes) throw new Error('No image is open.');
    const canUseOriginal = !this.isImageEdited() && (this.imageMimeType === 'image/png' || this.imageMimeType === 'image/jpeg');
    return canUseOriginal
      ? { bytes: this.imageBytes, name: this.documentName }
      : { bytes: await this.renderImage(), name: nameForType(this.documentName, 'image/png') };
  }

  /** The current document as base64, ready to send in a JSON request. */
  async getBase64(): Promise<string> {
    return bytesToBase64(await this.getBytes());
  }

  /**
   * Downloads the document under its uploaded name. An untouched Office or text file downloads as the original file,
   * and a changed one as a PDF with the same name. With allowRename, the user is asked for a name first, unless you
   * pass one. Returns false if they cancel.
   */
  async download(fileName?: string): Promise<boolean> {
    try {
      const useOriginal = this.originalFile !== null && !this.unsaved;
      const isImage = this.kind === 'image';
      const bytes = useOriginal ? this.originalFile!.bytes : await this.getBytes();
      const defaultName = useOriginal ? this.originalFile!.name : isImage && this.isImageEdited() ? nameForType(this.documentName, 'image/png') : isImage ? this.documentName : pdfFileName(this.documentName);
      const saved = await this.saveFile(bytes, fileName ?? defaultName, isImage || useOriginal ? 'application/octet-stream' : 'application/pdf', fileName === undefined);
      if (saved === null) return false;
      if (useOriginal) this.originalFile = { ...this.originalFile!, name: saved };
      else this.documentName = saved;
      this.unsaved = false;
      return true;
    } catch (error) {
      this.notify(toError(error).message, 'error');
      return false;
    }
  }

  /** Saves a file to the user's device, asking for a name first if allowRename is on. Returns the name used, or null if cancelled. */
  async saveFile(bytes: Uint8Array, fileName: string, contentType = 'application/octet-stream', mayAsk = true): Promise<string | null> {
    const name = this.settings.allowRename && mayAsk ? await askFileName(fileName, this.host.dataset.theme === 'dark' ? 'dark' : 'light') : fileName;
    if (name === null) return null;

    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: contentType }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    this.emit('downloaded', { fileName: name });
    return name;
  }

  async print(): Promise<void> {
    if (this.imageView && this.imageBytes) {
      await this.printImage(await this.getBytes());
      return;
    }
    if (!this.engine) return;
    this.showOverlay('Preparing to print…');
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
    try {
      document.body.append(frame);
      const printDocument = frame.contentDocument!;
      printDocument.open();
      printDocument.write('<!doctype html><title>Print</title><style>@page{margin:0}html,body{margin:0}img{display:block;width:100%;break-after:page}img:last-child{break-after:auto}</style>');
      printDocument.close();

      for (let number = 1; number <= this.engine.pageCount; number++) {
        this.showOverlay(`Preparing page ${number} of ${this.engine.pageCount}…`);
        const canvas = document.createElement('canvas');
        await this.engine.render(number, canvas, PRINT_SCALE, 0, new AbortController().signal);
        const context = canvas.getContext('2d')!;
        context.save();
        context.scale(PRINT_SCALE, PRINT_SCALE);
        for (const painter of this.printPainters) await painter(context, number, this.engine.getPageSize(number), 'print');
        context.restore();
        const image = printDocument.createElement('img');
        image.src = canvas.toDataURL('image/jpeg', 0.92);
        printDocument.body.append(image);
        await image.decode();
      }

      this.hideOverlay();
      frame.contentWindow!.addEventListener('afterprint', () => frame.remove(), { once: true });
      frame.contentWindow!.print();
    } catch (error) {
      this.hideOverlay();
      frame.remove();
      this.notify(toError(error).message, 'error');
    }
  }

  private isImageEdited(): boolean {
    return this.imageChangeChecks.some((check) => check());
  }

  // Draws the image at its full size, with plugins' content on top, so an edited image loses no resolution.
  private async renderImage(): Promise<Uint8Array> {
    const url = URL.createObjectURL(new Blob([this.imageBytes as BlobPart], { type: this.imageMimeType }));
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(Math.max(image.naturalWidth, this.imageSize.width));
      canvas.height = Math.round(Math.max(image.naturalHeight, this.imageSize.height));
      const context = canvas.getContext('2d')!;
      // Keeps a tiny image's pixels crisp when it's saved larger.
      context.imageSmoothingEnabled = canvas.width <= image.naturalWidth;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      context.scale(canvas.width / this.imageSize.width, canvas.height / this.imageSize.height);
      for (const painter of this.printPainters) await painter(context, 1, this.imageSize, 'image');
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('The image could not be saved.');
      return new Uint8Array(await blob.arrayBuffer());
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  private async printImage(bytes: Uint8Array): Promise<void> {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: this.isImageEdited() ? 'image/png' : this.imageMimeType }));
    try {
      document.body.append(frame);
      const printDocument = frame.contentDocument!;
      printDocument.open();
      printDocument.write('<!doctype html><title>Print</title><style>@page{margin:10mm}html,body{margin:0}img{display:block;max-width:100%;max-height:100vh;margin:auto}</style>');
      printDocument.close();
      const image = printDocument.createElement('img');
      image.src = url;
      printDocument.body.append(image);
      await image.decode();
      frame.contentWindow!.addEventListener('afterprint', () => {
        frame.remove();
        URL.revokeObjectURL(url);
      }, { once: true });
      frame.contentWindow!.print();
    } catch (error) {
      frame.remove();
      URL.revokeObjectURL(url);
      this.notify(toError(error).message, 'error');
    }
  }

  async search(query: string): Promise<number> {
    const token = ++this.searchToken;
    this.searchQuery = query;
    this.matches = [];
    this.matchIndex = -1;
    this.clearMatches();
    if (!query.trim() || !this.engine) {
      this.emitSearch();
      return 0;
    }

    const needle = query.toLowerCase();
    for (let number = 1; number <= this.engine.pageCount; number++) {
      const runs = await this.getText(number);
      if (token !== this.searchToken) return this.matches.length;
      this.matches.push(...findMatches(runs, needle, number));
      this.emitSearch();
    }

    this.paintMatches();
    if (this.matches.length > 0) this.moveToMatch(0);
    return this.matches.length;
  }

  nextMatch(): void {
    if (this.matches.length) this.moveToMatch((this.matchIndex + 1) % this.matches.length);
  }

  previousMatch(): void {
    if (this.matches.length) this.moveToMatch((this.matchIndex - 1 + this.matches.length) % this.matches.length);
  }

  /** The page's text and positions, in points from the top-left. */
  getPageText(pageNumber: number): Promise<TextRun[]> {
    return this.engine ? this.getText(pageNumber) : Promise.resolve([]);
  }

  setTheme(theme: 'light' | 'dark' | 'auto'): void {
    this.applyTheme(theme);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.loadToken++;
    this.searchToken++;
    this.resizeObserver?.disconnect();
    this.closeDocument();
    for (const plugin of this.options.plugins ?? []) plugin.destroy?.();
    this.listeners.clear();
    this.shadow.replaceChildren();
  }

  // ── Plugins ────────────────────────────────────────────────────────

  private async installPlugins(): Promise<void> {
    const context: ViewerContext = {
      viewer: this,
      root: this.shadow,
      settings: this.settings,
      addStyles: (css) => this.addStyles(css),
      addToolbarButton: (button) => this.addPluginButton(button),
      addSidebarPanel: (panel) => this.addPanel(panel),
      addExportStep: (step) => this.exportSteps.push(step),
      addPrintPainter: (painter) => this.printPainters.push(painter),
      addImageChangeCheck: (check) => this.imageChangeChecks.push(check),
      markChanged: () => {
        this.unsaved = true;
      },
      getPdfJsDocument: () => (this.engine && 'document' in this.engine ? (this.engine as { document: unknown }).document : null),
      hasService: this.service.isConfigured,
      callService: (path, body) => this.service.callJson(path, body),
      notify: (message, kind) => this.notify(message, kind),
    };
    for (const plugin of this.options.plugins ?? []) await plugin.install(context);
  }

  private addPluginButton(button: ToolbarButton): HTMLButtonElement {
    this.pluginGroup.hidden = false;
    const target = button.group ? this.getPluginGroup(button.group) : this.pluginGroup;
    const control = iconButton(button.label, button.icon, button.onClick);
    control.dataset.tool = button.id;
    if (button.toggle) control.setAttribute('aria-pressed', 'false');
    target.append(control);
    return control;
  }

  private getPluginGroup(name: string): HTMLElement {
    let group = this.pluginGroup.parentElement!.querySelector<HTMLElement>(`[data-group="${name}"]`);
    if (!group) {
      group = element('div', 'pv-group');
      group.dataset.group = name;
      this.pluginGroup.parentElement!.insertBefore(group, this.pluginGroup);
    }
    return group;
  }

  private addPanel(panel: SidebarPanel): void {
    const tab = iconButton(panel.label, panel.icon, () => {
      this.toggleSidebar(true);
      this.showPanel(panel.id);
      panel.onShow?.();
    });
    tab.dataset.panel = panel.id;
    if (panel.forImages) tab.dataset.forImages = 'true';
    this.tabs.append(tab);

    const wrapper = element('div', 'pv-tab-panel');
    wrapper.dataset.panel = panel.id;
    wrapper.append(panel.element);
    wrapper.hidden = this.tabPanels.childElementCount > 0;
    this.tabPanels.append(wrapper);
  }

  // Images only get the panels that apply to them. With none, the side panel isn't offered at all.
  private applySidebarForKind(kind: DocumentKind): void {
    const tabs = Array.from(this.tabs.children) as HTMLElement[];
    const usable = tabs.filter((tab) => kind === 'pdf' || tab.dataset.forImages === 'true');
    for (const tab of tabs) tab.hidden = !usable.includes(tab);
    this.controls.sidebar.hidden = usable.length === 0;
    if (usable.length === 0) this.toggleSidebar(false);
    else if (!usable.some((tab) => tab.dataset.panel === this.currentPanel)) this.showPanel(usable[0].dataset.panel!);
  }

  private showPanel(id: string): void {
    this.currentPanel = id;
    for (const panel of this.tabPanels.children) (panel as HTMLElement).hidden = (panel as HTMLElement).dataset.panel !== id;
    for (const tab of this.tabs.children) tab.setAttribute('aria-pressed', String((tab as HTMLElement).dataset.panel === id));
  }

  // ── Building the interface ─────────────────────────────────────────

  private buildToolbar(toolbar: HTMLElement): void {
    const navigation = element('div', 'pv-group');
    const sidebarButton = iconButton('Toggle side panel', ICONS.sidebar, () => this.toggleSidebar());
    sidebarButton.setAttribute('aria-pressed', 'false');
    this.controls.sidebar = sidebarButton;

    const previous = iconButton('Previous page', ICONS.previous, () => this.goToPage(this.currentPage - 1));
    const next = iconButton('Next page', ICONS.next, () => this.goToPage(this.currentPage + 1));
    const pageInput = element('input', 'pv-input pv-page-input') as HTMLInputElement;
    pageInput.type = 'text';
    pageInput.inputMode = 'numeric';
    pageInput.setAttribute('aria-label', 'Page number');
    pageInput.addEventListener('change', () => {
      const number = Number.parseInt(pageInput.value, 10);
      if (Number.isFinite(number)) this.goToPage(Math.min(Math.max(number, 1), this.pageCount));
      pageInput.value = String(this.currentPage);
    });
    const total = element('span', 'pv-page-total');
    Object.assign(this.controls, { previous, next, pageInput, total });
    for (const control of [previous, next, pageInput, total]) control.dataset.pdfOnly = '';
    navigation.append(sidebarButton, previous, next, pageInput, total);

    const zoom = element('div', 'pv-group');
    const zoomSelect = element('select', 'pv-select') as HTMLSelectElement;
    zoomSelect.setAttribute('aria-label', 'Zoom level');
    const zoomOptions: Array<[string, string]> = [['fit-width', 'Fit width'], ['fit-page', 'Whole page'], ...ZOOM_STEPS.map((step): [string, string] => [String(step), `${Math.round(step * 100)}%`])];
    for (const [value, label] of zoomOptions) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      zoomSelect.append(option);
    }
    const customOption = document.createElement('option');
    customOption.hidden = true;
    customOption.value = 'custom';
    zoomSelect.append(customOption);
    zoomSelect.addEventListener('change', () => {
      const value = zoomSelect.value;
      this.setZoom(value === 'fit-width' || value === 'fit-page' ? value : Number(value));
    });
    this.controls.zoomSelect = zoomSelect;
    this.controls.zoomCustom = customOption;
    zoom.append(iconButton('Zoom out', ICONS.zoomOut, () => this.zoomOut()), zoomSelect, iconButton('Zoom in', ICONS.zoomIn, () => this.zoomIn()));

    const view = element('div', 'pv-group');
    const imageButton = (label: string, icon: string, action: (image: ImageView) => void) => {
      const button = iconButton(label, icon, () => {
        if (this.imageView) action(this.imageView);
      });
      button.dataset.imageOnly = '';
      return button;
    };
    const rotateButton = iconButton('Rotate view', ICONS.rotate, () => this.rotateView());
    const rotateLeftButton = imageButton('Rotate left', ICONS.rotateLeft, (image) => image.rotate(-90));
    rotateButton.hidden = !this.settings.allowRotate;
    rotateLeftButton.hidden = !this.settings.allowRotate;
    view.append(
      rotateButton,
      rotateLeftButton,
      imageButton('Flip horizontally', ICONS.flipHorizontal, (image) => image.flip('horizontal')),
      imageButton('Flip vertically', ICONS.flipVertical, (image) => image.flip('vertical')),
      imageButton('Actual size', ICONS.actualSize, (image) => image.zoomTo(1)),
    );

    const actions = element('div', 'pv-group');
    if (this.settings.allowOpen) {
      const fileInput = element('input', 'pv-file-input') as HTMLInputElement;
      fileInput.type = 'file';
      fileInput.accept = '.pdf,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.html,.htm,.md,.txt,.png,.jpg,.jpeg,.gif,.webp,.bmp,.svg,.avif,.ico';
      fileInput.setAttribute('aria-label', 'Choose a file to open');
      fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        if (file) void this.load(file);
        fileInput.value = '';
      });
      actions.append(fileInput, iconButton('Open file', ICONS.open, () => fileInput.click()));
    }
    const searchButton = iconButton('Search', ICONS.search, () => this.toggleSearch());
    searchButton.dataset.pdfOnly = '';
    searchButton.hidden = !this.settings.allowSearch;
    const printButton = iconButton('Print', ICONS.print, () => void this.print());
    printButton.hidden = !this.settings.allowPrint;
    const downloadButton = iconButton('Download', ICONS.download, () => void this.download());
    downloadButton.hidden = !this.settings.allowDownload;
    actions.append(searchButton, printButton, downloadButton);

    toolbar.append(navigation, zoom, view, this.pluginGroup, this.mainGroup, actions);
  }

  private buildSearchBar(): HTMLElement {
    const bar = element('div', 'pv-searchbar');
    bar.setAttribute('role', 'search');
    const input = element('input', 'pv-input pv-search-input') as HTMLInputElement;
    input.type = 'search';
    input.placeholder = 'Find in document';
    input.setAttribute('aria-label', 'Find in document');
    const count = element('span', 'pv-search-count');
    count.setAttribute('aria-live', 'polite');
    input.addEventListener('input', () => {
      clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(() => void this.search(input.value), SEARCH_DELAY_MS);
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (event.shiftKey) this.previousMatch();
        else this.nextMatch();
      }
      if (event.key === 'Escape') {
        // Only closes search, not a modal around the viewer.
        event.preventDefault();
        event.stopPropagation();
        this.toggleSearch(false);
      }
    });
    this.controls.searchInput = input;
    this.controls.searchCount = count;
    bar.append(
      input,
      iconButton('Previous match', ICONS.previous, () => this.previousMatch()),
      iconButton('Next match', ICONS.next, () => this.nextMatch()),
      count,
      iconButton('Close search', ICONS.close, () => this.toggleSearch(false)),
    );
    return bar;
  }

  private toggleSidebar(open?: boolean): void {
    const isOpen = open ?? this.sidebar.dataset.open !== 'true';
    this.sidebar.dataset.open = String(isOpen);
    this.controls.sidebar.setAttribute('aria-pressed', String(isOpen));
  }

  private toggleSearch(open?: boolean): void {
    const isOpen = open ?? this.searchBar.dataset.open !== 'true';
    this.searchBar.dataset.open = String(isOpen);
    const input = this.controls.searchInput as HTMLInputElement;
    if (isOpen) {
      input.focus();
      input.select();
    } else {
      this.searchToken++;
      input.value = '';
      void this.search('');
      this.scroller.focus();
    }
  }

  private handleKey(event: KeyboardEvent): void {
    const target = event.composedPath()[0] as HTMLElement;
    const isTyping = target.matches?.('input, textarea, select, [contenteditable]');
    if (this.settings.allowSearch && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      this.toggleSearch(true);
      return;
    }
    if (isTyping || event.ctrlKey || event.metaKey || event.altKey) return;

    switch (event.key) {
      case 'PageDown':
        event.preventDefault();
        this.goToPage(Math.min(this.currentPage + 1, this.pageCount));
        break;
      case 'PageUp':
        event.preventDefault();
        this.goToPage(Math.max(this.currentPage - 1, 1));
        break;
      case 'Home':
        event.preventDefault();
        this.goToPage(1);
        break;
      case 'End':
        event.preventDefault();
        this.goToPage(this.pageCount);
        break;
      case '+':
      case '=':
        this.zoomIn();
        break;
      case '-':
        this.zoomOut();
        break;
    }
  }

  // ── Documents and pages ────────────────────────────────────────────

  private async openEngine(bytes: Uint8Array, name: string): Promise<DocumentEngine> {
    if (this.settings.mode === 'server') {
      if (!this.service.isConfigured) throw new Error('Server mode needs the serviceUrl option.');
      const { ServerEngine } = await import('./engines/server-engine');
      return ServerEngine.open(bytes, name, this.service);
    }

    const { ClientEngine } = await import('./engines/client-engine');
    return ClientEngine.open(bytes, {
      workerSrc: this.options.workerSrc,
      onPassword: this.options.onPassword ?? ((retry) => this.askPassword(retry)),
    });
  }

  private async openImage(loaded: LoadedSource, mimeType: string, token: number): Promise<void> {
    const { ImageView, IMAGE_VIEW_CSS } = await import('./image-view');
    // Checked first, so a damaged image leaves whatever is already open in place.
    const { url, width, height } = await ImageView.validate(loaded.bytes, mimeType);
    if (token !== this.loadToken) {
      URL.revokeObjectURL(url);
      return;
    }

    if (!this.imageStylesAdded) {
      this.addStyles(IMAGE_VIEW_CSS);
      this.imageStylesAdded = true;
    }

    this.closeDocument();
    this.root.dataset.kind = 'image';
    this.documentName = nameForType(loaded.name, mimeType);
    this.imageBytes = loaded.bytes;
    this.imageMimeType = mimeType;
    const longestSide = Math.max(width, height, 1);
    const scale = longestSide < IMAGE_MIN_LOGICAL_SIZE ? IMAGE_MIN_LOGICAL_SIZE / longestSide : Math.min(1, IMAGE_MAX_LOGICAL_SIZE / longestSide);
    this.imageSize = { width: (width || IMAGE_MAX_LOGICAL_SIZE) * scale, height: (height || IMAGE_MAX_LOGICAL_SIZE) * scale };
    this.applySidebarForKind('image');
    this.emptyState.hidden = true;
    this.hideOverlay();
    (this.controls.searchInput as HTMLInputElement).value = '';
    this.searchBar.dataset.open = 'false';
    this.imageView = await ImageView.open(this.imageHost, url, this.documentName, this.imageSize, (ratio) => {
      this.syncImageZoom(ratio);
      this.emit('zoomChanged', { scale: ratio });
    });
    this.emit('pageLayersReady', { pageNumber: 1, layer: this.imageView.layer, size: this.imageSize });
    this.emit('documentLoaded', { pageCount: 1, fileName: this.documentName, kind: 'image' });
  }

  private closeDocument(): void {
    this.unsaved = false;
    this.originalFile = null;
    this.imageView?.destroy();
    this.imageView = null;
    this.imageBytes = null;
    this.pageObserver?.disconnect();
    this.thumbObserver?.disconnect();
    for (const view of this.pageViews) view.abort?.abort();
    this.pageViews = [];
    this.pagesHost.replaceChildren();
    this.thumbnails.replaceChildren();
    this.textCache.clear();
    this.matches = [];
    this.matchIndex = -1;
    this.engine?.destroy();
    this.engine = null;
  }

  private buildPages(): void {
    const engine = this.engine!;
    this.rotation = 0;
    this.currentPage = 1;
    this.pageObserver = new IntersectionObserver((entries) => this.handlePageVisibility(entries), { root: this.scroller, rootMargin: RENDER_MARGIN });
    this.thumbObserver = new IntersectionObserver((entries) => this.handleThumbVisibility(entries), { root: this.sidebar, rootMargin: '300px' });

    for (let number = 1; number <= engine.pageCount; number++) {
      const size = engine.getPageSize(number);
      const page = element('div', 'pv-page') as HTMLDivElement;
      page.dataset.page = String(number);
      page.setAttribute('role', 'img');
      page.setAttribute('aria-label', `Page ${number} of ${engine.pageCount}`);
      const layers = element('div', 'pv-layers') as HTMLDivElement;
      layers.style.width = `${size.width}px`;
      layers.style.height = `${size.height}px`;
      const textLayer = element('div', 'pv-text') as HTMLDivElement;
      const matchLayer = element('div', 'pv-matches') as HTMLDivElement;
      const pluginLayer = element('div', 'pv-plugins') as HTMLDivElement;
      layers.append(textLayer, matchLayer, pluginLayer);
      page.append(layers);
      this.pagesHost.append(page);
      this.pageViews.push({ number, size, element: page, canvas: null, layers, textLayer, matchLayer, pluginLayer, renderedKey: null, abort: null, textLoaded: false });

      const thumb = document.createElement('button');
      thumb.type = 'button';
      thumb.className = 'pv-thumb';
      thumb.dataset.page = String(number);
      thumb.setAttribute('aria-label', `Go to page ${number}`);
      thumb.style.width = `${THUMBNAIL_WIDTH}px`;
      const canvas = document.createElement('canvas');
      canvas.style.aspectRatio = `${size.width} / ${size.height}`;
      const label = element('span', 'pv-thumb-label');
      label.textContent = String(number);
      thumb.append(canvas, label);
      thumb.addEventListener('click', () => this.goToPage(number));
      this.thumbnails.append(thumb);
      this.thumbObserver.observe(thumb);
    }

    (this.controls.total as HTMLElement).textContent = `of ${engine.pageCount}`;
    this.applyZoom(true);
    for (const view of this.pageViews) {
      this.pageObserver.observe(view.element);
      this.emit('pageLayersReady', { pageNumber: view.number, layer: view.pluginLayer, size: view.size });
    }
    this.scroller.scrollTop = 0;
    this.setCurrentPage(1, true);
  }

  private computeScale(): number {
    if (typeof this.zoomSetting === 'number') return clamp(this.zoomSetting, MIN_ZOOM, MAX_ZOOM);
    const first = this.pageViews[0];
    if (!first) return 1;
    const sideways = this.rotation === 90 || this.rotation === 270;
    const width = sideways ? first.size.height : first.size.width;
    const height = sideways ? first.size.width : first.size.height;
    const padding = 34; // scroller padding plus a scrollbar's width
    const widthScale = (this.scroller.clientWidth - padding) / width;
    const pageScale = (this.scroller.clientHeight - padding) / height;
    const scale = this.zoomSetting === 'fit-width' ? widthScale : Math.min(widthScale, pageScale);
    return clamp(scale > 0 ? scale : 1, MIN_ZOOM, MAX_ZOOM);
  }

  private applyZoom(force = false): void {
    if (!this.engine) return;
    const scale = this.computeScale();
    if (!force && scale === this.scale) {
      this.syncZoomControl();
      return;
    }

    // Keeps the same spot on the page in view, instead of jumping to the page's top, which would make resizing jittery.
    const keepPage = this.currentPage;
    const keepView = this.pageViews[keepPage - 1];
    const keepTop = keepView.element.offsetTop - this.pagesHost.offsetTop;
    const keepFraction = keepView.element.offsetHeight > 0 && !force ? (this.scroller.scrollTop - keepTop) / keepView.element.offsetHeight : 0;
    this.scale = scale;
    for (const view of this.pageViews) this.layoutPage(view);
    this.syncZoomControl();
    this.scroller.scrollTop = keepView.element.offsetTop - this.pagesHost.offsetTop + keepFraction * keepView.element.offsetHeight;
    this.setCurrentPage(keepPage);
    this.emit('zoomChanged', { scale });

    // While zooming, canvases are stretched by CSS, then re-rendered sharply once it settles.
    clearTimeout(this.zoomTimer);
    this.zoomTimer = window.setTimeout(() => this.renderVisiblePages(), ZOOM_RERENDER_DELAY_MS);
  }

  private layoutPage(view: PageView): void {
    const sideways = this.rotation === 90 || this.rotation === 270;
    const width = (sideways ? view.size.height : view.size.width) * this.scale;
    const height = (sideways ? view.size.width : view.size.height) * this.scale;
    view.element.style.width = `${Math.floor(width)}px`;
    view.element.style.height = `${Math.floor(height)}px`;

    const rotate: Record<ViewRotation, string> = {
      0: '',
      90: 'rotate(90deg) translateY(-100%)',
      180: 'rotate(180deg) translate(-100%, -100%)',
      270: 'rotate(270deg) translateX(-100%)',
    };
    view.layers.style.transform = `scale(${this.scale}) ${rotate[this.rotation]}`;
  }

  private syncImageZoom(ratio: number): void {
    const select = this.controls.zoomSelect as HTMLSelectElement;
    const step = ZOOM_STEPS.find((value) => Math.abs(value - ratio) < 0.001);
    if (step !== undefined) {
      select.value = String(step);
    } else {
      this.controls.zoomCustom.textContent = `${Math.round(ratio * 100)}%`;
      select.value = 'custom';
    }
  }

  private syncZoomControl(): void {
    const select = this.controls.zoomSelect as HTMLSelectElement;
    const value = typeof this.zoomSetting === 'number' ? String(this.zoomSetting) : this.zoomSetting;
    const known = Array.from(select.options).some((option) => option.value === value && option.value !== 'custom');
    if (known) {
      select.value = value;
    } else {
      this.controls.zoomCustom.textContent = `${Math.round(this.scale * 100)}%`;
      select.value = 'custom';
    }
  }

  private handlePageVisibility(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const view = this.pageViews[Number((entry.target as HTMLElement).dataset.page) - 1];
      if (view) void this.renderPage(view);
    }
  }

  private renderVisiblePages(): void {
    const top = this.scroller.scrollTop - 800;
    const bottom = this.scroller.scrollTop + this.scroller.clientHeight + 800;
    for (const view of this.pageViews) {
      const pageTop = view.element.offsetTop - this.pagesHost.offsetTop;
      if (pageTop + view.element.offsetHeight >= top && pageTop <= bottom) void this.renderPage(view);
    }
  }

  private async renderPage(view: PageView): Promise<void> {
    const engine = this.engine;
    if (!engine) return;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    let scale = this.scale * pixelRatio;
    const pixels = view.size.width * view.size.height * scale * scale;
    if (pixels > MAX_CANVAS_PIXELS) scale *= Math.sqrt(MAX_CANVAS_PIXELS / pixels);

    const key = `${scale.toFixed(3)}:${this.rotation}`;
    if (view.renderedKey === key) return;
    view.abort?.abort();
    const abort = new AbortController();
    view.abort = abort;
    view.renderedKey = key;

    // Drawn off-screen and swapped in, so a page never flashes blank while it re-renders.
    const canvas = document.createElement('canvas');
    canvas.className = 'pv-canvas';
    try {
      await engine.render(view.number, canvas, scale, this.rotation, abort.signal);
      if (abort.signal.aborted || engine !== this.engine) return;
      view.canvas?.remove();
      view.canvas = canvas;
      view.element.prepend(canvas);
      view.element.dataset.rendered = 'true';
      void this.loadTextLayer(view);
      this.releaseDistantPages();
    } catch (error) {
      if (abort.signal.aborted || isCancellation(error)) return;
      view.renderedKey = null;
      this.notify(`Page ${view.number} could not be displayed. ${toError(error).message}`, 'error');
    }
  }

  private releaseDistantPages(): void {
    for (const view of this.pageViews) {
      if (Math.abs(view.number - this.currentPage) <= KEPT_PAGES_AROUND_VIEW || !view.canvas) continue;
      const top = view.element.offsetTop - this.pagesHost.offsetTop;
      const margin = this.scroller.clientHeight * 2;
      if (top + view.element.offsetHeight < this.scroller.scrollTop - margin || top > this.scroller.scrollTop + this.scroller.clientHeight + margin) {
        view.canvas.remove();
        view.canvas = null;
        view.renderedKey = null;
        delete view.element.dataset.rendered;
        // The observer only reports changes, so it has to be re-armed for this page to render again.
        this.pageObserver?.unobserve(view.element);
        this.pageObserver?.observe(view.element);
      }
    }
  }

  private async getText(pageNumber: number): Promise<TextRun[]> {
    let runs = this.textCache.get(pageNumber);
    if (!runs) {
      runs = await this.engine!.getTextRuns(pageNumber);
      this.textCache.set(pageNumber, runs);
    }
    return runs;
  }

  private async loadTextLayer(view: PageView): Promise<void> {
    if (view.textLoaded) return;
    view.textLoaded = true;
    try {
      const runs = await this.getText(view.number);
      const measure = document.createElement('canvas').getContext('2d')!;
      const fragment = document.createDocumentFragment();
      for (const run of runs) {
        const span = document.createElement('span');
        span.textContent = run.text;
        span.style.left = `${run.left}px`;
        span.style.top = `${run.top}px`;
        span.style.fontSize = `${run.height}px`;
        span.style.fontFamily = 'sans-serif';
        // Stretches browser text to the PDF's exact width, so selections line up with what's on the page.
        measure.font = `${run.height}px sans-serif`;
        const natural = measure.measureText(run.text).width;
        if (natural > 0 && run.width > 0) span.style.transform = `scaleX(${run.width / natural})`;
        fragment.append(span, document.createTextNode(' '));
      }
      view.textLayer.replaceChildren(fragment);
    } catch {
      // Selection is optional, so the page stays usable without it.
      view.textLoaded = false;
    }
  }

  private async handleThumbVisibility(entries: IntersectionObserverEntry[]): Promise<void> {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const thumb = entry.target as HTMLElement;
      this.thumbObserver?.unobserve(thumb);
      const number = Number(thumb.dataset.page);
      const engine = this.engine;
      if (!engine) return;
      const canvas = thumb.querySelector('canvas')!;
      const scale = THUMBNAIL_WIDTH / engine.getPageSize(number).width;
      try {
        await engine.render(number, canvas, scale, 0, new AbortController().signal);
      } catch (error) {
        if (!isCancellation(error) && engine === this.engine) thumb.setAttribute('data-failed', 'true');
      }
    }
  }

  private updateCurrentPage(): void {
    const middle = this.scroller.scrollTop + this.scroller.clientHeight / 2;
    for (const view of this.pageViews) {
      const top = view.element.offsetTop - this.pagesHost.offsetTop;
      if (top + view.element.offsetHeight >= middle) {
        this.setCurrentPage(view.number);
        return;
      }
    }
  }

  private setCurrentPage(pageNumber: number, force = false): void {
    if (pageNumber === this.currentPage && !force) return;
    this.currentPage = pageNumber;
    (this.controls.pageInput as HTMLInputElement).value = String(pageNumber);
    (this.controls.previous as HTMLButtonElement).disabled = pageNumber <= 1;
    (this.controls.next as HTMLButtonElement).disabled = pageNumber >= this.pageCount;
    for (const thumb of this.thumbnails.children) {
      if ((thumb as HTMLElement).dataset.page === String(pageNumber)) {
        thumb.setAttribute('aria-current', 'page');
        thumb.scrollIntoView({ block: 'nearest' });
      } else {
        thumb.removeAttribute('aria-current');
      }
    }
    this.emit('pageChanged', { pageNumber });
  }

  private handleResize(): void {
    if (this.imageView) {
      this.imageView.resize();
      return;
    }

    const width = this.scroller.clientWidth;
    const height = this.scroller.clientHeight;
    const heightMatters = this.zoomSetting === 'fit-page' && height !== this.lastHeight;
    if (width === this.lastWidth && !heightMatters) return;
    this.lastWidth = width;
    this.lastHeight = height;
    if (typeof this.zoomSetting !== 'number') this.applyZoom();
  }

  // ── Search highlights ──────────────────────────────────────────────

  private clearMatches(): void {
    for (const view of this.pageViews) view.matchLayer.replaceChildren();
  }

  private paintMatches(): void {
    this.clearMatches();
    this.matches.forEach((match, index) => {
      const view = this.pageViews[match.pageNumber - 1];
      for (const rect of match.rects) {
        const box = element('div', 'pv-match');
        box.dataset.matchIndex = String(index);
        box.style.cssText = `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;
        view.matchLayer.append(box);
      }
    });
  }

  private moveToMatch(index: number): void {
    this.matchIndex = index;
    const match = this.matches[index];
    this.shadow.querySelectorAll<HTMLElement>('.pv-match').forEach((box) => {
      box.dataset.current = String(box.dataset.matchIndex === String(index));
    });
    const view = this.pageViews[match.pageNumber - 1];
    const rect = match.rects[0];
    const pageTop = view.element.offsetTop - this.pagesHost.offsetTop;
    this.scroller.scrollTop = Math.max(0, pageTop + rect.top * this.scale - this.scroller.clientHeight / 3);
    this.emitSearch();
  }

  private emitSearch(): void {
    const count = this.controls.searchCount;
    const total = this.matches.length;
    count.textContent = !this.searchQuery.trim() ? '' : total === 0 ? 'No matches' : `${Math.max(this.matchIndex + 1, 1)} of ${total}`;
    this.emit('searchChanged', { query: this.searchQuery, matchCount: total, current: this.matchIndex + 1 });
  }

  // ── Small helpers ──────────────────────────────────────────────────

  private emit<K extends keyof ViewerEvents>(event: K, payload: ViewerEvents[K]): void {
    this.listeners.get(event)?.forEach((listener) => (listener as Listener<K>)(payload));
  }

  private addStyles(css: string): void {
    // Constructed stylesheets also work under a strict content security policy.
    if ('adoptedStyleSheets' in Document.prototype && 'replaceSync' in CSSStyleSheet.prototype) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      this.shadow.adoptedStyleSheets = [...this.shadow.adoptedStyleSheets, sheet];
    } else {
      const style = document.createElement('style');
      style.textContent = css;
      this.shadow.prepend(style);
    }
  }

  private applyTheme(theme: 'light' | 'dark' | 'auto'): void {
    const dark = theme === 'dark' || (theme === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
    this.host.dataset.theme = dark ? 'dark' : 'light';
  }

  private showOverlay(message: string): void {
    this.overlay.hidden = false;
    this.overlay.replaceChildren(element('div', 'pv-spinner'));
    const text = element('div');
    text.textContent = message;
    text.setAttribute('role', 'status');
    this.overlay.append(text);
  }

  private hideOverlay(): void {
    this.overlay.hidden = true;
  }

  notify(message: string, kind: 'info' | 'error' = 'info'): void {
    this.root.querySelector('.pv-toast')?.remove();
    const toast = element('div', 'pv-toast');
    toast.dataset.kind = kind;
    toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    toast.textContent = message;
    this.root.append(toast);
    setTimeout(() => toast.remove(), TOAST_MS);
  }

  private askPassword(retry: boolean): Promise<string | null> {
    this.hideOverlay();
    return new Promise((resolve) => {
      const form = element('form', 'pv-dialog') as HTMLFormElement;
      form.setAttribute('role', 'dialog');
      form.setAttribute('aria-label', 'Password required');
      const title = element('h2');
      title.textContent = retry ? 'Incorrect password, try again' : 'This document needs a password';
      const input = element('input', 'pv-input') as HTMLInputElement;
      input.type = 'password';
      input.setAttribute('aria-label', 'Password');
      const actions = element('div', 'pv-dialog-actions');
      const cancel = element('button', 'pv-btn') as HTMLButtonElement;
      cancel.type = 'button';
      cancel.textContent = 'Cancel';
      const submit = element('button', 'pv-btn pv-primary') as HTMLButtonElement;
      submit.type = 'submit';
      submit.textContent = 'Open';
      actions.append(cancel, submit);
      form.append(title, input, actions);

      const finish = (value: string | null) => {
        form.remove();
        if (value !== null) this.showOverlay('Opening document…');
        resolve(value);
      };
      cancel.addEventListener('click', () => finish(null));
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        finish(input.value);
      });
      this.root.append(form);
      input.focus();
    });
  }
}

function element(tag: string, className = ''): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function iconButton(label: string, icon: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pv-btn';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>`;
  button.addEventListener('click', onClick);
  return button;
}

function pdfFileName(name: string): string {
  return /\.pdf$/i.test(name) ? name : `${name.replace(/\.[^.]+$/, '')}.pdf`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isCancellation(error: unknown): boolean {
  const name = (error as { name?: string })?.name;
  return name === 'AbortError' || name === 'RenderingCancelledException';
}

/** Finds a lowercase query in a page's text, including matches that run across several pieces of text. */
export function findMatches(runs: TextRun[], needle: string, pageNumber: number): SearchMatch[] {
  let haystack = '';
  const spans: Array<{ start: number; end: number; run: TextRun }> = [];
  for (const run of runs) {
    const start = haystack.length;
    haystack += run.text.toLowerCase();
    spans.push({ start, end: haystack.length, run });
    haystack += ' ';
  }

  const matches: SearchMatch[] = [];
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + needle.length)) {
    const end = at + needle.length;
    const rects = spans
      .filter((span) => span.start < end && span.end > at)
      .map(({ start, end: spanEnd, run }) => {
        const length = Math.max(spanEnd - start, 1);
        const from = Math.max(at - start, 0) / length;
        const to = Math.min(end - start, length) / length;
        return { left: run.left + run.width * from, top: run.top, width: run.width * (to - from), height: run.height };
      });
    if (rects.length > 0) matches.push({ pageNumber, rects });
  }
  return matches;
}
