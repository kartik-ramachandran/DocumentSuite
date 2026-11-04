# PDF Suite Viewer

An open-source PDF and image viewer and editor for React, Vue, Angular and plain JavaScript.

- **In your app:** a file list with a right-click menu, and a window people can move and resize
- **Viewing:** zoom, thumbnails, search, selectable text, rotation, printing and download
- **Images:** PNG, JPEG, GIF, WebP, BMP, SVG, AVIF and ICO files open automatically, with the same toolbar, annotations and document tools as PDFs, plus pan and flip
- **Editing (optional):** highlights, drawing, text, comments, pictures and form filling, all saved into the PDF
- **Document tools (with the API):** organize pages, redact, compress, OCR, watermark, convert and more
- **Two rendering modes:** in the browser, so documents stay on the device, or on your server
- **Other formats:** with the API, it also opens Word, Excel, PowerPoint, HTML, Markdown and text files
- **Settings for everything:** clicks, toolbar position, watermark and more, set in code or on a ready-made screen, and saved in the browser or on your server

## Screenshots

| | |
|---|---|
| ![A list of files with the right-click menu open on one of them](../docs/screenshots/file-list.png) | ![A report in the viewer window with annotations on it](../docs/screenshots/viewer-modal.png) |
| **File list** with a right-click menu | **Viewer window** with annotations |
| ![The side panel showing the document tools, with the Watermark tool open](../docs/screenshots/document-tools.png) | ![A photo in the viewer, with image rotate and flip buttons in the toolbar](../docs/screenshots/image-viewer.png) |
| **Document tools**, with the API | **Images** open automatically |
| ![A report with CONFIDENTIAL written diagonally across the page](../docs/screenshots/watermark.png) | ![The viewer with its toolbar down the left side](../docs/screenshots/toolbar-left.png) |
| **Watermark** setting | **Toolbar** on the left, set in settings |

All of these use generated sample files. To retake them, follow the steps at the top of [`scripts/take-screenshots.mjs`](scripts/take-screenshots.mjs).

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

## Viewing files in a modal

`FileList` shows your files. Clicking one opens it in a modal that can be resized from any edge or corner, moved by its title bar and maximized. Right-clicking shows a menu with **Open**, **Download** and your own actions.

```tsx
import { FileList } from '@pdf-suite/react';
import { createEditorPlugin } from '@pdf-suite/editor';

const files = [
  { id: '1', name: 'Report.pdf', source: '/files/1', size: 182000, modified: '2026-10-28' },
  // source can also be a function, so a file is only fetched when it's opened
  { id: '2', name: 'Photo.png', source: () => fetchFileUrl('2') },
];

<FileList
  files={files}
  viewer={{ serviceUrl: 'https://pdf.example.com', plugins: [createEditorPlugin()] }}
  menuItems={[{ id: 'delete', label: 'Delete', danger: true, separator: true, onSelect: (file) => remove(file.id) }]}
/>
```

The same component is `FileList` in Vue (`:files` and `:options`), and `<pdf-suite-file-list [files] [options]>` in Angular. What a click does, and everything else about how it behaves, is in the [settings](#settings).

### Using your own file list

If your app already has a list, call the functions from its click and right-click handlers:

```ts
import { openContextMenu, openViewerModal } from '@pdf-suite/viewer';

function openFile(file) {
  const modal = openViewerModal({ title: file.name, serviceUrl: 'https://pdf.example.com' });
  modal.load(file.url, file.name);
}

row.addEventListener('click', () => openFile(file));
row.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  openContextMenu(event.clientX, event.clientY, [
    { id: 'open', label: 'Open', onSelect: () => openFile(file) },
    { id: 'delete', label: 'Delete', danger: true, separator: true, onSelect: () => remove(file) },
  ]);
});
```

To control a modal from a component instead, use `PdfViewerModal` in React and Vue, or `pdf-suite-viewer-modal` in Angular, with an `open` input and a close event.

### Modal options

| Option | Default | Description |
|---|---|---|
| `title` | the file name | Title bar text |
| `width`, `height` | most of the window, or the last size used | Initial size in pixels |
| `minWidth`, `minHeight` | `360`, `280` | Smallest allowed size |
| `onClose` | | Called after it closes |

Viewer options work here too, and the window's behaviour is in the [settings](#settings). Closing asks first if there are changes that haven't been downloaded. If your app saves documents itself, call `viewer.markSaved()` after sending `viewer.getBytes()` to your server. On small screens, the modal fills the screen.

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

## Download names

Downloads keep the uploaded name, including capitals and any extra dots:

| What's open | What Download saves |
|---|---|
| A PDF or image | `Q3 Report.pdf`, under its uploaded name |
| An untouched Word, Excel, PowerPoint, HTML, Markdown or text file | The original file, such as `Q3 Report.docx` |
| A converted document with changes | A PDF with the same name, such as `Q3 Report.pdf` |
| An annotated image | A new PNG with the same name, such as `Photo.png` |

Turn on the `allowRename` [setting](#settings) to ask for a name first, starting from the uploaded one. The extension is kept, because it has to match the file's contents. `viewer.download('name.pdf')` skips the question, and the `downloaded` event tells your app which name was used.

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

After you add a comment or text, the tool turns itself off. Click a comment to read or edit it, or hover over it to read it. With the Select tool, double-click a comment or text to edit it, or drag anything to move it. Saving a comment or text with nothing in it deletes it.

In exported PDFs, drawings, highlights, text and pictures become page content, comments become real PDF comments, and form values stay in their fields. The same tools work on images, which export as a PNG at full resolution.

## Settings

All behaviour is controlled by one set of settings. Set them for your whole app, once, when it starts:

```ts
import { configureViewer } from '@pdf-suite/viewer'; // also exported by the React, Vue and Angular packages

configureViewer({
  clickAction: 'menu',       // a single click shows the menu instead of opening the file
  doubleClickAction: 'open',
  allowRename: true,
  closeOnBackdropClick: true,
});
```

Or for one component, which takes priority over the app-wide values:

```tsx
<FileList files={files} settings={{ clickAction: 'none', doubleClickAction: 'open' }} />
<PdfViewer source={file} settings={{ allowPrint: false }} />
```

File lists update straight away. Viewers read their settings when they're created, so changes apply to the next one opened.

| Setting | Default | Description |
|---|---|---|
| **File list** | | |
| `clickAction` | `'open'` | Single click: `'open'`, `'menu'` or `'none'` |
| `doubleClickAction` | `'none'` | Double click: `'open'`, `'menu'` or `'none'`. If both are set, a double click also runs the single click action first |
| `contextMenu` | `true` | Right-click shows the file's menu. When off, the browser's menu appears |
| `showMenuButton` | `true` | Shows the ⋮ button on each file |
| `showFileDetails` | `true` | Shows each file's size and date |
| **Viewer window** | | |
| `toolbarPosition` | `'top'` | Which side the toolbar is on: `'top'`, `'bottom'`, `'left'` or `'right'` |
| `modalResizable` | `true` | Can be resized from its edges and corners |
| `modalMovable` | `true` | Can be moved by its title bar |
| `modalMaximizable` | `true` | Can be maximized |
| `rememberModalSize` | `true` | Opens at the size the last one was left at |
| `closeOnEscape` | `true` | Esc closes it |
| `closeOnBackdropClick` | `false` | Clicking outside closes it |
| `confirmClose` | `true` | Asks before closing with unsaved changes |
| **Downloads** | | |
| `allowDownload` | `true` | Shows download buttons and menu items |
| `allowRename` | `false` | Asks what to call a file before downloading it |
| **Viewer** | | |
| `theme` | `'auto'` | `'auto'`, `'light'` or `'dark'` |
| `mode` | `'client'` | `'client'` renders in the browser. `'server'` has the API render pages |
| `initialZoom` | `'fit-width'` | A number, `'fit-width'` or `'fit-page'` |
| `sidebarOpen` | `false` | Opens the side panel on load |
| `allowOpen` | `true` | Shows the button for opening local files |
| `allowPrint` | `true` | Shows the print button |
| `allowSearch` | `true` | Shows search and enables its shortcut |
| `allowRotate` | `true` | Shows the rotate buttons |
| **Editing, with the editor plugin** | | |
| `annotations` | `true` | Annotation tools |
| `formFilling` | `true` | Fillable form fields |
| `documentTools` | `true` | The document tools panel |
| **Watermark, with the editor plugin** | | |
| `watermark` | `false` | Shows a watermark on every page, and adds it to prints and downloads |
| `watermarkText` | `'DRAFT'` | The text, which can have several lines. It also fills in the Watermark document tool |
| `watermarkOpacity` | `0.2` | How visible it is, from 0 to 1 |

**These settings shape the interface, and aren't security controls.** Turning off downloads or printing only removes the buttons, and the watermark is added in the browser. Anyone who can view a document in a browser can still save it without them, so protect sensitive documents on your server. To guarantee a watermark, add it with the API's `/api/pdf/watermark` route before the document reaches the browser.

With a watermark on, a converted file such as a Word document downloads as a PDF, because that's what can carry the watermark. Images download as PNG. Document tools that change the open document work on it without the watermark, so that it can't stack up.

The toolbar's position only changes through this setting. It can't be dragged to another side.

### A settings screen

`SettingsPanel` is a ready-made screen for all of these, which you can put on your app's settings page. Choices apply straight away.

![The settings screen, with groups for the file list, viewer window, downloads, viewer, editing and watermark](../docs/screenshots/settings-panel.png)

```tsx
<SettingsPanel
  storageKey="my-app-viewer-settings"          // remembers choices in this browser
  exclude={['mode', 'allowDownload']}          // hides settings your users shouldn't change
  onChange={(settings) => saveToServer(settings)}
/>
```

In Vue, pass these through `:options`, and in Angular use `<pdf-suite-settings-panel [options]="...">`. Saved choices load when the panel appears, so if it's on a separate page, also call `configureViewer(JSON.parse(localStorage.getItem('my-app-viewer-settings') ?? '{}'))` when your app starts. To build your own screen, `SETTINGS_SCHEMA` describes every setting.

### Saving settings on the server

The PDF API can keep settings for you, so that they follow people between browsers. Give the panel the API's address, and a `scope` that says whose settings they are, such as an app, team or user:

```tsx
<SettingsPanel serviceUrl="https://pdf.example.com" scope="team-a" serviceHeaders={{ Authorization: `Bearer ${token}` }} />
```

Choices are saved shortly after they change, and the panel says if saving fails. To apply them before anything opens, also load them when your app starts:

```ts
import { loadViewerSettings } from '@pdf-suite/viewer';

await loadViewerSettings({ serviceUrl: 'https://pdf.example.com', scope: 'team-a' });
```

`saveViewerSettings(options)` saves from your own code. If your app already stores settings for its users, you don't need the API for this: leave out `serviceUrl`, save them from `onChange`, and call `configureViewer(saved)` when your app starts.

Deployed instances refuse changes until you set a write key, so read the [API's notes on this](../README.md#viewer-settings) first. A key sent from a browser can be read by its users, so for anything beyond a trusted internal app, have your backend or gateway add it.

To try it in the demos, add `?save=server` to the address.

## Options

These are set in code, on the viewer or on `openViewerModal`. Anything else is in the settings above.

| Option | Default | Description |
|---|---|---|
| `source` | | The document to open |
| `fileName` | from the source | Name used for downloads, and to detect non-PDF files |
| `settings` | | Settings for this viewer, on top of the app-wide ones |
| `serviceUrl` | | Base URL of the PDF API |
| `serviceHeaders` | | Headers sent with every API request, such as a gateway's auth token |
| `serviceTransport` | `'multipart'` | `'json'` sends documents to the API as base64 inside JSON |
| `toolbar` | `true` | Shows the toolbar |
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
| `download(fileName?)`, `print()` | Save or print. `download` resolves to `false` if the user cancels naming the file |
| `hasUnsavedChanges`, `markSaved()` | Tracks whether the document has changed since it was opened or saved |
| `setTheme(theme)` | Changes the theme |
| `on(event, listener)` | Subscribes to `documentLoaded`, `documentError`, `downloaded`, `pageChanged`, `zoomChanged`, `rotationChanged` or `searchChanged`, and returns an unsubscribe function |
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

- Document tools convert an image to a PDF first and open the result in the PDF viewer. **Undo last tool** brings the image back.
- An annotated image downloads as a new PNG, with comments drawn beside their icons, because images can't hold real comments. Rotating and flipping only change the view, as they do for PDFs.
- Rotated pages have no selectable text in server mode.
- Text that isn't in Western scripts is saved as a picture when exported.
- Fonts missing from a PDF fall back to system fonts, so those pages may look slightly different.
- Tested automatically in Chromium only, so check Firefox and Safari for your own use.

## License

[MIT](../LICENSE). See [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) for dependencies.
