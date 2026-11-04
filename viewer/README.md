# PDF Suite Viewer

An open-source PDF and image viewer and editor for React, Vue, Angular and plain JavaScript.

- **Viewing:** zoom, thumbnails, search, selectable text, rotation, printing and download
- **Images:** PNG, JPEG, GIF, WebP, BMP, SVG, AVIF and ICO files open automatically in an image viewer, with zoom, pan, rotate and flip
- **Editing (optional):** highlights, drawing, text, comments, pictures and form filling, all saved into the PDF
- **Document tools (with the API):** organize pages, redact, compress, OCR, watermark, convert and more
- **Two rendering modes:** in the browser, so documents stay on the device, or on your server
- **Other formats:** with the API, it also opens Word, Excel, PowerPoint, HTML, Markdown and text files

## Install

The packages aren't on npm yet. To use them now, build them from this repository, as described in [CONTRIBUTING.md](../CONTRIBUTING.md).

| Package | Purpose |
|---|---|
| `@pdf-suite/viewer` | The viewer, with no framework needed |
| `@pdf-suite/editor` | Optional annotations, form filling and document tools |
| `@pdf-suite/react`, `@pdf-suite/vue`, `@pdf-suite/angular` | Framework components |

## Quick start

The viewer fills its parent element, so **give the parent a height**.

### React

```tsx
import { PdfViewer } from '@pdf-suite/react';

export function App() {
  return (
    <div style={{ height: '100vh' }}>
      <PdfViewer source="/report.pdf" />
    </div>
  );
}
```

### Vue

```vue
<script setup>
import { PdfViewer } from '@pdf-suite/vue';
</script>

<template>
  <div style="height: 100vh">
    <PdfViewer source="/report.pdf" />
  </div>
</template>
```

### Angular

```ts
import { Component } from '@angular/core';
import { PdfViewerComponent } from '@pdf-suite/angular';

@Component({
  selector: 'app-root',
  imports: [PdfViewerComponent],
  template: '<div style="height: 100vh"><pdf-suite-viewer source="/report.pdf" /></div>',
})
export class AppComponent {}
```

### Plain JavaScript

```js
import { createViewer } from '@pdf-suite/viewer';

const viewer = createViewer(document.getElementById('viewer'), { source: '/report.pdf' });
```

## Opening documents

`source` accepts a URL, `Uint8Array`, `ArrayBuffer`, `Blob` or `File`, or base64, which suits documents that arrive inside a JSON response:

```js
viewer.load({ base64: response.data, name: 'report.pdf' });
viewer.load({ url: '/secure/report.pdf', headers: { Authorization: `Bearer ${token}` } });
```

The viewer checks each file's contents, not its name, and switches automatically:

| File | Opens in | Needs `serviceUrl` |
|---|---|---|
| PDF | The PDF viewer | Only in server mode |
| PNG, JPEG, GIF, WebP, BMP, SVG, AVIF, ICO | The image viewer, always in the browser | No |
| Word, Excel, PowerPoint, HTML, Markdown, text | The PDF viewer, after the API converts it | Yes |

`viewer.kind` tells you what's open (`'pdf'` or `'image'`), and the `documentLoaded` event includes it too. TIFF and HEIC can't be displayed in browsers, so the viewer explains that instead of opening them.

## Adding editing tools

```ts
import { createEditorPlugin } from '@pdf-suite/editor';

const editor = createEditorPlugin();
const viewer = createViewer(element, {
  source: '/report.pdf',
  serviceUrl: 'https://pdf.example.com', // only needed for the document tools
  plugins: [editor],
});

// Get the finished PDF, including annotations and form values
const bytes = await viewer.getBytes();
const base64 = await viewer.getBase64();

// Save annotations separately, and restore them later
const saved = editor.annotations.getAnnotations();
editor.annotations.setAnnotations(saved);
```

In exported PDFs, drawings, highlights, text and pictures become page content, comments become real PDF comments, and form values stay in their fields.

## Options

| Option | Default | Description |
|---|---|---|
| `source` | | The document to open |
| `fileName` | from the source | Name used for downloads, and to detect non-PDF files |
| `mode` | `'client'` | `'client'` renders in the browser. `'server'` has the API render pages |
| `serviceUrl` | | Base URL of the PDF API |
| `serviceHeaders` | | Headers sent with every API request, such as a gateway's auth token |
| `serviceTransport` | `'multipart'` | `'json'` sends documents to the API as base64 inside JSON |
| `initialZoom` | `'fit-width'` | A number, `'fit-width'` or `'fit-page'` |
| `theme` | `'auto'` | `'light'`, `'dark'` or `'auto'` |
| `toolbar` | `true` | Shows the toolbar |
| `sidebarOpen` | `false` | Opens the side panel on load |
| `allowOpen` | `true` | Shows the button for opening local files |
| `plugins` | `[]` | Plugins such as the editor |
| `workerSrc` | bundled | Your own copy of the PDF.js worker. See below |
| `onPassword` | built-in prompt | Supplies passwords for protected PDFs |

In Vue and Angular, pass everything except `source`, `fileName` and `theme` through the `options` input. In all the wrappers, options are read once when the viewer is created.

## API

| Member | Description |
|---|---|
| `load(source, fileName?)` | Opens a document or image |
| `kind` | `'pdf'`, `'image'` or `null` |
| `goToPage(number)`, `page`, `pageCount` | Page navigation |
| `setZoom(value)`, `zoomIn()`, `zoomOut()`, `zoom` | Zoom |
| `rotateView()` | Turns the view, without changing the file |
| `search(text)`, `nextMatch()`, `previousMatch()` | Search |
| `getPageText(number)` | A page's text, with positions |
| `getBytes()`, `getBase64()` | The document, including changes |
| `download(fileName?)`, `print()` | Save or print |
| `setTheme(theme)` | Changes the theme |
| `on(event, listener)` | Subscribes to `documentLoaded`, `documentError`, `pageChanged`, `zoomChanged`, `rotationChanged` or `searchChanged`, and returns an unsubscribe function |
| `destroy()` | Removes the viewer and frees its resources |

To reach this API, use a `ref` in React, a template ref's `viewer` in Vue, or the component's `viewer` property in Angular.

## Keyboard

| Key | Action |
|---|---|
| `Ctrl`/`⌘` + `F` | Search |
| `Page Up`, `Page Down`, `Home`, `End` | Move between pages |
| `+`, `-` | Zoom |
| `Ctrl`/`⌘` + `Z`, `Ctrl`/`⌘` + `Y` | Undo and redo annotations |
| `Delete` | Delete the selected annotation |
| `Esc` | Close search, or leave the current tool |

## Content Security Policy

The viewer needs `worker-src blob:` because it starts the PDF.js worker from a blob. If your policy doesn't allow that, host `pdf.worker.min.mjs` from `pdfjs-dist` yourself and set `workerSrc` to its URL. Images need `img-src blob:`.

## Choosing a mode

| | `client` | `server` |
|---|---|---|
| Needs a backend | Only for non-PDF files and document tools | Always |
| Where documents go | Stay on the device for PDFs | Uploaded to your server temporarily |
| Best for | Privacy and low hosting costs | Weak devices and very large files |
| Form fields drawn on the page | Yes | No |

## Known limits

- Annotations, forms and document tools apply to PDFs, so they're hidden while an image is open.
- Rotated pages have no selectable text in server mode.
- Text that isn't in Western scripts is saved as a picture when exported.
- Fonts missing from a PDF fall back to system fonts, so those pages may look slightly different.
- Tested automatically in Chromium only, so check Firefox and Safari for your own use.

## License

[MIT](../LICENSE). See [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) for dependencies.
