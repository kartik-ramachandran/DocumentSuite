import type { RenderMode, ZoomValue } from './types';

export type BarPosition = 'top' | 'bottom' | 'left' | 'right';

/** Everything about how the viewer behaves. Set app-wide with configureViewer, or per component with the settings option. */
export interface PdfSuiteSettings {
  // File list
  /** What a single click on a file does. */
  clickAction: 'open' | 'menu' | 'none';
  /** What a double click on a file does. */
  doubleClickAction: 'open' | 'menu' | 'none';
  /** Right-clicking a file shows its menu. When off, the browser's own menu appears. */
  contextMenu: boolean;
  /** Shows the ⋮ button on each file. */
  showMenuButton: boolean;
  /** Shows each file's size and date. */
  showFileDetails: boolean;

  // Modal
  /** Which side of the viewer its toolbar is on. */
  toolbarPosition: BarPosition;
  modalResizable: boolean;
  modalMovable: boolean;
  modalMaximizable: boolean;
  /** Opens the next modal at the size the last one was left at. */
  rememberModalSize: boolean;
  closeOnEscape: boolean;
  closeOnBackdropClick: boolean;
  /** Asks before closing when there are unsaved changes. */
  confirmClose: boolean;

  // Downloads
  allowDownload: boolean;
  /** Asks what to call a file before downloading it, starting from its uploaded name. */
  allowRename: boolean;

  // Viewer
  theme: 'auto' | 'light' | 'dark';
  /** client renders in the browser. server has your API render pages, which needs serviceUrl. */
  mode: RenderMode;
  initialZoom: ZoomValue;
  sidebarOpen: boolean;
  /** Shows the button for opening local files. */
  allowOpen: boolean;
  allowPrint: boolean;
  allowSearch: boolean;
  allowRotate: boolean;

  // Editor plugin
  annotations: boolean;
  formFilling: boolean;
  documentTools: boolean;

  // Watermark, with the editor plugin
  /** Shows a watermark on every page, and adds it to prints and downloads. */
  watermark: boolean;
  watermarkText: string;
  /** How visible it is, from 0 to 1. */
  watermarkOpacity: number;
}

export const DEFAULT_SETTINGS: Readonly<PdfSuiteSettings> = Object.freeze({
  clickAction: 'open',
  doubleClickAction: 'none',
  contextMenu: true,
  showMenuButton: true,
  showFileDetails: true,

  toolbarPosition: 'top',
  modalResizable: true,
  modalMovable: true,
  modalMaximizable: true,
  rememberModalSize: true,
  closeOnEscape: true,
  closeOnBackdropClick: false,
  confirmClose: true,

  allowDownload: true,
  allowRename: false,

  theme: 'auto',
  mode: 'client',
  initialZoom: 'fit-width',
  sidebarOpen: false,
  allowOpen: true,
  allowPrint: true,
  allowSearch: true,
  allowRotate: true,

  annotations: true,
  formFilling: true,
  documentTools: true,

  watermark: false,
  watermarkText: 'DRAFT',
  watermarkOpacity: 0.2,
});

let appSettings: Partial<PdfSuiteSettings> = {};
const listeners = new Set<() => void>();

function withoutUndefined<T extends object>(values: T | undefined): Partial<T> {
  return Object.fromEntries(Object.entries(values ?? {}).filter(([, value]) => value !== undefined)) as Partial<T>;
}

/** Changes settings for the whole app. Anything not mentioned keeps its current value. */
export function configureViewer(settings: Partial<PdfSuiteSettings>): void {
  appSettings = { ...appSettings, ...withoutUndefined(settings) };
  listeners.forEach((listener) => listener());
}

/** Puts every setting back to its default. */
export function resetViewerSettings(): void {
  appSettings = {};
  listeners.forEach((listener) => listener());
}

/** The app-wide settings currently in effect. */
export function getViewerSettings(): PdfSuiteSettings {
  return { ...DEFAULT_SETTINGS, ...appSettings };
}

/** Only the settings that differ from the defaults. This is what gets saved, so that a later change to a default still applies. */
export function getChangedSettings(): Partial<PdfSuiteSettings> {
  const settings = getViewerSettings();
  return Object.fromEntries(Object.entries(settings).filter(([key, value]) => value !== DEFAULT_SETTINGS[key as keyof PdfSuiteSettings])) as Partial<PdfSuiteSettings>;
}

/** Calls back whenever the app-wide settings change. Returns a function that stops it. */
export function onViewerSettingsChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The settings for one component: its own values win over app-wide ones, which win over the defaults. */
export function resolveSettings(...overrides: Array<Partial<PdfSuiteSettings> | undefined>): PdfSuiteSettings {
  return Object.assign({ ...DEFAULT_SETTINGS, ...appSettings }, ...overrides.map((values) => withoutUndefined(values)));
}

export interface SettingOption {
  value: string | number;
  label: string;
}

export interface SettingDefinition {
  key: keyof PdfSuiteSettings;
  label: string;
  /** A list of choices. Without this or text, the setting is an on/off switch. */
  options?: SettingOption[];
  /** The setting is typed into a text area, and can have several lines. */
  text?: boolean;
  /** This setting only matters while the named on/off setting is on. */
  enabledBy?: keyof PdfSuiteSettings;
}

export interface SettingGroup {
  title: string;
  settings: SettingDefinition[];
}

const ACTIONS: SettingOption[] = [
  { value: 'open', label: 'Open the file' },
  { value: 'menu', label: 'Show the menu' },
  { value: 'none', label: 'Do nothing' },
];

const POSITIONS: SettingOption[] = [
  { value: 'top', label: 'Top' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
];

/** Describes every setting, for building a settings screen. */
export const SETTINGS_SCHEMA: readonly SettingGroup[] = [
  {
    title: 'File list',
    settings: [
      { key: 'clickAction', label: 'Single click', options: ACTIONS },
      { key: 'doubleClickAction', label: 'Double click', options: ACTIONS },
      { key: 'contextMenu', label: 'Right-click shows the menu' },
      { key: 'showMenuButton', label: 'Show the ⋮ button on each file' },
      { key: 'showFileDetails', label: 'Show file size and date' },
    ],
  },
  {
    title: 'Viewer window',
    settings: [
      { key: 'toolbarPosition', label: 'Toolbar position', options: POSITIONS },
      { key: 'modalResizable', label: 'Can be resized' },
      { key: 'modalMovable', label: 'Can be moved' },
      { key: 'modalMaximizable', label: 'Can be maximized' },
      { key: 'rememberModalSize', label: 'Remember the last size' },
      { key: 'closeOnEscape', label: 'Esc closes it' },
      { key: 'closeOnBackdropClick', label: 'Clicking outside closes it' },
      { key: 'confirmClose', label: 'Ask before closing with unsaved changes' },
    ],
  },
  {
    title: 'Downloads',
    settings: [
      { key: 'allowDownload', label: 'Allow downloads' },
      { key: 'allowRename', label: 'Ask for a file name when downloading', enabledBy: 'allowDownload' },
    ],
  },
  {
    title: 'Viewer',
    settings: [
      { key: 'theme', label: 'Theme', options: [{ value: 'auto', label: 'Match the system' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }] },
      { key: 'mode', label: 'Render pages', options: [{ value: 'client', label: 'In the browser' }, { value: 'server', label: 'On the server' }] },
      {
        key: 'initialZoom',
        label: 'Starting zoom',
        options: [{ value: 'fit-width', label: 'Fit width' }, { value: 'fit-page', label: 'Whole page' }, { value: 1, label: '100%' }, { value: 1.5, label: '150%' }],
      },
      { key: 'sidebarOpen', label: 'Open the side panel on load' },
      { key: 'allowOpen', label: 'Allow opening local files' },
      { key: 'allowPrint', label: 'Allow printing' },
      { key: 'allowSearch', label: 'Allow search' },
      { key: 'allowRotate', label: 'Allow rotating' },
    ],
  },
  {
    title: 'Editing',
    settings: [
      { key: 'annotations', label: 'Annotations' },
      { key: 'formFilling', label: 'Form filling' },
      { key: 'documentTools', label: 'Document tools' },
    ],
  },
  {
    title: 'Watermark',
    settings: [
      { key: 'watermark', label: 'Add a watermark to every page' },
      { key: 'watermarkText', label: 'Text', text: true, enabledBy: 'watermark' },
      { key: 'watermarkOpacity', label: 'Strength', options: [{ value: 0.1, label: 'Light' }, { value: 0.2, label: 'Medium' }, { value: 0.35, label: 'Strong' }], enabledBy: 'watermark' },
    ],
  },
];

/** Keeps only known settings with sensible values, for settings that come from storage or a server. */
export function sanitizeSettings(values: unknown): Partial<PdfSuiteSettings> {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return {};
  const result: Record<string, unknown> = {};
  for (const setting of SETTINGS_SCHEMA.flatMap((group) => group.settings)) {
    if (!Object.hasOwn(values, setting.key)) continue;
    const value = (values as Record<string, unknown>)[setting.key];
    const isValid = setting.options
      ? setting.options.some((option) => option.value === value) || (setting.key === 'initialZoom' && typeof value === 'number' && value > 0)
      : setting.text
        ? typeof value === 'string'
        : typeof value === 'boolean';
    if (isValid) result[setting.key] = value;
  }
  return result as Partial<PdfSuiteSettings>;
}
