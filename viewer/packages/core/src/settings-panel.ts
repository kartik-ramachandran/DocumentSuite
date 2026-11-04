import { configureViewer, getChangedSettings, getViewerSettings, onViewerSettingsChange, resetViewerSettings, sanitizeSettings, SETTINGS_SCHEMA, type PdfSuiteSettings, type SettingDefinition } from './settings';
import { readViewerSettings, saveViewerSettings } from './settings-store';

const SAVE_DELAY_MS = 400;
const MAX_TEXT_LENGTH = 200;

export interface SettingsPanelOptions {
  /** Saves choices on the server, through the PDF API at this URL. */
  serviceUrl?: string;
  /** Headers sent when loading and saving, such as a gateway's auth token or the API's write key. */
  serviceHeaders?: Record<string, string>;
  /** Whose settings these are on the server, such as an app, team or user. Defaults to "default". */
  scope?: string;
  /** Remembers choices in this browser under this key. Leave it out if your app stores settings itself. */
  storageKey?: string;
  /** Hides settings your users shouldn't change. */
  exclude?: Array<keyof PdfSuiteSettings>;
  /** Called with all the settings after every change, so your app can save them. */
  onChange?: (settings: PdfSuiteSettings) => void;
}

const CHEVRON = (color: string) => `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M3 4.5 6 7.5 9 4.5' fill='none' stroke='%23${color}' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`;

const PANEL_CSS = `
:host {
  --ps-surface: #ffffff;
  --ps-text: #1c2230;
  --ps-muted: #5b6474;
  --ps-border: #d7dbe2;
  --ps-hover: #eef1f6;
  --ps-accent: #2f5fd0;
  --ps-switch-off: #8a93a3;
  --ps-knob: #ffffff;
  --ps-chevron: ${CHEVRON('5b6474')};
  display: block;
  color-scheme: light;
  color: var(--ps-text);
  font: 13px/1.4 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}
:host([data-theme='dark']) {
  --ps-surface: #262b35;
  --ps-text: #e7eaf0;
  --ps-muted: #a0a8b6;
  --ps-border: #3a404c;
  --ps-hover: #333946;
  --ps-accent: #7ea2f5;
  --ps-switch-off: #6b7484;
  --ps-knob: #14181f;
  --ps-chevron: ${CHEVRON('a0a8b6')};
  color-scheme: dark;
}
* { box-sizing: border-box; }
.ps-panel { border: 1px solid var(--ps-border); border-radius: 16px; background: var(--ps-surface); overflow: hidden; box-shadow: 0 8px 32px #10182808; animation: ps-enter 220ms ease-out; }
.ps-heading { padding: 24px 24px 0; }
.ps-heading h2 { margin: 0 0 6px; font-size: 20px; font-weight: 650; letter-spacing: -0.5px; }
.ps-heading p { margin: 0; color: var(--ps-muted); }
.ps-appearance { margin: 20px 24px 0; padding: 16px; border: 1px solid var(--ps-border); border-radius: 12px; background: color-mix(in srgb, var(--ps-hover) 40%, var(--ps-surface)); }
.ps-appearance label { border: 0; padding: 0; }
.ps-appearance label > span { font-weight: 600; }
.ps-preview { display: flex; gap: 6px; height: 56px; margin-top: 12px; padding: 8px; border: 1px solid var(--ps-border); border-radius: 8px; background: var(--ps-hover); }
.ps-preview::before { content: ''; width: 20%; border-radius: 4px; background: var(--ps-surface); }
.ps-preview::after { content: ''; width: 55%; margin: 0 auto; border-radius: 3px; background: var(--ps-surface); box-shadow: 0 2px 6px #10182812; }
.ps-groups { padding: 24px 24px 8px; columns: 2 300px; column-gap: 32px; }
fieldset { min-width: 0; margin: 0; padding: 0 0 16px; border: 0; break-inside: avoid; }
legend { padding: 0 0 10px; font-size: 12px; font-weight: 650; letter-spacing: 0.04em; }
label { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 40px; padding: 4px 0; border-top: 1px solid var(--ps-border); cursor: pointer; }
input[type='checkbox'] { position: relative; flex-shrink: 0; width: 32px; height: 18px; margin: 0; border-radius: 9px; background: var(--ps-switch-off); appearance: none; cursor: pointer; transition: background-color 120ms; }
input[type='checkbox']::before { content: ''; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: var(--ps-knob); transition: transform 120ms; }
input[type='checkbox']:checked { background: var(--ps-accent); }
input[type='checkbox']:checked::before { transform: translateX(14px); }
label.ps-stacked { flex-direction: column; align-items: stretch; gap: 6px; padding: 8px 0; }
.ps-text { width: 100%; min-height: 64px; padding: 6px 8px; border: 1px solid var(--ps-border); border-radius: 6px; background: var(--ps-surface); color: inherit; font: inherit; resize: vertical; }
label[data-disabled='true'] { color: var(--ps-muted); cursor: default; }
label[data-disabled='true'] select, label[data-disabled='true'] .ps-text, label[data-disabled='true'] input[type='checkbox'] { opacity: 0.55; cursor: default; }
select { flex: 0 0 150px; width: 150px; height: 30px; padding: 0 26px 0 8px; border: 1px solid var(--ps-border); border-radius: 6px; background: var(--ps-surface) var(--ps-chevron) no-repeat right 8px center; color: inherit; font: inherit; appearance: none; cursor: pointer; }
select:hover, button:hover { background-color: var(--ps-hover); }
input:focus-visible, textarea:focus-visible, select:focus-visible, button:focus-visible { outline: 2px solid var(--ps-accent); outline-offset: 2px; }
.ps-actions { display: flex; align-items: center; justify-content: flex-end; gap: 12px; padding: 10px 16px; border-top: 1px solid var(--ps-border); }
.ps-status { flex: 1; min-width: 0; color: var(--ps-muted); }
.ps-status[data-error='true'] { color: #c62828; }
:host([data-theme='dark']) .ps-status[data-error='true'] { color: #ff8a80; }
button { min-height: 36px; padding: 0 12px; border: 1px solid var(--ps-border); border-radius: 8px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
select { height: 36px; border-radius: 8px; }
.ps-panel, .ps-appearance, .ps-preview, .ps-preview::before, .ps-preview::after, label, select, textarea, button, .ps-actions { transition: background-color 220ms ease, color 220ms ease, border-color 220ms ease, box-shadow 180ms ease; }
button:active { background: var(--ps-hover); }
@keyframes ps-enter { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
@media (max-width: 420px) {
  .ps-heading { padding: 18px 16px 0; }
  .ps-appearance { margin: 16px 16px 0; }
  .ps-groups { padding: 20px 16px 4px; }
  label { gap: 8px; }
  select { flex-basis: 130px; width: 130px; }
}
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; animation: none !important; } }
`;

function readStored(key: string | undefined): Partial<PdfSuiteSettings> {
  if (!key) return {};
  try {
    return sanitizeSettings(JSON.parse(localStorage.getItem(key) ?? '{}'));
  } catch {
    return {};
  }
}

/** A ready-made settings screen. Changes apply straight away, to everything that opens afterwards. */
export class SettingsPanel {
  private readonly shadow: ShadowRoot;
  private readonly controls = new Map<keyof PdfSuiteSettings, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>();
  private readonly labels = new Map<keyof PdfSuiteSettings, HTMLLabelElement>();
  private readonly status = document.createElement('span');
  private readonly unsubscribe: () => void;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private saves: Promise<void> = Promise.resolve();
  private changedByUser = false;
  private destroyed = false;
  private readonly systemTheme = window.matchMedia?.('(prefers-color-scheme: dark)');
  private readonly syncSystemTheme = () => this.sync();

  constructor(
    private readonly host: HTMLElement,
    private readonly options: SettingsPanelOptions = {},
  ) {
    this.shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    configureViewer(readStored(options.storageKey));
    this.build();
    this.unsubscribe = onViewerSettingsChange(() => this.sync());
    this.systemTheme?.addEventListener('change', this.syncSystemTheme);
    this.sync();
    void this.loadFromServer();
  }

  destroy(): void {
    this.destroyed = true;
    // Anything still waiting to be saved is sent now, so that leaving the page straight after a change doesn't lose it.
    if (this.saveTimer !== undefined) {
      clearTimeout(this.saveTimer);
      void this.saveToServer();
    }
    this.unsubscribe();
    this.systemTheme?.removeEventListener('change', this.syncSystemTheme);
    this.shadow.replaceChildren();
  }

  private build(): void {
    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    const groups = document.createElement('div');
    groups.className = 'ps-groups';
    const heading = document.createElement('header');
    heading.className = 'ps-heading';
    const title = document.createElement('h2');
    title.textContent = 'Make it yours';
    const description = document.createElement('p');
    description.textContent = 'A comfortable space for your documents.';
    heading.append(title, description);
    const appearance = document.createElement('section');
    appearance.className = 'ps-appearance';
    appearance.setAttribute('aria-label', 'Appearance');
    const theme = SETTINGS_SCHEMA.flatMap((group) => group.settings).find((setting) => setting.key === 'theme')!;
    if (!this.options.exclude?.includes('theme')) {
      const preview = document.createElement('div');
      preview.className = 'ps-preview';
      preview.setAttribute('aria-hidden', 'true');
      appearance.append(this.buildControl(theme), preview);
    }

    for (const group of SETTINGS_SCHEMA) {
      const visible = group.settings.filter((setting) => setting.key !== 'theme' && !this.options.exclude?.includes(setting.key));
      if (visible.length === 0) continue;

      const fieldset = document.createElement('fieldset');
      const legend = document.createElement('legend');
      legend.textContent = group.title;
      fieldset.append(legend, ...visible.map((setting) => this.buildControl(setting)));
      groups.append(fieldset);
    }

    const actions = document.createElement('div');
    actions.className = 'ps-actions';
    this.status.className = 'ps-status';
    this.status.setAttribute('role', 'status');
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = 'Reset to defaults';
    reset.addEventListener('click', () => {
      resetViewerSettings();
      this.afterChange();
    });
    actions.append(this.status, reset);
    const panel = document.createElement('div');
    panel.className = 'ps-panel';
    panel.append(heading);
    if (appearance.childElementCount) panel.append(appearance);
    panel.append(groups, actions);
    this.shadow.replaceChildren(style, panel);
  }

  private buildControl(setting: SettingDefinition): HTMLElement {
    const label = document.createElement('label');
    const text = document.createElement('span');
    text.textContent = setting.label;
    label.append(text);
    this.labels.set(setting.key, label);

    if (setting.text) {
      label.classList.add('ps-stacked');
      const input = document.createElement('textarea');
      input.rows = 3;
      input.className = 'ps-text';
      input.maxLength = MAX_TEXT_LENGTH;
      input.dataset.setting = setting.key;
      input.addEventListener('input', () => this.apply({ [setting.key]: input.value }));
      this.controls.set(setting.key, input);
      label.append(input);
    } else if (setting.options) {
      const select = document.createElement('select');
      select.dataset.setting = setting.key;
      for (const option of setting.options) {
        const element = document.createElement('option');
        element.value = String(option.value);
        element.textContent = option.label;
        select.append(element);
      }
      select.addEventListener('change', () => {
        // Choices such as 100% are numbers, and form controls only hold text.
        const chosen = setting.options!.find((option) => String(option.value) === select.value)!;
        this.apply({ [setting.key]: chosen.value });
      });
      this.controls.set(setting.key, select);
      label.append(select);
    } else {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.setAttribute('role', 'switch');
      checkbox.dataset.setting = setting.key;
      checkbox.addEventListener('change', () => this.apply({ [setting.key]: checkbox.checked }));
      this.controls.set(setting.key, checkbox);
      label.append(checkbox);
    }
    return label;
  }

  private apply(change: Partial<PdfSuiteSettings>): void {
    configureViewer(change);
    this.afterChange();
  }

  private afterChange(): void {
    const settings = getViewerSettings();
    this.changedByUser = true;
    this.scheduleSave();
    if (this.options.storageKey) {
      try {
        localStorage.setItem(this.options.storageKey, JSON.stringify(getChangedSettings()));
      } catch {
        // The choice still applies for now. It just won't be remembered.
      }
    }
    this.options.onChange?.(settings);
  }

  private get store() {
    const { serviceUrl, serviceHeaders, scope } = this.options;
    return serviceUrl ? { serviceUrl, serviceHeaders, scope } : null;
  }

  private showStatus(message: string, isError = false): void {
    this.status.textContent = message;
    this.status.dataset.error = String(isError);
  }

  private async loadFromServer(): Promise<void> {
    if (!this.store) return;
    try {
      const saved = await readViewerSettings(this.store);
      // If something was changed while this was loading, that change is newer.
      if (!this.changedByUser && !this.destroyed) configureViewer(saved);
    } catch (error) {
      if (!this.destroyed) this.showStatus(`Couldn't load the saved settings. ${(error as Error).message}`, true);
    }
  }

  private scheduleSave(): void {
    if (!this.store) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.saveToServer(), SAVE_DELAY_MS);
  }

  private saveToServer(): Promise<void> {
    this.saveTimer = undefined;
    const { store } = this;
    if (!store) return Promise.resolve();
    // One at a time and in order, so that a slow save can't overwrite a newer one.
    this.saves = this.saves.then(async () => {
      try {
        await saveViewerSettings(store);
        if (!this.destroyed && this.saveTimer === undefined) this.showStatus('Saved');
      } catch (error) {
        if (!this.destroyed) this.showStatus(`Couldn't save. ${(error as Error).message}`, true);
      }
    });
    return this.saves;
  }

  private sync(): void {
    const settings = getViewerSettings();
    const dark = settings.theme === 'dark' || (settings.theme === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
    this.host.dataset.theme = dark ? 'dark' : 'light';
    for (const [key, control] of this.controls) {
      if (control instanceof HTMLInputElement && control.type === 'checkbox') control.checked = Boolean(settings[key]);
      else if (control.value !== String(settings[key])) control.value = String(settings[key]);
    }
    for (const setting of SETTINGS_SCHEMA.flatMap((group) => group.settings)) {
      if (!setting.enabledBy) continue;
      const enabled = Boolean(settings[setting.enabledBy]);
      const control = this.controls.get(setting.key);
      if (control) control.disabled = !enabled;
      this.labels.get(setting.key)?.setAttribute('data-disabled', String(!enabled));
    }
  }
}

/** Shows the settings screen inside an element. */
export function createSettingsPanel(element: HTMLElement, options: SettingsPanelOptions = {}): SettingsPanel {
  return new SettingsPanel(element, options);
}
