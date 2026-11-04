import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { degrees, PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { FIXTURES } from './helpers';

const TEXT = 'The quarterly inspection covered every listed site and found the records complete, with only minor corrections.';

async function createReport(pages: number, rotation = 0): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.setTitle('Annual Operations Report');
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  for (let number = 1; number <= pages; number++) {
    const page = document.addPage([612, 792]);
    page.drawText(`Section ${number} Heading`, { x: 72, y: 700, size: 22, font: bold });
    page.drawText(`Unique marker alpha${number}`, { x: 72, y: 660, size: 12, font });
    for (let line = 0; line < 8; line++) page.drawText(TEXT.slice(0, 80), { x: 72, y: 630 - line * 18, size: 11, font });
    page.drawRectangle({ x: 72, y: 300, width: 160, height: 90, color: rgb(0.2, 0.4, 0.8) });
    if (rotation) page.setRotation(degrees(rotation));
  }
  return document.save();
}

async function createForm(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText('Application Form', { x: 72, y: 720, size: 18, font });
  const form = document.getForm();
  const name = form.createTextField('full_name');
  name.addToPage(page, { x: 72, y: 660, width: 300, height: 26 });
  const agree = form.createCheckBox('agree');
  agree.addToPage(page, { x: 72, y: 620, width: 18, height: 18 });
  const country = form.createDropdown('country');
  country.addOptions(['Australia', 'India', 'New Zealand']);
  country.addToPage(page, { x: 72, y: 570, width: 200, height: 26 });
  return document.save();
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const byte of data) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// A tiny real Word file: a zip holding the three parts Word and LibreOffice need.
function createDocx(): Buffer {
  const files: Array<[string, string]> = [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
    ['word/document.xml', '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Word content opened in the viewer</w:t></w:r></w:p></w:body></w:document>'],
  ];
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of files) {
    const data = Buffer.from(text);
    const nameBytes = Buffer.from(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

function createPng(): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const crcValue = Buffer.alloc(4);
    crcValue.writeUInt32BE(crc32(body));
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    return Buffer.concat([length, body, crcValue]);
  };
  const width = 320;
  const height = 200;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) {
      raw[row + 1 + x * 3] = Math.floor((x / width) * 255);
      raw[row + 2 + x * 3] = Math.floor((y / height) * 255);
      raw[row + 3 + x * 3] = 140;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function createBmp(): Buffer {
  const width = 4;
  const height = 4;
  const pixels = Buffer.alloc(width * height * 4, 0x80);
  const header = Buffer.alloc(54);
  header.write('BM');
  header.writeUInt32LE(54 + pixels.length, 2);
  header.writeUInt32LE(54, 10);
  header.writeUInt32LE(40, 14);
  header.writeInt32LE(width, 18);
  header.writeInt32LE(height, 22);
  header.writeUInt16LE(1, 26);
  header.writeUInt16LE(32, 28);
  return Buffer.concat([header, pixels]);
}

// Tiny valid files, generated once with standard tools and embedded here.
const GIF = 'R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=';
const WEBP = 'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';
const JPEG = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

export default async function globalSetup() {
  mkdirSync(FIXTURES, { recursive: true });
  writeFileSync(`${FIXTURES}/report.pdf`, await createReport(5));
  writeFileSync(`${FIXTURES}/rotated.pdf`, await createReport(1, 90));
  writeFileSync(`${FIXTURES}/form.pdf`, await createForm());
  writeFileSync(`${FIXTURES}/note.docx`, createDocx());
  writeFileSync(`${FIXTURES}/note.txt`, 'Plain text content opened in the viewer');
  writeFileSync(`${FIXTURES}/photo.png`, createPng());
  writeFileSync(`${FIXTURES}/photo.jpg`, Buffer.from(JPEG, 'base64'));
  writeFileSync(`${FIXTURES}/photo.gif`, Buffer.from(GIF, 'base64'));
  writeFileSync(`${FIXTURES}/photo.webp`, Buffer.from(WEBP, 'base64'));
  writeFileSync(`${FIXTURES}/photo.bmp`, createBmp());
  writeFileSync(`${FIXTURES}/drawing.svg`, '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#2f5fd0"/></svg>');
}
