export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point {
  width: number;
  height: number;
}

interface AnnotationBase {
  id: string;
  page: number;
  color: string;
}

export type Annotation =
  | (AnnotationBase & { kind: 'highlight'; rects: Rect[] })
  | (AnnotationBase & { kind: 'ink'; strokes: Point[][]; width: number })
  | (AnnotationBase & { kind: 'rect'; x: number; y: number; width: number; height: number; strokeWidth: number })
  | (AnnotationBase & { kind: 'text'; x: number; y: number; text: string; fontSize: number })
  | (AnnotationBase & { kind: 'note'; x: number; y: number; text: string })
  | (AnnotationBase & { kind: 'stamp'; x: number; y: number; width: number; height: number; dataUrl: string });

export type AnnotationTool = 'select' | 'highlight' | 'ink' | 'rect' | 'text' | 'note' | 'stamp' | null;
