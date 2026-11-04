import { degrees, PDFDocument, PDFName, PDFPage, PDFString, pushGraphicsState, popGraphicsState, setFillingRgbColor, setStrokingRgbColor, setLineWidth, setLineCap, setLineJoin, moveTo, lineTo, closePath, fill, stroke, rgb, StandardFonts, LineCapStyle, LineJoinStyle, setGraphicsState, PDFFont } from 'pdf-lib';
import type { Annotation, Point } from './annotation-types';

const HIGHLIGHT_OPACITY = 0.4;
const TEXT_LINE_HEIGHT = 1.2;
const NOTE_SIZE = 18;

/** Maps viewer coordinates (points from the top-left of the page as displayed) to PDF page coordinates. */
export function createPageMapper(page: PDFPage) {
  const box = page.getCropBox();
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;
  return {
    rotation,
    map(x: number, y: number): Point {
      switch (rotation) {
        case 90:
          return { x: box.x + y, y: box.y + x };
        case 180:
          return { x: box.x + box.width - x, y: box.y + y };
        case 270:
          return { x: box.x + box.width - y, y: box.y + box.height - x };
        default:
          return { x: box.x + x, y: box.y + box.height - y };
      }
    },
  };
}

function hexToRgb(hex: string) {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}

function drawShape(page: PDFPage, points: Point[], options: { fill?: string; stroke?: string; width?: number; closed?: boolean; graphicsState?: PDFName }) {
  if (points.length < 2) return;
  const operators = [pushGraphicsState()];
  if (options.graphicsState) operators.push(setGraphicsState(options.graphicsState));
  if (options.fill) operators.push(setFillingRgbColor(...rgbValues(options.fill)));
  if (options.stroke) {
    operators.push(setStrokingRgbColor(...rgbValues(options.stroke)), setLineWidth(options.width ?? 1), setLineCap(LineCapStyle.Round), setLineJoin(LineJoinStyle.Round));
  }
  operators.push(moveTo(points[0].x, points[0].y));
  for (const point of points.slice(1)) operators.push(lineTo(point.x, point.y));
  if (options.closed) operators.push(closePath());
  operators.push(options.fill ? fill() : stroke(), popGraphicsState());
  page.pushOperators(...operators);
}

function rgbValues(hex: string): [number, number, number] {
  const color = hexToRgb(hex);
  return [color.red, color.green, color.blue];
}

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; isPng: boolean } {
  const [header, data] = dataUrl.split(',');
  const binary = atob(data);
  return { bytes: Uint8Array.from(binary, (character) => character.charCodeAt(0)), isPng: header.includes('png') };
}

// Standard PDF fonts only cover Western characters, so anything else is drawn as a picture to keep it readable.
function canEncode(font: PDFFont, text: string): boolean {
  try {
    font.encodeText(text);
    return true;
  } catch {
    return false;
  }
}

function textToPng(text: string, fontSize: number, color: string): { dataUrl: string; width: number; height: number } {
  const quality = 3;
  const lines = text.split('\n');
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d')!;
  context.font = `${fontSize * quality}px sans-serif`;
  const width = Math.max(...lines.map((line) => context.measureText(line).width), 1);
  const height = lines.length * fontSize * TEXT_LINE_HEIGHT * quality;
  canvas.width = Math.ceil(width);
  canvas.height = Math.ceil(height);
  context.font = `${fontSize * quality}px sans-serif`;
  context.fillStyle = color;
  context.textBaseline = 'top';
  lines.forEach((line, index) => context.fillText(line, 0, index * fontSize * TEXT_LINE_HEIGHT * quality));
  return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width / quality, height: canvas.height / quality };
}

/** Writes annotations into a PDF. Drawings become page content, and notes become real PDF comments. */
export async function writeAnnotations(bytes: Uint8Array, annotations: Annotation[]): Promise<Uint8Array> {
  if (annotations.length === 0) return bytes;

  const document = await PDFDocument.load(bytes);
  const pages = document.getPages();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const highlightState = document.context.register(document.context.obj({ Type: 'ExtGState', ca: HIGHLIGHT_OPACITY, CA: HIGHLIGHT_OPACITY, BM: 'Multiply' }));

  for (const annotation of annotations) {
    const page = pages[annotation.page - 1];
    if (!page) continue;
    const { map, rotation } = createPageMapper(page);

    switch (annotation.kind) {
      case 'highlight': {
        const stateName = page.node.newExtGState('PvHighlight', highlightState);
        for (const rect of annotation.rects) {
          drawShape(page, [map(rect.x, rect.y), map(rect.x + rect.width, rect.y), map(rect.x + rect.width, rect.y + rect.height), map(rect.x, rect.y + rect.height)], { fill: annotation.color, closed: true, graphicsState: stateName });
        }
        break;
      }
      case 'ink':
        for (const stroke of annotation.strokes) {
          drawShape(page, stroke.map((point) => map(point.x, point.y)), { stroke: annotation.color, width: annotation.width });
        }
        break;
      case 'rect': {
        const { x, y, width, height } = annotation;
        drawShape(page, [map(x, y), map(x + width, y), map(x + width, y + height), map(x, y + height)], { stroke: annotation.color, width: annotation.strokeWidth, closed: true });
        break;
      }
      case 'text': {
        if (canEncode(font, annotation.text.replace(/\n/g, ''))) {
          annotation.text.split('\n').forEach((line, index) => {
            const origin = map(annotation.x, annotation.y + annotation.fontSize * (0.9 + index * TEXT_LINE_HEIGHT));
            page.drawText(line, { x: origin.x, y: origin.y, size: annotation.fontSize, font, color: hexToRgb(annotation.color), rotate: degrees(rotation) });
          });
        } else {
          const picture = textToPng(annotation.text, annotation.fontSize, annotation.color);
          const image = await document.embedPng(picture.dataUrl);
          const origin = map(annotation.x, annotation.y + picture.height);
          page.drawImage(image, { x: origin.x, y: origin.y, width: picture.width, height: picture.height, rotate: degrees(rotation) });
        }
        break;
      }
      case 'stamp': {
        const { bytes: imageBytes, isPng } = dataUrlToBytes(annotation.dataUrl);
        const image = isPng ? await document.embedPng(imageBytes) : await document.embedJpg(imageBytes);
        const origin = map(annotation.x, annotation.y + annotation.height);
        page.drawImage(image, { x: origin.x, y: origin.y, width: annotation.width, height: annotation.height, rotate: degrees(rotation) });
        break;
      }
      case 'note': {
        const corners = [map(annotation.x, annotation.y), map(annotation.x + NOTE_SIZE, annotation.y + NOTE_SIZE)];
        const reference = document.context.register(document.context.obj({
          Type: 'Annot',
          Subtype: 'Text',
          Rect: [Math.min(corners[0].x, corners[1].x), Math.min(corners[0].y, corners[1].y), Math.max(corners[0].x, corners[1].x), Math.max(corners[0].y, corners[1].y)],
          Contents: PDFString.of(toPdfDocString(annotation.text)),
          C: rgbValues(annotation.color),
          Name: 'Comment',
          F: 4,
        }));
        page.node.addAnnot(reference);
        break;
      }
    }
  }

  return document.save();
}

// PDFString can't hold characters outside Latin-1, so those are removed from comment text instead of corrupting the file.
function toPdfDocString(text: string): string {
  return text.replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '?').replace(/([()\\])/g, '\\$1');
}
