export interface ContextMenuItem {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  /** Marks an action such as Delete, which is shown in red. */
  danger?: boolean;
  /** Draws a divider above this item. */
  separator?: boolean;
}

export interface ContextMenuHandle {
  close(): void;
}

const VIEWPORT_MARGIN = 8;

const MENU_CSS = `
:host { font: 13px/1.4 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
[role='menu'] {
  position: fixed;
  z-index: 2147483000;
  min-width: 170px;
  max-height: calc(100vh - 16px);
  overflow: auto;
  padding: 4px;
  border: 1px solid var(--pm-border, #d7dbe2);
  border-radius: 8px;
  background: var(--pm-surface, #ffffff);
  color: var(--pm-text, #1c2230);
  box-shadow: 0 8px 28px rgba(10, 16, 30, 0.25);
}
:host([data-theme='dark']) [role='menu'] { --pm-surface: #262b35; --pm-text: #e7eaf0; --pm-border: #3a404c; --pm-hover: #333946; }
button { display: block; width: 100%; padding: 7px 12px; border: 0; border-radius: 5px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
button:hover:not(:disabled), button:focus { background: var(--pm-hover, #e6e9ef); outline: none; }
button:disabled { opacity: 0.45; cursor: default; }
button[data-danger] { color: #b3261e; }
:host([data-theme='dark']) button[data-danger] { color: #f2877f; }
hr { margin: 4px 2px; border: 0; border-top: 1px solid var(--pm-border, #d7dbe2); }
`;

let openMenu: ContextMenuHandle | null = null;

/** Shows a context menu at a screen position, kept inside the window. Only one is open at a time. */
export function openContextMenu(x: number, y: number, items: ContextMenuItem[], options: { label?: string; theme?: 'light' | 'dark' } = {}): ContextMenuHandle {
  openMenu?.close();

  const previousFocus = (document.activeElement?.shadowRoot?.activeElement ?? document.activeElement) as HTMLElement | null;
  const host = document.createElement('div');
  host.dataset.pdfMenu = '';
  const dark = options.theme === 'dark' || (options.theme !== 'light' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  host.dataset.theme = dark ? 'dark' : 'light';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = MENU_CSS;
  const menu = document.createElement('div');
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', options.label ?? 'Actions');

  let closed = false;
  const close = (restoreFocus = true) => {
    if (closed) return;
    closed = true;
    document.removeEventListener('pointerdown', handleOutsidePointer, true);
    window.removeEventListener('blur', closeOnly);
    window.removeEventListener('resize', closeOnly);
    cancelAnimationFrame(scrollListenFrame);
    document.removeEventListener('scroll', closeOnly, true);
    document.removeEventListener('contextmenu', handleOutsideContextMenu, true);
    host.remove();
    if (openMenu === handle) openMenu = null;
    if (restoreFocus) previousFocus?.focus?.();
  };
  const closeOnly = () => close(false);
  const handle: ContextMenuHandle = { close: () => close() };

  const isInside = (event: Event) => event.composedPath().includes(host);
  const handleOutsidePointer = (event: Event) => {
    if (!isInside(event)) close(false);
  };
  const handleOutsideContextMenu = (event: Event) => {
    if (!isInside(event)) close(false);
    else event.preventDefault();
  };

  for (const item of items) {
    if (item.separator) menu.append(document.createElement('hr'));
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.tabIndex = -1;
    button.textContent = item.label;
    button.dataset.item = item.id;
    button.disabled = Boolean(item.disabled);
    if (item.danger) button.dataset.danger = '';
    button.addEventListener('click', () => {
      close();
      item.onSelect();
    });
    menu.append(button);
  }

  const enabledButtons = () => Array.from(menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
  menu.addEventListener('keydown', (event) => {
    const buttons = enabledButtons();
    const current = buttons.indexOf(shadow.activeElement as HTMLButtonElement);
    const focusAt = (index: number) => buttons[(index + buttons.length) % buttons.length]?.focus();
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusAt(current + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusAt(current - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusAt(0);
        break;
      case 'End':
        event.preventDefault();
        focusAt(-1);
        break;
      case 'Escape':
      case 'Tab':
        event.preventDefault();
        close();
        break;
    }
  });

  shadow.append(style, menu);
  document.body.append(host);

  const { width, height } = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(VIEWPORT_MARGIN, Math.min(x, window.innerWidth - width - VIEWPORT_MARGIN))}px`;
  menu.style.top = `${Math.max(VIEWPORT_MARGIN, Math.min(y, window.innerHeight - height - VIEWPORT_MARGIN))}px`;

  document.addEventListener('pointerdown', handleOutsidePointer, true);
  document.addEventListener('contextmenu', handleOutsideContextMenu, true);
  // A scroll that finished just before the menu opened still sends its event in the next frame, and that mustn't close it.
  const scrollListenFrame = requestAnimationFrame(() => document.addEventListener('scroll', closeOnly, true));
  window.addEventListener('blur', closeOnly);
  window.addEventListener('resize', closeOnly);

  enabledButtons()[0]?.focus();
  openMenu = handle;
  return handle;
}
