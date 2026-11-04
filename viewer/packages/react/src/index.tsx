import { createViewer, type DocumentSource, type PdfViewer as ViewerInstance, type ViewerEvents, type ViewerOptions } from '@document-suite/viewer';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type CSSProperties } from 'react';

export interface PdfViewerProps extends Omit<ViewerOptions, 'source'> {
  /** The document to open. Changing it opens the new document. */
  source?: DocumentSource;
  className?: string;
  style?: CSSProperties;
  onDocumentLoaded?: (event: ViewerEvents['documentLoaded']) => void;
  onDocumentError?: (event: ViewerEvents['documentError']) => void;
  onPageChanged?: (event: ViewerEvents['pageChanged']) => void;
  onZoomChanged?: (event: ViewerEvents['zoomChanged']) => void;
}

/** The PDF viewer as a React component. The ref gives access to the viewer's full API. Give it a height. */
export const PdfViewer = forwardRef<ViewerInstance | null, PdfViewerProps>(function PdfViewer(
  { source, fileName, theme, className, style, onDocumentLoaded, onDocumentError, onPageChanged, onZoomChanged, ...options },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const [viewer, setViewer] = useState<ViewerInstance | null>(null);
  useImperativeHandle<ViewerInstance | null, ViewerInstance | null>(ref, () => viewer, [viewer]);

  // Handlers change on every render, so the viewer calls the latest ones through a ref.
  const handlers = useRef({ onDocumentLoaded, onDocumentError, onPageChanged, onZoomChanged });
  handlers.current = { onDocumentLoaded, onDocumentError, onPageChanged, onZoomChanged };

  // The options are read once, when the viewer is created. Use a new key to apply different ones.
  const initialOptions = useRef({ ...options, theme });

  useEffect(() => {
    const instance = createViewer(host.current!, initialOptions.current);
    const unsubscribers = [
      instance.on('documentLoaded', (event) => handlers.current.onDocumentLoaded?.(event)),
      instance.on('documentError', (event) => handlers.current.onDocumentError?.(event)),
      instance.on('pageChanged', (event) => handlers.current.onPageChanged?.(event)),
      instance.on('zoomChanged', (event) => handlers.current.onZoomChanged?.(event)),
    ];
    setViewer(instance);
    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      instance.destroy();
      setViewer(null);
    };
  }, []);

  useEffect(() => {
    if (viewer && source !== undefined) void viewer.load(source, fileName);
  }, [viewer, source, fileName]);

  useEffect(() => {
    if (viewer && theme) viewer.setTheme(theme);
  }, [viewer, theme]);

  return <div ref={host} className={className} style={{ height: '100%', ...style }} />;
});

export { FileList, PdfViewerModal, SettingsPanel } from './modal';
export type { FileListProps, PdfViewerModalProps, SettingsPanelProps } from './modal';
export { configureViewer, DEFAULT_SETTINGS, getViewerSettings, loadViewerSettings, resetViewerSettings, saveViewerSettings, SETTINGS_SCHEMA } from '@document-suite/viewer';
export type { DocumentSuiteSettings, SettingsPanelOptions, SettingsStoreOptions } from '@document-suite/viewer';
export { openContextMenu, openViewerModal } from '@document-suite/viewer';
export type { ContextMenuItem, FileItem, FileListOptions, FileMenuItem, ViewerModal, ViewerModalOptions } from '@document-suite/viewer';
export type { DocumentSource, PdfViewer as PdfViewerInstance, ViewerEvents, ViewerOptions, ZoomValue } from '@document-suite/viewer';
