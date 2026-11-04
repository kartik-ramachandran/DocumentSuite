import { ServiceClient } from './service';
import { configureViewer, getChangedSettings, getViewerSettings, sanitizeSettings, type PdfSuiteSettings } from './settings';

export interface SettingsStoreOptions {
  /** Base URL of the PDF API. */
  serviceUrl: string;
  /** Headers sent with each request, such as a gateway's auth token or the API's write key. */
  serviceHeaders?: Record<string, string>;
  /** Whose settings these are, such as an app, team or user. Letters, numbers, hyphens and underscores. Defaults to "default". */
  scope?: string;
}

function settingsPath(options: SettingsStoreOptions): string {
  return `/api/settings/${encodeURIComponent(options.scope ?? 'default')}`;
}

/** Reads the settings saved on the server, without applying them. */
export async function readViewerSettings(options: SettingsStoreOptions): Promise<Partial<PdfSuiteSettings>> {
  const client = new ServiceClient(options.serviceUrl, options.serviceHeaders);
  const response = await client.request(settingsPath(options));
  return sanitizeSettings(await response.json());
}

/** Applies the settings saved on the server. Call it when your app starts, so they apply before the first file opens. */
export async function loadViewerSettings(options: SettingsStoreOptions): Promise<PdfSuiteSettings> {
  configureViewer(await readViewerSettings(options));
  return getViewerSettings();
}

/** Saves settings to the server. By default, saves everything that differs from the defaults. */
export async function saveViewerSettings(options: SettingsStoreOptions, settings: Partial<PdfSuiteSettings> = getChangedSettings()): Promise<void> {
  const client = new ServiceClient(options.serviceUrl, options.serviceHeaders);
  await client.request(settingsPath(options), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
}
