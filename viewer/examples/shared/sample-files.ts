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

/** Generated sample documents, standing in for the files an app already has. */
export async function createSampleFiles(): Promise<FileItem[]> {
  const [report, form, photo] = await Promise.all([createReport(), createForm(), createPhoto()]);
  const notes = new TextEncoder().encode('Site visit notes.\nEverything was in order.\n');
  const modified = new Date(2026, 9, 28);
  return [
    { id: 'report', name: 'Annual report.pdf', source: report, size: report.length, modified },
    { id: 'form', name: 'Application form.pdf', source: form, size: form.length, modified },
    { id: 'photo', name: 'Site photo.png', source: photo, size: photo.size, modified },
    { id: 'notes', name: 'Site notes.txt', source: notes, size: notes.length, modified },
  ];
}

export function filesFromInput(input: FileList | null): FileItem[] {
  return Array.from(input ?? []).map((file) => ({ id: `${file.name}-${file.size}`, name: file.name, source: file, size: file.size, modified: new Date(file.lastModified) }));
}
