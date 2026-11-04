import { afterNextRender, Component, signal, viewChild } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { PdfViewerComponent, type ViewerOptions } from '@pdf-suite/angular';
import { createEditorPlugin } from '@pdf-suite/editor';

// Query parameters let the same demo run every mode: ?mode=server&transport=json&editor=0
const params = new URLSearchParams(location.search);

const plugin = params.get('editor') === '0' ? null : createEditorPlugin();

@Component({
  selector: 'app-root',
  imports: [PdfViewerComponent],
  template: '<pdf-suite-viewer [source]="source()" [options]="options" />',
})
class AppComponent {
  readonly source = signal(params.get('source') ?? undefined);

  readonly options: ViewerOptions = {
    mode: (params.get('mode') as ViewerOptions['mode']) ?? 'client',
    serviceUrl: params.get('service') ?? 'http://localhost:8080',
    serviceTransport: (params.get('transport') as ViewerOptions['serviceTransport']) ?? 'multipart',
    plugins: plugin ? [plugin] : [],
  };

  private readonly component = viewChild.required(PdfViewerComponent);

  constructor() {
    afterNextRender(() => {
      Object.assign(window, { pdfViewer: this.component().viewer, pdfPlugin: plugin, setDemoSource: (value: string) => this.source.set(value) });
    });
  }
}

bootstrapApplication(AppComponent).catch((error) => console.error(error));
