import { NOTE_COLORS, createStickyNote, normalizeNotes, safeNoteHtml, type StickyNote } from '@/ui/stickyNotes';

const CSS = `
.sn-app{display:flex;height:100%;min-height:0;font:14px 'Segoe UI',sans-serif;}
.sn-list{width:220px;flex-shrink:0;display:flex;flex-direction:column;border-right:1px solid var(--border);background:var(--panel);padding:12px;box-sizing:border-box;}
.sn-list h2{font-size:20px;margin:5px 0 14px;}.sn-list header{display:flex;justify-content:space-between;align-items:center;}
.sn-app button{border:0;cursor:pointer;font:inherit;border-radius:3px;padding:6px 10px;}
.sn-list button{background:var(--panel-alt);color:var(--fg);}.sn-list input{width:100%;box-sizing:border-box;padding:8px;border:1px solid var(--border);background:var(--panel-alt);color:var(--fg);border-radius:4px;}
.sn-cards{overflow:auto;flex:1;margin-top:12px;}.sn-card{display:block;width:100%;text-align:left;margin-bottom:9px;white-space:pre-wrap;overflow-wrap:anywhere;padding:12px!important;min-height:68px;}
.sn-workspace{position:relative;flex:1;min-width:0;overflow:auto;background:var(--panel-alt);}
.sn-note{position:absolute;display:flex;flex-direction:column;box-sizing:border-box;min-width:240px;min-height:200px;resize:both;overflow:hidden;box-shadow:0 5px 22px #0004;border:1px solid #0002;border-radius:4px;}
.sn-note header{display:flex;align-items:center;height:38px;flex-shrink:0;background:#00000009;cursor:move;touch-action:none;user-select:none;}
.sn-note header span{flex:1;}.sn-note button{background:transparent;color:inherit;min-width:32px;height:32px;}.sn-note button:hover{background:#00000015;}
.sn-editor{flex:1;min-height:0;overflow:auto;outline:none;white-space:pre-wrap;overflow-wrap:anywhere;padding:12px;line-height:1.5;user-select:text;cursor:text;}
.sn-editor:empty:before{content:'Take a note…';opacity:.55;pointer-events:none;}.sn-editor img{max-width:100%;height:auto;display:block;margin:8px 0;}
.sn-format{display:flex;flex-shrink:0;border-top:1px solid #0001;padding:4px;}.sn-menu{position:absolute;top:38px;right:4px;left:4px;z-index:10;background:var(--panel);color:var(--fg);border:1px solid var(--border);padding:8px;box-shadow:0 8px 20px #0004;}
.sn-colors{display:flex;gap:3px;margin-bottom:8px;}.sn-colors button{min-width:0;width:28px;height:28px;padding:0;border:1px solid #5554;}.sn-status{font-size:11px;margin-top:9px;color:var(--muted);}
.sn-confirm{position:absolute;inset:0;z-index:100;background:#0006;display:grid;place-items:center;}.sn-dialog{padding:24px;background:var(--panel);color:var(--fg);border:1px solid var(--border);border-radius:8px;max-width:300px;}
`;

export function renderStickyNotesWindow(body: HTMLElement, owner = 'workstation'): void {
  if (!document.getElementById('sticky-notes-css')) { const style = document.createElement('style'); style.id = 'sticky-notes-css'; style.textContent = CSS; document.head.appendChild(style); }
  const key = `sticky_notes_v2:${owner}`;
  let notes: StickyNote[] = [];
  try {
    const saved = localStorage.getItem(key), legacy = localStorage.getItem('sticky_notes');
    notes = normalizeNotes(JSON.parse(saved ?? legacy ?? '[]'));
    if (!saved && !legacy) { const n = createStickyNote(); n.text = 'Remember: verify identity before granting access.'; notes = [n]; }
  } catch { notes = [createStickyNote()]; }
  body.replaceChildren(); Object.assign(body.style, { position: 'relative', overflow: 'hidden', flex: '1', minHeight: '0' });
  const app = document.createElement('div'); app.className = 'sn-app';
  const list = document.createElement('aside'); list.className = 'sn-list';
  const header = document.createElement('header'), title = document.createElement('h2'); title.textContent = 'Sticky Notes';
  const search = document.createElement('input'); search.placeholder = 'Search your notes'; search.setAttribute('aria-label', 'Search notes');
  const cards = document.createElement('div'); cards.className = 'sn-cards';
  const status = document.createElement('div'); status.className = 'sn-status'; status.setAttribute('role', 'status');
  const workspace = document.createElement('div'); workspace.className = 'sn-workspace';
  const windows = new Map<string, HTMLElement>(); let top = 1;
  const button = (text: string, label: string, action: () => void): HTMLButtonElement => {
    const b = document.createElement('button'); b.textContent = text; b.title = label; b.setAttribute('aria-label', label); b.onclick = action; return b;
  };
  const newNote = (): void => { const note = createStickyNote(notes.length); notes.push(note); open(note); save(); renderList(); };
  header.append(title, button('+', 'New note (Ctrl+N)', newNote)); list.append(header, search, cards, status); app.append(list, workspace); body.appendChild(app);
  function save(): void {
    try { localStorage.setItem(key, JSON.stringify(notes)); status.textContent = 'All notes saved'; }
    catch { status.textContent = 'Storage is full. Remove a picture or copy this note before closing.'; }
  }
  function renderList(): void {
    cards.replaceChildren(); const q = search.value.toLowerCase();
    for (const note of [...notes].sort((a, b) => b.updatedAt - a.updatedAt).filter(n => n.text.toLowerCase().includes(q))) {
      const card = button(note.text.trim().slice(0, 150) || (note.html.includes('<img') ? 'Picture note' : 'Empty note'), `Open note: ${note.text.slice(0, 60) || 'Empty note'}`, () => { note.open = true; open(note); save(); });
      card.className = 'sn-card'; card.style.background = note.color; card.style.color = note.color === '#333333' ? '#fafafa' : '#202020'; cards.appendChild(card);
    }
    if (!cards.childElementCount) { const empty = document.createElement('p'); empty.textContent = q ? 'No matching notes' : 'No notes yet. Select + to create one.'; cards.appendChild(empty); }
  }
  function close(note: StickyNote): void { note.open = false; windows.get(note.id)?.remove(); windows.delete(note.id); save(); }
  function remove(note: StickyNote): void {
    const veil = document.createElement('div'); veil.className = 'sn-confirm';
    const dialog = document.createElement('div'); dialog.className = 'sn-dialog'; dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-label', 'Delete note');
    const text = document.createElement('p'); text.textContent = 'Delete this note? This removes it from your notes list.';
    const cancel = button('Keep note', 'Keep note', () => veil.remove());
    dialog.append(text, cancel, button('Delete', 'Confirm delete note', () => { close(note); notes = notes.filter(n => n !== note); save(); renderList(); veil.remove(); }));
    veil.appendChild(dialog); body.appendChild(veil); cancel.focus();
  }
  function open(note: StickyNote): void {
    const existing = windows.get(note.id);
    if (existing) { existing.style.zIndex = String(++top); existing.querySelector<HTMLElement>('.sn-editor')?.focus(); return; }
    note.open = true;
    const win = document.createElement('section'); win.className = 'sn-note'; win.setAttribute('aria-label', 'Sticky note'); win.setAttribute('role', 'region');
    Object.assign(win.style, { left: `${note.left}px`, top: `${note.top}px`, width: `${note.width}px`, height: `${note.height}px`, background: note.color, color: note.color === '#333333' ? '#fafafa' : '#202020', zIndex: String(++top) });
    const bar = document.createElement('header'), space = document.createElement('span');
    const editor = document.createElement('div'); editor.className = 'sn-editor'; editor.contentEditable = 'true'; editor.setAttribute('role', 'textbox'); editor.setAttribute('aria-label', 'Note content'); editor.setAttribute('aria-multiline', 'true');
    if (note.html) editor.innerHTML = safeNoteHtml(note.html); else editor.textContent = note.text;
    const persist = (): void => { note.text = editor.innerText; note.html = safeNoteHtml(editor.innerHTML); note.updatedAt = Date.now(); save(); renderList(); };
    const format = (command: string): void => { editor.focus(); document.execCommand(command); persist(); };
    bar.append(button('+', 'New note (Ctrl+N)', newNote), space, button('…', 'Note menu', () => {
      const previous = win.querySelector('.sn-menu'); if (previous) { previous.remove(); return; }
      const menu = document.createElement('div'); menu.className = 'sn-menu'; const colors = document.createElement('div'); colors.className = 'sn-colors';
      for (const [name, color] of NOTE_COLORS) { const b = button(note.color === color ? '✓' : '', `${name} note`, () => { note.color = color; win.style.background = color; win.style.color = color === '#333333' ? '#fafafa' : '#202020'; menu.remove(); save(); renderList(); }); b.style.background = color; b.style.color = color === '#333333' ? '#fff' : '#202020'; colors.appendChild(b); }
      menu.append(colors, button('Notes list', 'Show notes list', () => { menu.remove(); search.focus(); }), button('Delete note', 'Delete note', () => { menu.remove(); remove(note); })); win.appendChild(menu);
    }), button('×', 'Close note (Ctrl+W)', () => close(note)));
    const tools = document.createElement('footer'); tools.className = 'sn-format';
    for (const [label, title, command] of [['B', 'Bold (Ctrl+B)', 'bold'], ['I', 'Italic (Ctrl+I)', 'italic'], ['U', 'Underline (Ctrl+U)', 'underline'], ['S̶', 'Strikethrough (Ctrl+T)', 'strikeThrough'], ['•', 'Bullets (Ctrl+Shift+L)', 'insertUnorderedList']]) {
      const b = button(label!, title!, () => format(command!)); b.onmousedown = e => e.preventDefault(); tools.appendChild(b);
    }
    const file = document.createElement('input'); file.type = 'file'; file.accept = 'image/png,image/jpeg,image/webp'; file.hidden = true;
    file.onchange = () => { const selected = file.files?.[0]; if (!selected) return; if (!['image/png', 'image/jpeg', 'image/webp'].includes(selected.type)) { status.textContent = 'Choose a PNG, JPEG or WebP picture.'; return; } if (selected.size > 1_000_000) { status.textContent = 'Choose a picture smaller than 1 MB.'; return; } const reader = new FileReader(); reader.onload = () => { const img = document.createElement('img'); img.src = String(reader.result); img.alt = selected.name; editor.appendChild(img); persist(); }; reader.readAsDataURL(selected); file.value = ''; };
    tools.append(button('▧', 'Add picture', () => file.click()), file);
    editor.oninput = persist;
    editor.onpaste = event => { const html = event.clipboardData?.getData('text/html'); if (!html) return; event.preventDefault(); document.execCommand('insertHTML', false, safeNoteHtml(html)); persist(); };
    editor.onkeydown = event => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      const command = key === 'b' ? 'bold' : key === 'i' ? 'italic' : key === 'u' ? 'underline' : key === 't' ? 'strikeThrough' : key === 'l' && event.shiftKey ? 'insertUnorderedList' : '';
      if (command) { event.preventDefault(); event.stopPropagation(); format(command); }
      else if (key === 'w') { event.preventDefault(); event.stopPropagation(); close(note); }
    };
    win.onpointerdown = () => { win.style.zIndex = String(++top); };
    bar.onpointerdown = event => {
      if ((event.target as HTMLElement).closest('button') || event.button !== 0) return;
      const x = event.clientX, y = event.clientY, left = win.offsetLeft, top = win.offsetTop;
      const scale = win.getBoundingClientRect().width / win.offsetWidth || 1;
      bar.setPointerCapture(event.pointerId);
      bar.onpointermove = e => { win.style.left = `${Math.max(0, left + (e.clientX - x) / scale)}px`; win.style.top = `${Math.max(0, top + (e.clientY - y) / scale)}px`; };
      bar.onpointerup = () => { bar.onpointermove = null; note.left = win.offsetLeft; note.top = win.offsetTop; save(); };
    };
    win.onpointerup = () => { note.width = win.offsetWidth; note.height = win.offsetHeight; save(); };
    win.append(bar, editor, tools); workspace.appendChild(win); windows.set(note.id, win); editor.focus();
  }
  search.oninput = renderList;
  app.onkeydown = event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); event.stopPropagation(); newNote(); } };
  for (const note of notes.filter(n => n.open)) open(note);
  renderList(); save();
}
