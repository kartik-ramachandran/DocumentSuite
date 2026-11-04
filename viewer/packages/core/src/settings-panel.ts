import { configureViewer, getViewerSettings, onViewerSettingsChange, resetViewerSettings, SETTINGS_SCHEMA, type PdfSuiteSettings, type SettingDefinition } from './settings';

export interface SettingsPanelOptions {
  /** Remembers choices in this browser under this key. Leave it out if your app stores settings itself. */
  storageKey?: string;
  /** Hides settings your users shouldn't change. */
  exclude?: Array<keyof PdfSuiteSettings>;
  /** Called with all the settings after every change, so your app can save them. */
  onChange?: (settings: PdfSuiteSettings) => void;
}

const PANEL_CSS = `
:host {
  --ps-text: #1c2230;
  --ps-muted: #5b6474;
  --ps-border: #d7dbe2;
  --ps-hover: #eef1f6;
  --ps-surface: #ffffff;
  --ps-accent: #2f5fd0;
  display: block;
  font: 13px/1.4 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  color: var(--ps-text);
}
:host([data-theme='dark']) { --ps-text: #e7eaf0; --ps-muted: #a0a8b6; --ps-border: #3a404c; --ps-hover: #333946; --ps-surface: #262b35; --ps-accent: #7ea2f5; }
* { box-sizing: border-box; }
.ps-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
fieldset { min-width: 0; margin: 0; padding: 8px 12px 10px; border: 1px solid var(--ps-border); border-radius: 8px; background: var(--ps-surface); }
legend { padding: 0 4px; color: var(--ps-muted); font-weight: 600; }
label { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 30px; cursor: pointer; }
input[type='checkbox'] { flex-shrink: 0; width: 16px; height: 16px; margin: 0; accent-color: var(--ps-accent); cursor: pointer; }
select { flex-shrink: 0; max-width: 55%; height: 28px; padding: 0 4px; border: 1px solid var(--ps-border); border-radius: 5px; background: var(--ps-surface); color: inherit; font: inherit; }
input:focus-visible, select:focus-visible, button:focus-visible { outline: 2px solid var(--ps-accent); outline-offset: 1px; }
.ps-actions { display: flex; justify-content: flex-end; margin-top: 10px; }
button { min-height: 30px; padding: 0 12px; border: 1px solid var(--ps-border); border-radius: 6px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
button:hover { background: var(--ps-hover); }
`;

function readStored(key: string | undefined): Partial<PdfSuiteSettings> {
  if (!key) return {};
  try {
    return JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<PdfSuiteSettings>;
  } catch {
    return {};
  }
}

/** A ready-made settings screen. Changes apply straight away, to everything that opens afterwards. */
export class SettingsPanel {
  private readonly shadow: ShadowRoot;
  private readonly controls = new Map<keyof PdfSuiteSettings, HTMLInputElement | HTMLSelectElement>();
  private readonly unsubscribe: () => void;

  constructor(
    private readonly host: HTMLElement,
    private readonly options: SettingsPanelOptions = {},
  ) {
    this.shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    configureViewer(readStored(options.storageKey));
    this.build();
    this.unsubscribe = onViewerSettingsChange(() => this.sync());
    this.sync();
  }

  destroy(): void {
    this.unsubscribe();
    this.shadow.replaceChildren();
  }

  private build(): void {
    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    const grid = document.createElement('div');
    grid.className = 'ps-grid';

    for (const group of SETTINGS_SCHEMA) {
      const visible = group.settings.filter((setting) => !this.options.exclude?.includes(setting.key));
      if (visible.length === 0) continue;

      const fieldset = document.createElement('fieldset');
      const legend = document.createElement('legend');
      legend.textContent = group.title;
      fieldset.append(legend, ...visible.map((setting) => this.buildControl(setting)));
      grid.append(fieldset);
    }

    const actions = document.createElement('div');
    actions.className = 'ps-actions';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = 'Reset to defaults';
    reset.addEventListener('click', () => {
      resetViewerSettings();
      this.afterChange();
    });
    actions.append(reset);
    this.shadow.replaceChildren(style, grid, actions);
  }

  private buildControl(setting: SettingDefinition): HTMLElement {
    const label = document.createElement('label');
    const text = document.createElement('span');
    text.textContent = setting.label;
    label.append(text);

    if (setting.options) {
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
    if (this.options.storageKey) {
      try {
        localStorage.setItem(this.options.storageKey, JSON.stringify(settings));
      } catch {
        // The choice still applies for now. It just won't be remembered.
      }
    }
    this.options.onChange?.(settings);
  }

  private sync(): void {
    const settings = getViewerSettings();
    const dark = settings.theme === 'dark' || (settings.theme === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
    this.host.dataset.theme = dark ? 'dark' : 'light';
    for (const [key, control] of this.controls) {
      if (control instanceof HTMLInputElement) control.checked = Boolean(settings[key]);
      else control.value = String(settings[key]);
    }
  }
}

/** Shows the settings screen inside an element. */
export function createSettingsPanel(element: HTMLElement, options: SettingsPanelOptions = {}): SettingsPanel {
  return new SettingsPanel(element, options);
}
