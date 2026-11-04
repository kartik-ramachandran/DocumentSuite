export const VIEWER_CSS = `
:host {
  --pv-bg: #eef0f3;
  --pv-surface: #ffffff;
  --pv-text: #1c2230;
  --pv-muted: #5b6474;
  --pv-border: #d7dbe2;
  --pv-hover: #e6e9ef;
  --pv-accent: #2f5fd0;
  --pv-accent-text: #ffffff;
  --pv-match: rgba(255, 196, 0, 0.45);
  --pv-match-current: rgba(255, 112, 0, 0.6);
  --pv-page-shadow: 0 1px 4px rgba(20, 28, 45, 0.25);
  display: block;
  position: relative;
  height: 100%;
  min-height: 320px;
  font: 13px/1.4 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  color: var(--pv-text);
}
:host([data-theme='dark']) {
  --pv-bg: #1a1e26;
  --pv-surface: #262b35;
  --pv-text: #e7eaf0;
  --pv-muted: #a0a8b6;
  --pv-border: #3a404c;
  --pv-hover: #333946;
  --pv-accent: #7ea2f5;
  --pv-accent-text: #10141c;
  --pv-page-shadow: 0 1px 6px rgba(0, 0, 0, 0.6);
}
* { box-sizing: border-box; }
.pv-root { display: flex; flex-direction: column; height: 100%; background: var(--pv-bg); overflow: hidden; }
.pv-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 4px; min-height: 42px; padding: 4px 8px; background: var(--pv-surface); border-bottom: 1px solid var(--pv-border); }
.pv-group { display: flex; align-items: center; gap: 2px; padding-right: 6px; margin-right: 2px; border-right: 1px solid var(--pv-border); }
.pv-group:last-child { border-right: 0; }
.pv-group:empty { display: none; }
.pv-spacer { flex: 1; }
.pv-root[data-toolbar-position='bottom'] > .pv-toolbar { order: 1; border-bottom: 0; border-top: 1px solid var(--pv-border); }
.pv-root[data-toolbar-position='left'] { display: grid; grid-template-columns: auto minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
.pv-root[data-toolbar-position='right'] { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-rows: auto minmax(0, 1fr); }
.pv-root[data-toolbar-position='left'] > .pv-toolbar { grid-column: 1; grid-row: 1 / -1; border-right: 1px solid var(--pv-border); }
.pv-root[data-toolbar-position='right'] > .pv-toolbar { grid-column: 2; grid-row: 1 / -1; border-left: 1px solid var(--pv-border); }
.pv-root[data-toolbar-position='left'] > .pv-searchbar { grid-column: 2; grid-row: 1; }
.pv-root[data-toolbar-position='right'] > .pv-searchbar { grid-column: 1; grid-row: 1; }
.pv-root[data-toolbar-position='left'] > .pv-body { grid-column: 2; grid-row: 2; min-width: 0; }
.pv-root[data-toolbar-position='right'] > .pv-body { grid-column: 1; grid-row: 2; min-width: 0; }
.pv-toolbar[aria-orientation='vertical'] { flex-direction: column; flex-wrap: nowrap; align-items: stretch; width: 100px; min-height: 0; padding: 6px 4px; overflow: hidden auto; border-bottom: 0; }
.pv-toolbar[aria-orientation='vertical'] > *, .pv-toolbar[aria-orientation='vertical'] .pv-group > * { flex-shrink: 0; }
.pv-toolbar[aria-orientation='vertical'] .pv-group { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); justify-items: center; align-items: center; padding: 0 0 6px; margin: 0 0 4px; border-right: 0; border-bottom: 1px solid var(--pv-border); }
.pv-toolbar[aria-orientation='vertical'] .pv-group:last-child { border-bottom: 0; }
.pv-toolbar[aria-orientation='vertical'] .pv-group:empty { display: none; }
.pv-toolbar[aria-orientation='vertical'] .pv-spacer { flex: 1 0 8px; }
.pv-toolbar[aria-orientation='vertical'] .pv-group:first-child > :nth-child(2) { grid-column: 1; }
.pv-toolbar[aria-orientation='vertical'] .pv-page-input { width: 34px; padding: 0 2px; }
.pv-toolbar[aria-orientation='vertical'] .pv-page-total { padding: 0; white-space: nowrap; }
.pv-toolbar[aria-orientation='vertical'] .pv-select { order: 1; grid-column: 1 / -1; width: 100%; margin-top: 2px; padding: 0 2px; }
@media (max-width: 560px) {
  .pv-toolbar[aria-orientation='vertical'] { width: 46px; }
  .pv-toolbar[aria-orientation='vertical'] .pv-group { grid-template-columns: minmax(0, 1fr); }
}
.pv-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-width: 32px; height: 32px; padding: 0 6px; border: 0; border-radius: 6px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
.pv-btn:hover:not(:disabled) { background: var(--pv-hover); }
.pv-btn:disabled { opacity: 0.4; cursor: default; }
.pv-btn[aria-pressed='true'], .pv-btn[aria-pressed='true']:hover:not(:disabled) { background: var(--pv-accent); color: var(--pv-accent-text); }
.pv-btn svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.pv-btn:focus-visible, .pv-input:focus-visible, .pv-select:focus-visible, .pv-thumb:focus-visible { outline: 2px solid var(--pv-accent); outline-offset: 1px; }
.pv-primary { background: var(--pv-accent); color: var(--pv-accent-text); padding: 0 12px; }
.pv-primary:hover:not(:disabled) { background: var(--pv-accent); filter: brightness(1.1); }
.pv-input, .pv-select { height: 28px; padding: 0 6px; border: 1px solid var(--pv-border); border-radius: 5px; background: var(--pv-surface); color: inherit; font: inherit; }
.pv-page-input { width: 46px; text-align: center; }
.pv-page-total { padding: 0 6px 0 4px; color: var(--pv-muted); white-space: nowrap; }
.pv-body { position: relative; display: flex; flex: 1; min-height: 0; }
.pv-sidebar { display: none; flex-direction: column; width: 220px; flex-shrink: 0; background: var(--pv-surface); border-right: 1px solid var(--pv-border); min-height: 0; }
.pv-sidebar[data-open='true'] { display: flex; }
.pv-tabs { display: flex; gap: 2px; padding: 4px; border-bottom: 1px solid var(--pv-border); }
.pv-tabs:has(> :only-child) { display: none; }
.pv-tab-panel { flex: 1; min-height: 0; overflow: auto; }
.pv-tab-panel[hidden] { display: none; }
.pv-thumbs { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 12px; }
.pv-thumb { display: block; padding: 3px; border: 2px solid transparent; border-radius: 4px; background: none; color: var(--pv-muted); font: inherit; cursor: pointer; }
.pv-thumb[aria-current='page'] { border-color: var(--pv-accent); color: var(--pv-text); }
.pv-thumb canvas { display: block; width: 100%; background: #fff; box-shadow: var(--pv-page-shadow); }
.pv-thumb-label { display: block; text-align: center; margin-top: 3px; }
.pv-scroll { position: relative; flex: 1; min-width: 0; overflow: auto; padding: 16px; outline: none; }
.pv-pages { display: flex; flex-direction: column; align-items: center; gap: 14px; width: max-content; min-width: 100%; }
.pv-page { position: relative; flex-shrink: 0; background: #fff; box-shadow: var(--pv-page-shadow); overflow: hidden; }
.pv-canvas { display: block; position: absolute; inset: 0; width: 100%; height: 100%; }
.pv-layers { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.pv-text { position: absolute; inset: 0; line-height: 1; overflow: hidden; }
.pv-text span { position: absolute; color: transparent; white-space: pre; transform-origin: 0 0; cursor: text; }
.pv-text span::selection { background: rgba(47, 95, 208, 0.3); }
.pv-matches, .pv-plugins { position: absolute; inset: 0; }
.pv-matches { pointer-events: none; }
.pv-plugins { pointer-events: none; }
.pv-match { position: absolute; background: var(--pv-match); }
.pv-match[data-current='true'] { background: var(--pv-match-current); }
.pv-searchbar { display: none; align-items: center; gap: 4px; padding: 4px 8px; background: var(--pv-surface); border-bottom: 1px solid var(--pv-border); }
.pv-searchbar[data-open='true'] { display: flex; }
.pv-search-input { width: 220px; max-width: 45vw; }
.pv-search-count { min-width: 64px; color: var(--pv-muted); }
.pv-empty, .pv-overlay { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 24px; text-align: center; color: var(--pv-muted); }
.pv-overlay { background: color-mix(in srgb, var(--pv-bg) 80%, transparent); color: var(--pv-text); z-index: 5; }
.pv-overlay[hidden], .pv-empty[hidden] { display: none; }
.pv-spinner { width: 28px; height: 28px; border: 3px solid var(--pv-border); border-top-color: var(--pv-accent); border-radius: 50%; animation: pv-spin 0.8s linear infinite; }
@keyframes pv-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .pv-spinner { animation-duration: 3s; } }
.pv-toast { position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); max-width: min(90%, 480px); padding: 8px 14px; border-radius: 6px; background: var(--pv-text); color: var(--pv-surface); box-shadow: var(--pv-page-shadow); z-index: 20; }
.pv-toast[data-kind='error'] { background: #b3261e; color: #fff; }
.pv-dialog { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); display: flex; flex-direction: column; gap: 10px; width: min(92%, 380px); padding: 16px; background: var(--pv-surface); border: 1px solid var(--pv-border); border-radius: 8px; box-shadow: 0 8px 28px rgba(0, 0, 0, 0.3); z-index: 30; }
.pv-dialog h2 { margin: 0; font-size: 15px; }
.pv-dialog label { display: flex; flex-direction: column; gap: 3px; color: var(--pv-muted); }
.pv-dialog .pv-input, .pv-dialog .pv-select { width: 100%; color: var(--pv-text); }
.pv-dialog-actions { display: flex; justify-content: flex-end; gap: 6px; }
.pv-file-input { display: none; }
[hidden] { display: none !important; }
.pv-root[data-kind='image'] [data-pdf-only], .pv-root[data-kind='image'] .pv-searchbar, .pv-root[data-kind='image'] .pv-scroll { display: none !important; }
.pv-root:not([data-kind='image']) [data-image-only] { display: none !important; }
.pv-image-host { display: none; position: relative; flex: 1; min-width: 0; }
.pv-root[data-kind='image'] .pv-image-host { display: block; }
@media (max-width: 560px) {
  .pv-sidebar[data-open='true'] { position: absolute; inset: 0 auto 0 0; z-index: 6; box-shadow: var(--pv-page-shadow); }
  .pv-hide-small { display: none; }
}
@media print { .pv-toolbar, .pv-searchbar, .pv-sidebar { display: none; } }
`;
