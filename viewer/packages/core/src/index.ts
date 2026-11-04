import { PdfViewer } from './viewer';
import type { ViewerOptions } from './types';

export { PdfViewer, findMatches } from './viewer';
export { base64ToBytes, bytesToBase64, detectImage } from './sources';
export { ViewerModal, openViewerModal } from './modal';
export type { ViewerModalOptions } from './modal';
export { FileList, createFileList } from './file-list';
export type { FileItem, FileListOptions, FileMenuItem } from './file-list';
export { openContextMenu } from './context-menu';
export { askFileName } from './rename-dialog';
export { configureViewer, DEFAULT_SETTINGS, getChangedSettings, getViewerSettings, onViewerSettingsChange, resetViewerSettings, sanitizeSettings, SETTINGS_SCHEMA } from './settings';
export { loadViewerSettings, readViewerSettings, saveViewerSettings } from './settings-store';
export type { SettingsStoreOptions } from './settings-store';
export type { BarPosition, DocumentSuiteSettings, SettingDefinition, SettingGroup, SettingOption } from './settings';
export { createSettingsPanel, SettingsPanel } from './settings-panel';
export type { SettingsPanelOptions } from './settings-panel';
export type { ContextMenuHandle, ContextMenuItem } from './context-menu';
export type * from './types';

/** Starts a viewer inside an element. The element needs a height. */
export function createViewer(element: HTMLElement, options: ViewerOptions = {}): PdfViewer {
  return new PdfViewer(element, options);
}
