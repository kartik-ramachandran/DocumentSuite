# @document-suite/angular

An open-source PDF and image viewer and editor for Angular, with a file list, a window people can move and resize, annotations and form filling.

![A report in the viewer window with annotations on it](https://raw.githubusercontent.com/kartik-ramachandran/DocumentSuite/main/docs/screenshots/viewer-modal.png)

## Install

```bash
npm install @document-suite/viewer @document-suite/editor @document-suite/angular
```

## Use it in Angular

```ts
import { Component } from '@angular/core';
import { createEditorPlugin } from '@document-suite/editor';
import { FileListComponent, type FileItem } from '@document-suite/angular';

@Component({
  selector: 'app-root',
  imports: [FileListComponent],
  template: '<document-suite-file-list [files]="files" [options]="options" />',
})
export class AppComponent {
  readonly files: FileItem[] = [
    { id: 'report', name: 'report.pdf', source: '/report.pdf' },
    { id: 'photo', name: 'photo.png', source: '/photo.png' },
  ];

  readonly options = { viewer: { plugins: [createEditorPlugin()] } };
}
```

PDFs and images work straight away with no server. There's no stylesheet to import. Word, Excel and PowerPoint files and the document tools need the [Document Suite API](https://github.com/kartik-ramachandran/DocumentSuite#quick-start), which you run yourself.

## Learn more

- **[Try it live](https://kartik-ramachandran.github.io/DocumentSuite/#try)**, with nothing to install
- **[Integration guide](https://github.com/kartik-ramachandran/DocumentSuite/blob/main/viewer/README.md#add-it-to-your-app)** for React, Vue, Angular and plain JavaScript
- **[All settings](https://github.com/kartik-ramachandran/DocumentSuite/blob/main/viewer/README.md#settings)**

Document Suite is free and open for anyone to use, under the MIT License. If you'd like a hand setting it up, email kartikrama272@gmail.com.
