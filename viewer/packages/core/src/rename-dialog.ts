const INVALID_NAME_CHARACTERS = /[\\/:*?"<>|\u0000-\u001f]/;
const MAX_NAME_LENGTH = 200;

const DIALOG_CSS = `
:host { font: 13px/1.4 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
dialog { width: min(92vw, 400px); padding: 16px; border: 1px solid var(--pr-border); border-radius: 8px; background: var(--pr-surface); color: var(--pr-text); box-shadow: 0 8px 28px rgba(10, 16, 30, 0.3); }
:host { --pr-surface: #ffffff; --pr-text: #1c2230; --pr-muted: #5b6474; --pr-border: #d7dbe2; --pr-hover: #e6e9ef; --pr-accent: #2f5fd0; --pr-accent-text: #ffffff; }
:host([data-theme='dark']) { --pr-surface: #262b35; --pr-text: #e7eaf0; --pr-muted: #a0a8b6; --pr-border: #3a404c; --pr-hover: #333946; --pr-accent: #7ea2f5; --pr-accent-text: #10141c; }
dialog::backdrop { background: rgba(10, 16, 30, 0.3); }
* { box-sizing: border-box; }
form { display: flex; flex-direction: column; gap: 10px; }
h2 { margin: 0; font-size: 15px; }
label { display: flex; flex-direction: column; gap: 4px; color: var(--pr-muted); }
.field { display: flex; align-items: center; gap: 4px; color: var(--pr-text); }
input { flex: 1; min-width: 0; height: 32px; padding: 0 8px; border: 1px solid var(--pr-border); border-radius: 5px; background: transparent; color: inherit; font: inherit; }
input:focus-visible, button:focus-visible { outline: 2px solid var(--pr-accent); outline-offset: 1px; }
.error { min-height: 18px; margin: 0; color: #b3261e; font-size: 12px; }
:host([data-theme='dark']) .error { color: #f2877f; }
.actions { display: flex; justify-content: flex-end; gap: 6px; }
button { min-height: 32px; padding: 0 12px; border: 1px solid var(--pr-border); border-radius: 6px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
button:hover { background: var(--pr-hover); }
button[type='submit'] { border-color: var(--pr-accent); background: var(--pr-accent); color: var(--pr-accent-text); }
`;

function splitName(fileName: string): { base: string; extension: string } {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? { base: fileName.slice(0, dot), extension: fileName.slice(dot) } : { base: fileName, extension: '' };
}

/** Explains what's wrong with a file name, or returns null if it's fine. */
export function validateFileName(base: string): string | null {
  const trimmed = base.trim();
  if (!trimmed) return 'Enter a file name.';
  if (INVALID_NAME_CHARACTERS.test(trimmed)) return 'A file name can\'t contain \\ / : * ? " < > or |';
  if (trimmed.length > MAX_NAME_LENGTH) return `Use ${MAX_NAME_LENGTH} characters or fewer.`;
  return null;
}

/**
 * Asks what to call a download, starting from the current name. The extension is kept, because it has to match
 * the file's contents. Returns the full name, or null if the user cancels.
 */
export function askFileName(fileName: string, theme: 'light' | 'dark' = 'light'): Promise<string | null> {
  const { base, extension } = splitName(fileName);

  return new Promise((resolve) => {
    const host = document.createElement('div');
    host.dataset.theme = theme;
    host.dataset.pdfRename = '';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = DIALOG_CSS;

    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-labelledby', 'pr-title');
    const form = document.createElement('form');
    form.noValidate = true;
    const heading = document.createElement('h2');
    heading.id = 'pr-title';
    heading.textContent = 'Download as';

    const label = document.createElement('label');
    label.textContent = 'File name';
    const field = document.createElement('span');
    field.className = 'field';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = base;
    input.autocomplete = 'off';
    input.setAttribute('aria-describedby', 'pr-error');
    field.append(input);
    if (extension) field.append(extension);
    label.append(field);

    const error = document.createElement('p');
    error.className = 'error';
    error.id = 'pr-error';
    error.setAttribute('role', 'alert');

    const actions = document.createElement('div');
    actions.className = 'actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.textContent = 'Download';
    actions.append(cancel, submit);
    form.append(heading, label, error, actions);
    dialog.append(form);
    shadow.append(style, dialog);

    const finish = (result: string | null) => {
      dialog.close();
      host.remove();
      resolve(result);
    };

    input.addEventListener('input', () => {
      error.textContent = '';
    });
    cancel.addEventListener('click', () => finish(null));
    // Esc cancels this question only, not a modal underneath it.
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(null);
    });
    dialog.addEventListener('keydown', (event) => event.stopPropagation());
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      // Someone typing the extension as well shouldn't end up with "report.pdf.pdf".
      const typed = input.value.trim();
      const name = extension && typed.toLowerCase().endsWith(extension.toLowerCase()) ? typed.slice(0, -extension.length).trim() : typed;
      const problem = validateFileName(name);
      if (problem) {
        error.textContent = problem;
        input.focus();
        return;
      }
      finish(`${name}${extension}`);
    });

    document.body.append(host);
    dialog.showModal();
    input.focus();
    input.select();
  });
}
