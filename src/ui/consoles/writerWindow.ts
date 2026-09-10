/**
 * ui/consoles/writerWindow.ts — Writer, the workstation's word processor.
 *
 * It exists because writing things up is part of the job being taught, not
 * because an operating system needs a word processor to look complete. The
 * scoring rubric gives documentation and evidence fifteen points each, and
 * "walk me through how you documented that incident" is a real interview
 * question. So Writer opens on the forms an identity engineer actually files —
 * incident report, access review summary, offboarding checklist, change
 * record, runbook — each with the prompts that stop a write-up being useless.
 *
 * Documents persist per browser in localStorage. That is the right storage for
 * this: the notes are the learner's own working papers, they should survive a
 * reload, and nothing else in the system needs to read them.
 *
 * Formatting uses document.execCommand. It is deprecated and it is still what
 * every browser implements for contenteditable; the alternative is a rich-text
 * engine, which is a large dependency for a window that makes text bold.
 */
import { DOCUMENT_TEMPLATES, TEMPLATE_BY_ID } from '@/config/documentTemplates';
import { showToast } from '@/ui/toast';
import { copyText } from '@/util/copyText';

const STORE_KEY = 'writer_documents';
const LAST_OPEN_KEY = 'writer_last_open';

interface WriterDoc {
  id: string;
  title: string;
  html: string;
  updatedAt: number;
}

function loadDocs(): WriterDoc[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const parsed = raw ? (JSON.parse(raw) as WriterDoc[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // A corrupt or unavailable store must not take the window down with it.
    return [];
  }
}

function saveDocs(docs: WriterDoc[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(docs));
  } catch {
    /* quota or private mode — the document stays in memory for this session */
  }
}

function newId(): string {
  return `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function renderWriterWindow(body: HTMLElement): void {
  body.innerHTML = '';
  body.style.cssText =
    'display:flex;flex-direction:column;height:100%;background:var(--panel);color:var(--fg);' +
    'font-family:"Segoe UI",system-ui,sans-serif;';

  let docs = loadDocs();
  let currentId: string | null = null;
  /** Set on every edit, cleared on save — drives the unsaved marker. */
  let dirty = false;

  // --- Menu bar -------------------------------------------------------------
  const menubar = document.createElement('div');
  menubar.style.cssText =
    'flex-shrink:0;display:flex;align-items:center;gap:6px;padding:6px 10px;' +
    'background:var(--panel-alt);border-bottom:1px solid var(--border);font-size:12px;';

  const titleField = document.createElement('input');
  titleField.type = 'text';
  titleField.placeholder = 'Untitled document';
  titleField.style.cssText =
    'flex:1;min-width:0;background:transparent;border:1px solid transparent;border-radius:4px;' +
    'color:var(--fg);font-size:13px;padding:4px 6px;outline:none;font-family:inherit;';
  titleField.addEventListener('focus', () => {
    titleField.style.borderColor = 'var(--border)';
    titleField.style.background = 'var(--panel)';
  });
  titleField.addEventListener('blur', () => {
    titleField.style.borderColor = 'transparent';
    titleField.style.background = 'transparent';
  });
  titleField.addEventListener('input', () => {
    dirty = true;
    paintStatus();
  });

  const dirtyMark = document.createElement('span');
  dirtyMark.style.cssText = 'font-size:11px;color:#e2a03f;min-width:64px;';

  menubar.append(menuButton('New', () => newDocument()), menuButton('Open', () => openPicker()));
  menubar.append(titleField, dirtyMark);
  menubar.append(
    menuButton('Save', () => save(), 'primary'),
    menuButton('Delete', () => remove()),
  );
  body.appendChild(menubar);

  function menuButton(
    label: string,
    onClick: () => void,
    tone: 'plain' | 'primary' = 'plain',
  ): HTMLElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText =
      'padding:5px 11px;border-radius:4px;cursor:pointer;font-size:11.5px;font-family:inherit;' +
      (tone === 'primary'
        ? 'background:#2563eb;color:#fff;border:1px solid #2563eb;'
        : 'background:var(--panel);color:var(--fg);border:1px solid var(--border);');
    b.addEventListener('click', onClick);
    return b;
  }

  // --- Formatting toolbar ---------------------------------------------------
  const toolbar = document.createElement('div');
  toolbar.style.cssText =
    'flex-shrink:0;display:flex;align-items:center;gap:3px;flex-wrap:wrap;padding:6px 10px;' +
    'background:var(--panel-alt);border-bottom:1px solid var(--border);';

  /** Apply a formatting command to the selection and keep focus in the page. */
  function exec(command: string, value?: string): void {
    editor.focus();
    document.execCommand(command, false, value);
    dirty = true;
    paintStatus();
  }

  function toolButton(label: string, title: string, onClick: () => void, style = ''): void {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title;
    b.style.cssText =
      'min-width:28px;height:26px;padding:0 7px;border-radius:3px;cursor:pointer;font-size:12px;' +
      `background:var(--panel);color:var(--fg);border:1px solid var(--border);font-family:inherit;${style}`;
    b.addEventListener('click', onClick);
    toolbar.appendChild(b);
  }

  function separator(): void {
    const s = document.createElement('span');
    s.style.cssText = 'width:1px;height:18px;background:var(--border);margin:0 4px;';
    toolbar.appendChild(s);
  }

  const styleSelect = document.createElement('select');
  styleSelect.style.cssText =
    'height:26px;border-radius:3px;background:var(--panel);color:var(--fg);border:1px solid var(--border);' +
    'font-size:11.5px;font-family:inherit;padding:0 4px;';
  for (const [value, label] of [
    ['p', 'Body text'],
    ['h1', 'Title'],
    ['h2', 'Heading'],
    ['h3', 'Subheading'],
    ['pre', 'Code'],
  ] as const) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    styleSelect.appendChild(o);
  }
  styleSelect.addEventListener('change', () => exec('formatBlock', `<${styleSelect.value}>`));
  toolbar.appendChild(styleSelect);

  separator();
  toolButton('B', 'Bold (Ctrl+B)', () => exec('bold'), 'font-weight:700;');
  toolButton('I', 'Italic (Ctrl+I)', () => exec('italic'), 'font-style:italic;');
  toolButton('U', 'Underline (Ctrl+U)', () => exec('underline'), 'text-decoration:underline;');
  separator();
  toolButton('•', 'Bulleted list', () => exec('insertUnorderedList'));
  toolButton('1.', 'Numbered list', () => exec('insertOrderedList'));
  separator();
  toolButton('⌫', 'Clear formatting', () => exec('removeFormat'));
  toolButton('↶', 'Undo (Ctrl+Z)', () => exec('undo'));
  toolButton('↷', 'Redo (Ctrl+Y)', () => exec('redo'));
  separator();
  toolButton('⧉', 'Copy the whole document as plain text', () => copyPlainText());

  body.appendChild(toolbar);

  // --- Editor ---------------------------------------------------------------
  const page = document.createElement('div');
  page.style.cssText = 'flex:1;overflow-y:auto;padding:26px 0;background:var(--bg);';

  const editor = document.createElement('div');
  editor.contentEditable = 'true';
  editor.spellcheck = true;
  // A page rather than a full-width text area: line length matters for
  // something meant to be read by somebody else.
  editor.style.cssText =
    'max-width:760px;min-height:600px;margin:0 auto;padding:48px 56px;background:var(--panel);' +
    'border:1px solid var(--border);border-radius:3px;outline:none;font-size:14px;line-height:1.75;' +
    'color:var(--fg);box-shadow:0 2px 18px rgba(0,0,0,0.45);';
  editor.addEventListener('input', () => {
    dirty = true;
    paintStatus();
  });
  page.appendChild(editor);
  body.appendChild(page);

  // --- Status bar -----------------------------------------------------------
  const status = document.createElement('div');
  status.style.cssText =
    'flex-shrink:0;height:26px;display:flex;align-items:center;gap:16px;padding:0 12px;' +
    'background:var(--panel-alt);border-top:1px solid var(--border);font-size:11px;color:var(--muted);';
  body.appendChild(status);

  function paintStatus(): void {
    const text = editor.innerText.trim();
    const words = text ? text.split(/\s+/).length : 0;
    status.textContent = `${words} word(s) · ${text.length} character(s)`;
    dirtyMark.textContent = dirty ? '● unsaved' : '';
  }

  // --- Document operations --------------------------------------------------
  function load(doc: WriterDoc): void {
    currentId = doc.id;
    titleField.value = doc.title;
    // The learner's own markup, written in this editor and stored in this
    // browser. It is never shared, never fetched, and never rendered for
    // anyone else, so there is no boundary here to sanitise across.
    editor.innerHTML = doc.html;
    dirty = false;
    paintStatus();
    try {
      localStorage.setItem(LAST_OPEN_KEY, doc.id);
    } catch {
      /* ignore */
    }
  }

  function save(): void {
    const title = titleField.value.trim() || 'Untitled document';
    const html = editor.innerHTML;
    const now = Date.now();

    if (currentId) {
      const existing = docs.find((d) => d.id === currentId);
      if (existing) {
        existing.title = title;
        existing.html = html;
        existing.updatedAt = now;
      }
    } else {
      const doc: WriterDoc = { id: newId(), title, html, updatedAt: now };
      docs.push(doc);
      currentId = doc.id;
    }

    saveDocs(docs);
    dirty = false;
    paintStatus();
    showToast(`Saved "${title}".`, { kind: 'success' });
  }

  function remove(): void {
    if (!currentId) {
      showToast('This document has never been saved.', { kind: 'info' });
      return;
    }
    const doc = docs.find((d) => d.id === currentId);
    if (!doc) return;
    if (!window.confirm(`Delete "${doc.title}"? This cannot be undone.`)) return;

    docs = docs.filter((d) => d.id !== currentId);
    saveDocs(docs);
    currentId = null;
    titleField.value = '';
    editor.innerHTML = '<p><br></p>';
    dirty = false;
    paintStatus();
    showToast('Document deleted.', { kind: 'info' });
  }

  function copyPlainText(): void {
    copyText(editor.innerText).then((ok) =>
      ok
        ? showToast('Copied as plain text.', { kind: 'success' })
        : showToast('Could not reach the clipboard.', { kind: 'error' }),
    );
  }

  // --- Dialogs --------------------------------------------------------------
  function modal(title: string, build: (b: HTMLElement) => void): void {
    const veil = document.createElement('div');
    veil.style.cssText =
      'position:absolute;inset:0;background:rgba(0,0,0,0.55);display:flex;' +
      'align-items:center;justify-content:center;z-index:50;';
    const box = document.createElement('div');
    box.style.cssText =
      'background:var(--panel-alt);border:1px solid var(--border);border-radius:6px;min-width:420px;' +
      'max-width:80%;max-height:80%;overflow:auto;padding:16px 18px;' +
      'box-shadow:0 10px 40px rgba(0,0,0,0.6);';
    const h = document.createElement('div');
    h.textContent = title;
    h.style.cssText = 'font-size:14px;font-weight:600;margin-bottom:12px;';
    box.appendChild(h);
    build(box);

    const close = document.createElement('button');
    close.textContent = 'Cancel';
    close.style.cssText =
      'margin-top:14px;padding:6px 14px;border-radius:4px;cursor:pointer;font-size:11.5px;' +
      'background:var(--panel);color:var(--fg);border:1px solid var(--border);font-family:inherit;';
    close.addEventListener('click', () => veil.remove());
    box.appendChild(close);

    veil.appendChild(box);
    veil.addEventListener('click', (e) => {
      if (e.target === veil) veil.remove();
    });
    body.appendChild(veil);
  }

  /**
   * Start a document from one of the forms this job actually files.
   *
   * A blank page is offered, but it is not the default: most of the value here
   * is in the prompts, and a learner who does not yet know what belongs in an
   * incident report will not discover it by staring at nothing.
   */
  function newDocument(): void {
    if (dirty && !window.confirm('Discard unsaved changes?')) return;

    modal('New document', (box) => {
      for (const t of DOCUMENT_TEMPLATES) {
        const card = document.createElement('button');
        card.style.cssText =
          'display:block;width:100%;text-align:left;padding:9px 11px;margin-bottom:6px;' +
          'border-radius:4px;background:var(--panel);border:1px solid var(--border);cursor:pointer;' +
          'color:var(--fg);font-family:inherit;';
        const name = document.createElement('div');
        name.textContent = t.title;
        name.style.cssText = 'font-size:12.5px;margin-bottom:2px;';
        const desc = document.createElement('div');
        desc.textContent = t.description;
        desc.style.cssText = 'font-size:11px;color:var(--muted);';
        card.append(name, desc);
        card.addEventListener('click', () => {
          const template = TEMPLATE_BY_ID[t.id]!;
          currentId = null;
          titleField.value = template.id === 'blank' ? '' : template.title;
          editor.innerHTML = template.body;
          dirty = true;
          paintStatus();
          box.parentElement?.remove();
        });
        box.appendChild(card);
      }
    });
  }

  function openPicker(): void {
    if (dirty && !window.confirm('Discard unsaved changes?')) return;

    modal('Open document', (box) => {
      if (docs.length === 0) {
        const empty = document.createElement('div');
        empty.textContent = 'No saved documents yet.';
        empty.style.cssText = 'color:var(--muted);font-size:12px;';
        box.appendChild(empty);
        return;
      }
      const sorted = [...docs].sort((a, b) => b.updatedAt - a.updatedAt);
      for (const d of sorted) {
        const row = document.createElement('button');
        row.style.cssText =
          'display:flex;width:100%;justify-content:space-between;align-items:center;gap:12px;' +
          'padding:8px 11px;margin-bottom:5px;border-radius:4px;background:var(--panel);' +
          'border:1px solid var(--border);cursor:pointer;color:var(--fg);font-family:inherit;' +
          'font-size:12px;text-align:left;';
        const name = document.createElement('span');
        name.textContent = d.title;
        const when = document.createElement('span');
        when.textContent = new Date(d.updatedAt).toLocaleString();
        when.style.cssText = 'font-size:10.5px;color:var(--muted);flex-shrink:0;';
        row.append(name, when);
        row.addEventListener('click', () => {
          load(d);
          box.parentElement?.remove();
        });
        box.appendChild(row);
      }
    });
  }

  // --- Keyboard -------------------------------------------------------------
  editor.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.key.toLowerCase() === 's') {
      e.preventDefault();
      save();
    }
  });

  // --- First paint ----------------------------------------------------------
  const lastId = localStorage.getItem(LAST_OPEN_KEY);
  const last = lastId ? docs.find((d) => d.id === lastId) : undefined;
  if (last) {
    load(last);
  } else {
    editor.innerHTML = '<p><br></p>';
    paintStatus();
    // Nothing to reopen, so offer the forms rather than an empty page.
    newDocument();
  }
}
