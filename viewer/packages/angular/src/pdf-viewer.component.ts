import { afterNextRender, ChangeDetectionStrategy, Component, ElementRef, EventEmitter, inject, Input, NgZone, OnChanges, OnDestroy, Output, SimpleChanges, ViewEncapsulation } from '@angular/core';
import { createViewer, type DocumentSource, type PdfViewer, type ViewerEvents, type ViewerOptions } from '@document-suite/viewer';

/** The PDF viewer as a standalone Angular component. Its `viewer` property gives access to the full API. Give it a height. */
@Component({
  selector: 'document-suite-viewer',
  standalone: true,
  template: '',
  styles: ':host { display: block; height: 100%; }',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.Emulated,
})
export class PdfViewerComponent implements OnChanges, OnDestroy {
  /** The document to open. Changing it opens the new document. */
  @Input() source?: DocumentSource;
  @Input() fileName?: string;
  @Input() theme?: ViewerOptions['theme'];
  /** All other viewer options. They're read once, when the viewer is created. */
  @Input() options: Omit<ViewerOptions, 'source' | 'fileName' | 'theme'> = {};

  @Output() documentLoaded = new EventEmitter<ViewerEvents['documentLoaded']>();
  @Output() documentError = new EventEmitter<ViewerEvents['documentError']>();
  @Output() pageChanged = new EventEmitter<ViewerEvents['pageChanged']>();
  @Output() zoomChanged = new EventEmitter<ViewerEvents['zoomChanged']>();

  viewer?: PdfViewer;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly zone = inject(NgZone);

  constructor() {
    // Runs only in the browser, so the component is safe to server-render.
    afterNextRender(() => {
      // Scrolling and rendering stay outside Angular's zone, so they don't trigger change detection in the host app.
      this.zone.runOutsideAngular(() => {
        const viewer = createViewer(this.host.nativeElement, { ...this.options, theme: this.theme });
        viewer.on('documentLoaded', (event) => this.zone.run(() => this.documentLoaded.emit(event)));
        viewer.on('documentError', (event) => this.zone.run(() => this.documentError.emit(event)));
        viewer.on('pageChanged', (event) => this.zone.run(() => this.pageChanged.emit(event)));
        viewer.on('zoomChanged', (event) => this.zone.run(() => this.zoomChanged.emit(event)));
        this.viewer = viewer;
        if (this.source !== undefined) void viewer.load(this.source, this.fileName);
      });
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.viewer) return;
    if ((changes['source'] || changes['fileName']) && this.source !== undefined) {
      void this.zone.runOutsideAngular(() => this.viewer!.load(this.source!, this.fileName));
    }
    if (changes['theme'] && this.theme) this.viewer.setTheme(this.theme);
  }

  ngOnDestroy(): void {
    this.viewer?.destroy();
  }
}
