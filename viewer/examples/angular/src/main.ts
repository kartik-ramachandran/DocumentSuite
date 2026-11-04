import { afterNextRender, Component, signal, viewChild } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { FileListComponent, PdfViewerComponent, SettingsPanelComponent, type FileItem, type FileListOptions, type ViewerOptions } from '@pdf-suite/angular';
import { createEditorPlugin } from '@pdf-suite/editor';
import { applyDemoSettings, demoPanelOptions } from '../../shared/demo-settings';
import { createSampleFiles, filesFromInput } from '../../shared/sample-files';

// Query parameters let the same demo run every mode: ?view=viewer&mode=server&transport=json&editor=0&rename=1
const params = new URLSearchParams(location.search);
applyDemoSettings();

const plugin = params.get('editor') === '0' ? null : createEditorPlugin();

const viewerOptions: ViewerOptions = {
  mode: (params.get('mode') as ViewerOptions['mode']) ?? undefined,
  serviceUrl: params.get('service') ?? 'http://localhost:8080',
  serviceTransport: (params.get('transport') as ViewerOptions['serviceTransport']) ?? 'multipart',
  plugins: plugin ? [plugin] : [],
};

@Component({
  selector: 'app-viewer-demo',
  imports: [PdfViewerComponent],
  template: '<pdf-suite-viewer [source]="source()" [options]="options" />',
})
class ViewerDemoComponent {
  readonly source = signal(params.get('source') ?? undefined);
  readonly options = viewerOptions;
  private readonly component = viewChild.required(PdfViewerComponent);

  constructor() {
    afterNextRender(() => {
      Object.assign(window, { pdfViewer: this.component().viewer, pdfPlugin: plugin, setDemoSource: (value: string) => this.source.set(value) });
    });
  }
}

@Component({
  selector: 'app-files-demo',
  imports: [FileListComponent, SettingsPanelComponent],
  template: `
    <main style="display: block; max-width: 900px; margin: 32px auto; padding: 0 16px; font-family: system-ui, sans-serif">
      <h1 style="font-size: 22px">Your files</h1>
      <p>Click a file to open it, or right-click it for more actions.</p>
      <p><label>Add files <input type="file" multiple aria-label="Add files" (change)="addFiles($event)" /></label></p>
      <details style="margin-bottom: 16px">
        <summary style="cursor: pointer; font-weight: 600">Settings</summary>
        <div style="margin-top: 12px"><pdf-suite-settings-panel [options]="panelOptions" /></div>
      </details>
      <pdf-suite-file-list [files]="files()" [options]="options" />
    </main>
  `,
})
class FilesDemoComponent {
  readonly files = signal<FileItem[]>([]);
  readonly panelOptions = demoPanelOptions(params.get('service') ?? 'http://localhost:8080');
  readonly options: Omit<FileListOptions, 'files'> = {
    viewer: viewerOptions,
    menuItems: [{ id: 'remove', label: 'Remove from list', danger: true, separator: true, onSelect: (file) => this.files.update((current) => current.filter((item) => item !== file)) }],
  };

  constructor() {
    void createSampleFiles().then((samples) => this.files.set(samples));
  }

  addFiles(event: Event): void {
    const added = filesFromInput((event.target as HTMLInputElement).files);
    this.files.update((current) => [...current, ...added]);
  }
}

@Component({
  selector: 'app-root',
  imports: [ViewerDemoComponent, FilesDemoComponent],
  template: `@if (isViewerDemo) { <app-viewer-demo /> } @else { <app-files-demo /> }`,
  styles: ':host { display: block; height: 100%; } app-viewer-demo { display: block; height: 100%; }',
})
class AppComponent {
  readonly isViewerDemo = params.get('view') === 'viewer';
}

bootstrapApplication(AppComponent).catch((error) => console.error(error));
