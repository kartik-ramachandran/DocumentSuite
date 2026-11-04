import { configureViewer, getViewerSettings, onViewerSettingsChange, type SettingsPanelOptions } from '@pdf-suite/viewer';

/** Choices are remembered in this browser. Add ?save=server to save them through the API instead. */
export function demoPanelOptions(serviceUrl: string): SettingsPanelOptions {
  const params = new URLSearchParams(location.search);
  return params.get('save') === 'server'
    ? { serviceUrl, scope: params.get('scope') ?? 'demo' }
    : { storageKey: 'pdf-suite-demo-settings' };
}

/** Lets a link set up the demo: ?settings={"clickAction":"menu"}, or the shorter ?click=menu and ?rename=1. */
export function applyDemoSettings(): void {
  const params = new URLSearchParams(location.search);
  configureViewer({
    ...(params.get('click') ? { clickAction: params.get('click') as 'open' | 'menu' | 'none' } : {}),
    ...(params.get('rename') === '1' ? { allowRename: true } : {}),
    ...(params.get('settings') ? JSON.parse(params.get('settings')!) : {}),
  });
  Object.assign(window, { configureViewer });

  const applyPageTheme = () => {
    const { theme } = getViewerSettings();
    document.documentElement.style.colorScheme = theme === 'auto' ? 'light dark' : theme;
  };
  onViewerSettingsChange(applyPageTheme);
  applyPageTheme();
}
