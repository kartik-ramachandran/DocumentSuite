import type { FileItem } from '@pdf-suite/viewer';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

const PARAGRAPH = 'The quarterly inspection covered every listed site and found the records complete.';

async function createReport(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  for (let number = 1; number <= 4; number++) {
    const page = document.addPage([612, 792]);
    page.drawText(`Annual Report: Section ${number}`, { x: 72, y: 700, size: 22, font: bold });
    for (let line = 0; line < 10; line++) page.drawText(PARAGRAPH, { x: 72, y: 660 - line * 18, size: 11, font });
    page.drawRectangle({ x: 72, y: 340, width: 180, height: 100, color: rgb(0.2, 0.4, 0.8) });
  }
  return document.save();
}

async function createForm(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText('Application Form', { x: 72, y: 720, size: 18, font });
  const form = document.getForm();
  form.createTextField('full_name').addToPage(page, { x: 72, y: 660, width: 300, height: 26 });
  form.createCheckBox('agree').addToPage(page, { x: 72, y: 620, width: 18, height: 18 });
  return document.save();
}

async function createPhoto(): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 600;
  const context = canvas.getContext('2d')!;
  const gradient = context.createLinearGradient(0, 0, 960, 600);
  gradient.addColorStop(0, '#1b3a8a');
  gradient.addColorStop(1, '#f2a65a');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 960, 600);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob!), 'image/png'));
}

// A small Word document. Word files open through the PDF service, which converts them for viewing.
const SAMPLE_DOCX = 'UEsDBBQAAAAAAAAAAADMVIwQnAEAAJwBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbDw/eG1sIHZlcnNpb249IjEuMCIgZW5jb2Rpbmc9IlVURi04Ij8+PFR5cGVzIHhtbG5zPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvcGFja2FnZS8yMDA2L2NvbnRlbnQtdHlwZXMiPjxEZWZhdWx0IEV4dGVuc2lvbj0icmVscyIgQ29udGVudFR5cGU9ImFwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1wYWNrYWdlLnJlbGF0aW9uc2hpcHMreG1sIi8+PERlZmF1bHQgRXh0ZW5zaW9uPSJ4bWwiIENvbnRlbnRUeXBlPSJhcHBsaWNhdGlvbi94bWwiLz48T3ZlcnJpZGUgUGFydE5hbWU9Ii93b3JkL2RvY3VtZW50LnhtbCIgQ29udGVudFR5cGU9ImFwcGxpY2F0aW9uL3ZuZC5vcGVueG1sZm9ybWF0cy1vZmZpY2Vkb2N1bWVudC53b3JkcHJvY2Vzc2luZ21sLmRvY3VtZW50Lm1haW4reG1sIi8+PC9UeXBlcz5QSwMEFAAAAAAAAAAAADZX3twYAQAAGAEAAAsAAABfcmVscy8ucmVsczw/eG1sIHZlcnNpb249IjEuMCIgZW5jb2Rpbmc9IlVURi04Ij8+PFJlbGF0aW9uc2hpcHMgeG1sbnM9Imh0dHA6Ly9zY2hlbWFzLm9wZW54bWxmb3JtYXRzLm9yZy9wYWNrYWdlLzIwMDYvcmVsYXRpb25zaGlwcyI+PFJlbGF0aW9uc2hpcCBJZD0icklkMSIgVHlwZT0iaHR0cDovL3NjaGVtYXMub3BlbnhtbGZvcm1hdHMub3JnL29mZmljZURvY3VtZW50LzIwMDYvcmVsYXRpb25zaGlwcy9vZmZpY2VEb2N1bWVudCIgVGFyZ2V0PSJ3b3JkL2RvY3VtZW50LnhtbCIvPjwvUmVsYXRpb25zaGlwcz5QSwMEFAAAAAAAAAAAAK/0BNLZAAAA2QAAABEAAAB3b3JkL2RvY3VtZW50LnhtbDw/eG1sIHZlcnNpb249IjEuMCIgZW5jb2Rpbmc9IlVURi04Ij8+PHc6ZG9jdW1lbnQgeG1sbnM6dz0iaHR0cDovL3NjaGVtYXMub3BlbnhtbGZvcm1hdHMub3JnL3dvcmRwcm9jZXNzaW5nbWwvMjAwNi9tYWluIj48dzpib2R5Pjx3OnA+PHc6cj48dzp0PldvcmQgY29udGVudCBvcGVuZWQgaW4gdGhlIHZpZXdlcjwvdzp0PjwvdzpyPjwvdzpwPjwvdzpib2R5Pjwvdzpkb2N1bWVudD5QSwECFAAUAAAAAAAAAAAAzFSMEJwBAACcAQAAEwAAAAAAAAAAAAAAAAAAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUABQAAAAAAAAAAAA2V97cGAEAABgBAAALAAAAAAAAAAAAAAAAAM0BAABfcmVscy8ucmVsc1BLAQIUABQAAAAAAAAAAACv9ATS2QAAANkAAAARAAAAAAAAAAAAAAAAAA4DAAB3b3JkL2RvY3VtZW50LnhtbFBLBQYAAAAAAwADALkAAAAWBAAAAAA=';

/** Generated sample documents, standing in for the files an app already has. */
export async function createSampleFiles(): Promise<FileItem[]> {
  const [report, form, photo] = await Promise.all([createReport(), createForm(), createPhoto()]);
  const word = Uint8Array.from(atob(SAMPLE_DOCX), (character) => character.charCodeAt(0));
  const notes = new TextEncoder().encode('Site visit notes.\nEverything was in order.\n');
  const modified = new Date(2026, 9, 28);
  return [
    { id: 'report', name: 'Annual report.pdf', source: report, size: report.length, modified },
    { id: 'form', name: 'Application form.pdf', source: form, size: form.length, modified },
    { id: 'word', name: 'Meeting notes.docx', source: word, size: word.length, modified },
    { id: 'photo', name: 'Site photo.png', source: photo, size: photo.size, modified },
    { id: 'notes', name: 'Site notes.txt', source: notes, size: notes.length, modified },
  ];
}

export function filesFromInput(input: FileList | null): FileItem[] {
  return Array.from(input ?? []).map((file) => ({ id: `${file.name}-${file.size}`, name: file.name, source: file, size: file.size, modified: new Date(file.lastModified) }));
}
