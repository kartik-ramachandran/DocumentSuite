import { createFileList, createSettingsPanel, openViewerModal, type SettingsPanelOptions, type DocumentSource, type FileItem, type FileList as FileListInstance, type FileListOptions, type ViewerModal, type ViewerModalOptions } from '@pdf-suite/viewer';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type CSSProperties } from 'react';

export interface PdfViewerModalProps extends Omit<ViewerModalOptions, 'source' | 'onClose'> {
  /** Shows the modal while true. */
  open: boolean;
  source?: DocumentSource;
  /** Called when the user closes the modal. Set `open` to false in response. */
  onClose?: () => void;
}

/** The viewer in a movable, resizable modal. The ref gives access to the modal and its viewer. */
export const PdfViewerModal = forwardRef<ViewerModal | null, PdfViewerModalProps>(function PdfViewerModal({ open, source, fileName, title, onClose, ...options }, ref) {
  const [modal, setModal] = useState<ViewerModal | null>(null);
  useImperativeHandle<ViewerModal | null, ViewerModal | null>(ref, () => modal, [modal]);

  const latest = useRef({ onClose, options, title, fileName });
  latest.current = { onClose, options, title, fileName };

  useEffect(() => {
    if (!open) return;
    const { options: initial, title: initialTitle, fileName: initialName } = latest.current;
    const instance = openViewerModal({ ...initial, title: initialTitle, fileName: initialName, onClose: () => latest.current.onClose?.() });
    setModal(instance);
    return () => {
      void instance.close(true);
      setModal(null);
    };
  }, [open]);

  useEffect(() => {
    if (modal && source !== undefined) void modal.load(source, fileName);
  }, [modal, source, fileName]);

  useEffect(() => {
    if (modal && title) modal.setTitle(title);
  }, [modal, title]);

  return null;
});

export interface FileListProps extends Omit<FileListOptions, 'files'> {
  files: FileItem[];
  className?: string;
  style?: CSSProperties;
}

/** A list of files. Click to open one in the viewer modal, or right-click for its menu. */
export const FileList = forwardRef<FileListInstance | null, FileListProps>(function FileList({ files, className, style, ...options }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const [list, setList] = useState<FileListInstance | null>(null);
  useImperativeHandle<FileListInstance | null, FileListInstance | null>(ref, () => list, [list]);

  const initial = useRef({ files, ...options });

  useEffect(() => {
    const instance = createFileList(host.current!, initial.current);
    setList(instance);
    return () => {
      instance.destroy();
      setList(null);
    };
  }, []);

  useEffect(() => {
    list?.setFiles(files);
  }, [list, files]);

  // Menu items and handlers are often written inline, so these update without rebuilding the viewer.
  useEffect(() => {
    list?.setOptions(options);
  });

  return <div ref={host} className={className} style={style} />;
});

export interface SettingsPanelProps extends SettingsPanelOptions {
  className?: string;
  style?: CSSProperties;
}

/** A ready-made settings screen. Changes apply straight away. */
export function SettingsPanel({ className, style, ...options }: SettingsPanelProps) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    const panel = createSettingsPanel(host.current!, { ...latest.current, onChange: (settings) => latest.current.onChange?.(settings) });
    return () => panel.destroy();
  }, []);

  return <div ref={host} className={className} style={style} />;
}
