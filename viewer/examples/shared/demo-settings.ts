import { configureViewer } from '@pdf-suite/viewer';

/** Lets a link set up the demo: ?settings={"clickAction":"menu"}, or the shorter ?click=menu and ?rename=1. */
export function applyDemoSettings(): void {
  const params = new URLSearchParams(location.search);
  configureViewer({
    ...(params.get('click') ? { clickAction: params.get('click') as 'open' | 'menu' | 'none' } : {}),
    ...(params.get('rename') === '1' ? { allowRename: true } : {}),
    ...(params.get('settings') ? JSON.parse(params.get('settings')!) : {}),
  });
  Object.assign(window, { configureViewer });
}
