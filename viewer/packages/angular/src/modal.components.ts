import { afterNextRender, ChangeDetectionStrategy, Component, ElementRef, EventEmitter, inject, Input, NgZone, OnChanges, OnDestroy, Output, SimpleChanges } from '@angular/core';
import { createFileList, createSettingsPanel, openViewerModal, type SettingsPanel, type SettingsPanelOptions, type DocumentSource, type FileItem, type FileList, type FileListOptions, type ViewerModal, type ViewerModalOptions } from '@pdf-suite/viewer';

/** The viewer in a movable, resizable modal. Its `modal` property gives access to the modal and its viewer. */
@Component({
  selector: 'pdf-suite-viewer-modal',
  standalone: true,
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PdfViewerModalComponent implements OnChanges, OnDestroy {
  /** Shows the modal while true. */
  @Input() open = false;
  @Input() source?: DocumentSource;
  @Input() fileName?: string;
  @Input() title?: string;
  /** All other modal and viewer options. They're read when the modal opens. */
  @Input() options: Omit<ViewerModalOptions, 'source' | 'fileName' | 'title' | 'onClose'> = {};

  /** The user closed the modal. Set `open` to false in response. */
  @Output() closed = new EventEmitter<void>();

  modal?: ViewerModal;

  private readonly zone = inject(NgZone);
  private rendered = false;

  constructor() {
    afterNextRender(() => {
      this.rendered = true;
      if (this.open) this.show();
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.rendered) return;
    if (changes['open']) {
      if (this.open && !this.modal) this.show();
      else if (!this.open) void this.modal?.close(true);
    }
    if ((changes['source'] || changes['fileName']) && this.source !== undefined && this.modal && !changes['open']) {
      void this.zone.runOutsideAngular(() => this.modal!.load(this.source!, this.fileName));
    }
    if (changes['title'] && this.title) this.modal?.setTitle(this.title);
  }

  ngOnDestroy(): void {
    void this.modal?.close(true);
  }

  private show(): void {
    this.zone.runOutsideAngular(() => {
      const modal = openViewerModal({
        ...this.options,
        title: this.title,
        fileName: this.fileName,
        onClose: () => {
          this.modal = undefined;
          this.zone.run(() => this.closed.emit());
        },
      });
      this.modal = modal;
      if (this.source !== undefined) void modal.load(this.source, this.fileName);
    });
  }
}

/** A list of files. Click to open one in the viewer modal, or right-click for its menu. */
@Component({
  selector: 'pdf-suite-file-list',
  standalone: true,
  template: '',
  styles: ':host { display: block; }',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileListComponent implements OnChanges, OnDestroy {
  @Input() files: FileItem[] = [];
  /** All other list options, such as `clickAction`, `menuItems` and `viewer`. */
  @Input() options: Omit<FileListOptions, 'files'> = {};

  list?: FileList;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly zone = inject(NgZone);

  constructor() {
    afterNextRender(() => {
      this.zone.runOutsideAngular(() => {
        this.list = createFileList(this.host.nativeElement, { ...this.options, files: this.files });
      });
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['files']) this.list?.setFiles(this.files);
    if (changes['options']) this.list?.setOptions(this.options);
  }

  ngOnDestroy(): void {
    this.list?.destroy();
  }
}

/** A ready-made settings screen. Changes apply straight away. */
@Component({
  selector: 'pdf-suite-settings-panel',
  standalone: true,
  template: '',
  styles: ':host { display: block; }',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsPanelComponent implements OnDestroy {
  @Input() options: SettingsPanelOptions = {};

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly zone = inject(NgZone);
  private panel?: SettingsPanel;

  constructor() {
    afterNextRender(() => {
      this.zone.runOutsideAngular(() => {
        this.panel = createSettingsPanel(this.host.nativeElement, this.options);
      });
    });
  }

  ngOnDestroy(): void {
    this.panel?.destroy();
  }
}
