/**
 * ui/consoles/slidesWindow.ts — Slides.
 *
 * Presenting is part of this job and part of the rubric: communication carries
 * ten points, and "walk the leadership team through what happened" is a real
 * task with a real failure mode. Engineers who can do the work and cannot
 * explain it to a room stay in the queue.
 *
 * Three things make this a presentation tool rather than a list of headings.
 *
 * Speaker notes are first-class and visible while editing, because the notes
 * are where the thinking goes and a deck without them is a deck somebody reads
 * off the screen. The templates ship with theirs written.
 *
 * Present mode is full-bleed with arrow keys, so a learner can actually
 * rehearse rather than imagine it. Rehearsal is the point.
 *
 * And the deck exports to Markdown, so a readout can leave the machine and go
 * into a ticket, a wiki or an email — which is where a real readout ends up.
 *
 * Decks persist in localStorage. They are the learner's own working papers,
 * they should survive a reload, and nothing else needs to read them.
 */
import { DECK_TEMPLATES, DECK_TEMPLATE_BY_ID } from '@/config/slideTemplates';
import { FS } from '@/terminal/shellIntrinsics';
import { showToast } from '@/ui/toast';

const STORE_KEY = 'slides_decks';

interface Slide {
  title: string;
  bullets: string[];
  notes: string;
}

interface Deck {
  id: string;
  name: string;
  slides: Slide[];
  updatedAt: number;
}

function loadDecks(): Deck[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Deck[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // A corrupt store must not take the window down with it.
    return [];
  }
}

function saveDecks(decks: Deck[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(decks));
  } catch {
    /* private mode — the deck lasts this session, which is not fatal */
  }
}

/** The deck as Markdown, so a readout can leave the machine. */
export function deckToMarkdown(deck: Deck): string {
  const out: string[] = [`# ${deck.name}`, ''];
  deck.slides.forEach((slide, i) => {
    out.push(`## ${i + 1}. ${slide.title}`, '');
    for (const b of slide.bullets.filter((x) => x.trim() !== '')) out.push(`- ${b}`);
    if (slide.bullets.some((x) => x.trim() !== '')) out.push('');
    if (slide.notes.trim() !== '') {
      out.push(`> **Speaker notes.** ${slide.notes.trim()}`, '');
    }
  });
  return out.join('\n');
}

const STYLES = `
  .sl-root {
    display: flex; flex-direction: column; height: 100%; background: var(--panel);
    color: var(--fg); font-family: "Segoe UI", system-ui, sans-serif; font-size: 12.5px;
  }
  .sl-bar {
    flex-shrink: 0; display: flex; align-items: center; gap: 8px; padding: 8px 12px;
    background: var(--panel-alt); border-bottom: 1px solid var(--border); flex-wrap: wrap;
  }
  .sl-bar button, .sl-bar select {
    font-family: inherit; font-size: 11.5px; padding: 5px 11px; border-radius: 5px;
    cursor: pointer; background: var(--panel); color: var(--fg);
    border: 1px solid var(--border);
  }
  .sl-bar button.primary {
    background: var(--accent); color: var(--on-accent); border-color: var(--accent);
  }
  .sl-deck-name {
    font-weight: 650; font-size: 13px; background: transparent; border: 1px solid transparent;
    color: var(--fg); font-family: inherit; padding: 4px 6px; border-radius: 4px; min-width: 200px;
  }
  .sl-deck-name:focus { outline: none; border-color: var(--accent); background: var(--panel); }
  .sl-split { flex: 1 1 auto; min-height: 0; display: flex; }
  .sl-rail {
    flex: 0 0 190px; border-right: 1px solid var(--border); overflow: auto;
    background: var(--panel-alt); padding: 10px;
  }
  .sl-thumb {
    width: 100%; text-align: left; cursor: pointer; margin-bottom: 8px; padding: 9px 10px;
    border-radius: 6px; background: var(--panel); color: var(--fg);
    border: 1px solid var(--border); font-family: inherit; font-size: 11px; line-height: 1.4;
  }
  .sl-thumb.on { border-color: var(--accent); background: rgba(78,201,176,0.12); }
  .sl-thumb-n { color: var(--muted); font-size: 10px; }
  .sl-thumb-t { font-weight: 600; margin-top: 2px; overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap; }
  .sl-editor { flex: 1 1 auto; min-width: 0; overflow: auto; padding: 18px 22px; }
  .sl-label {
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted);
    font-weight: 600; margin: 0 0 6px;
  }
  .sl-title-input {
    width: 100%; box-sizing: border-box; font-size: 21px; font-weight: 650; padding: 8px 10px;
    border-radius: 6px; background: var(--panel-alt); color: var(--fg);
    border: 1px solid var(--border); font-family: inherit;
  }
  .sl-bullets, .sl-notes {
    width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 6px;
    background: var(--panel-alt); color: var(--fg); border: 1px solid var(--border);
    font-family: inherit; font-size: 13px; line-height: 1.7; resize: vertical;
  }
  .sl-bullets { min-height: 150px; }
  .sl-notes { min-height: 110px; color: var(--muted); }
  .sl-title-input:focus, .sl-bullets:focus, .sl-notes:focus {
    outline: none; border-color: var(--accent);
  }
  .sl-hint { color: var(--muted); font-size: 11px; margin: 5px 0 18px; line-height: 1.6; }
  .sl-empty { padding: 40px 24px; color: var(--muted); line-height: 1.8; max-width: 620px; }
  .sl-empty h3 { color: var(--fg); margin: 0 0 10px; font-size: 16px; }

  /* Present mode */
  .sl-present {
    position: fixed; inset: 0; z-index: 9000; display: flex; flex-direction: column;
    background: #0a0d12; color: #f2f4f7; padding: 6vh 8vw;
    font-family: "Segoe UI", system-ui, sans-serif;
  }
  .sl-present h1 { font-size: 3.2vw; margin: 0 0 4vh; line-height: 1.2; color: var(--accent); }
  .sl-present ul { font-size: 1.9vw; line-height: 2; margin: 0; padding-left: 1.4em; }
  .sl-present-foot {
    margin-top: auto; display: flex; justify-content: space-between; align-items: center;
    color: #7a8694; font-size: 0.95vw;
  }
  .sl-present-notes {
    margin-top: 3vh; padding-top: 2vh; border-top: 1px solid #232a33; color: #98a4b3;
    font-size: 1.05vw; line-height: 1.7; max-width: 60ch;
  }
`;

export function renderSlidesWindow(body: HTMLElement): void {
  if (!document.getElementById('slides-css')) {
    const style = document.createElement('style');
    style.id = 'slides-css';
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

  let decks = loadDecks();
  let deck: Deck | null = decks[0] ?? null;
  let index = 0;

  const root = document.createElement('div');
  root.className = 'sl-root';
  const bar = document.createElement('div');
  bar.className = 'sl-bar';
  const split = document.createElement('div');
  split.className = 'sl-split';
  const rail = document.createElement('div');
  rail.className = 'sl-rail';
  const editor = document.createElement('div');
  editor.className = 'sl-editor';
  split.append(rail, editor);
  root.append(bar, split);

  function persist(): void {
    if (deck) deck.updatedAt = Date.now();
    saveDecks(decks);
  }

  function button(label: string, primary: boolean, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    if (primary) b.className = 'primary';
    b.addEventListener('click', onClick);
    return b;
  }

  function newDeck(templateId: string): void {
    const template = DECK_TEMPLATE_BY_ID[templateId];
    const created: Deck = {
      id: `deck-${Date.now().toString(36)}`,
      name: template ? template.name : 'Untitled deck',
      slides: template
        ? template.slides.map((s) => ({ ...s, bullets: [...s.bullets] }))
        : [{ title: 'Title', bullets: [''], notes: '' }],
      updatedAt: Date.now(),
    };
    decks = [created, ...decks];
    deck = created;
    index = 0;
    persist();
    render();
  }

  // ---- Present mode ------------------------------------------------------

  /**
   * Full-bleed presentation with arrow keys.
   *
   * Rehearsal is the point of building this at all, so it has to be usable
   * rather than a preview: notes visible to the presenter, position visible,
   * Escape to get out.
   */
  function present(): void {
    if (!deck || deck.slides.length === 0) return;
    let at = index;

    const stage = document.createElement('div');
    stage.className = 'sl-present';

    const paint = (): void => {
      const slide = deck!.slides[at]!;
      stage.innerHTML = '';
      const h = document.createElement('h1');
      h.textContent = slide.title;
      stage.appendChild(h);

      const ul = document.createElement('ul');
      for (const b of slide.bullets.filter((x) => x.trim() !== '')) {
        const li = document.createElement('li');
        li.textContent = b;
        ul.appendChild(li);
      }
      stage.appendChild(ul);

      if (slide.notes.trim() !== '') {
        const notes = document.createElement('div');
        notes.className = 'sl-present-notes';
        notes.textContent = slide.notes;
        stage.appendChild(notes);
      }

      const foot = document.createElement('div');
      foot.className = 'sl-present-foot';
      const name = document.createElement('span');
      name.textContent = deck!.name;
      const pos = document.createElement('span');
      pos.textContent = `${at + 1} / ${deck!.slides.length}  ·  ← → to move  ·  Esc to exit`;
      foot.append(name, pos);
      stage.appendChild(foot);
    };

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
        e.preventDefault();
        at = Math.min(deck!.slides.length - 1, at + 1);
        paint();
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        at = Math.max(0, at - 1);
        paint();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };

    function close(): void {
      document.removeEventListener('keydown', onKey, true);
      stage.remove();
      // Leave the editor on whatever slide the rehearsal ended on.
      index = at;
      render();
    }

    // Capture phase: the desktop has its own shortcut handlers, and a
    // presentation that opens an app because somebody pressed a letter is not
    // a presentation.
    document.addEventListener('keydown', onKey, true);
    stage.addEventListener('click', () => {
      at = Math.min(deck!.slides.length - 1, at + 1);
      paint();
    });
    paint();
    document.body.appendChild(stage);
  }

  function exportMarkdown(): void {
    if (!deck) return;
    const md = deckToMarkdown(deck);
    const name = `${deck.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`;
    try {
      FS.writeFile(`C:\\Users\\admin\\Documents\\${name}`, md);
    } catch {
      /* the download below is the copy that matters */
    }
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported to Documents as ${name}.`, { kind: 'success' });
  }

  // ---- Views -------------------------------------------------------------

  function renderBar(): void {
    bar.innerHTML = '';

    const templateSelect = document.createElement('select');
    const head = document.createElement('option');
    head.textContent = 'New deck from template…';
    head.value = '';
    templateSelect.appendChild(head);
    for (const t of DECK_TEMPLATES) {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      opt.title = t.blurb;
      templateSelect.appendChild(opt);
    }
    templateSelect.addEventListener('change', () => {
      if (templateSelect.value) newDeck(templateSelect.value);
    });
    bar.appendChild(templateSelect);

    if (decks.length > 1) {
      const pick = document.createElement('select');
      for (const d of decks) {
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.textContent = d.name;
        pick.appendChild(opt);
      }
      if (deck) pick.value = deck.id;
      pick.addEventListener('change', () => {
        deck = decks.find((d) => d.id === pick.value) ?? null;
        index = 0;
        render();
      });
      bar.appendChild(pick);
    }

    if (!deck) return;

    const name = document.createElement('input');
    name.className = 'sl-deck-name';
    name.value = deck.name;
    name.addEventListener('input', () => {
      if (!deck) return;
      deck.name = name.value;
      persist();
    });
    bar.appendChild(name);

    bar.append(
      button('▶ Present', true, present),
      button('+ Slide', false, () => {
        if (!deck) return;
        deck.slides.splice(index + 1, 0, { title: 'New slide', bullets: [''], notes: '' });
        index += 1;
        persist();
        render();
      }),
      button('⬇ Markdown', false, exportMarkdown),
      button('Delete deck', false, () => {
        if (!deck) return;
        if (!window.confirm(`Delete "${deck.name}"?`)) return;
        decks = decks.filter((d) => d.id !== deck!.id);
        deck = decks[0] ?? null;
        index = 0;
        saveDecks(decks);
        render();
      }),
    );
  }

  function renderRail(): void {
    rail.innerHTML = '';
    if (!deck) return;
    deck.slides.forEach((slide, i) => {
      const b = document.createElement('button');
      b.className = 'sl-thumb' + (i === index ? ' on' : '');
      const n = document.createElement('div');
      n.className = 'sl-thumb-n';
      n.textContent = `Slide ${i + 1}`;
      const t = document.createElement('div');
      t.className = 'sl-thumb-t';
      t.textContent = slide.title || '(untitled)';
      b.append(n, t);
      b.addEventListener('click', () => {
        index = i;
        render();
      });
      rail.appendChild(b);
    });
  }

  function renderEditor(): void {
    editor.innerHTML = '';

    if (!deck) {
      const empty = document.createElement('div');
      empty.className = 'sl-empty';
      const h = document.createElement('h3');
      h.textContent = 'No deck open';
      const p = document.createElement('p');
      p.textContent =
        'Presenting is part of this job. The templates are the three readouts an identity ' +
        'engineer gives — a post-incident review, an access review result, and the case for ' +
        'replacing standing admin rights with eligibility. Each ships with its speaker notes ' +
        'written, because the notes are where the thinking goes.';
      empty.append(h, p);
      editor.appendChild(empty);
      return;
    }

    const slide = deck.slides[index];
    if (!slide) return;

    const titleLabel = document.createElement('p');
    titleLabel.className = 'sl-label';
    titleLabel.textContent = `Slide ${index + 1} of ${deck.slides.length} — title`;
    const title = document.createElement('input');
    title.className = 'sl-title-input';
    title.value = slide.title;
    title.addEventListener('input', () => {
      slide.title = title.value;
      persist();
      renderRail();
    });

    const bulletsLabel = document.createElement('p');
    bulletsLabel.className = 'sl-label';
    bulletsLabel.style.marginTop = '18px';
    bulletsLabel.textContent = 'Points — one per line';
    const bullets = document.createElement('textarea');
    bullets.className = 'sl-bullets';
    bullets.value = slide.bullets.join('\n');
    bullets.spellcheck = false;
    bullets.addEventListener('input', () => {
      slide.bullets = bullets.value.split('\n');
      persist();
    });

    const bulletHint = document.createElement('p');
    bulletHint.className = 'sl-hint';
    bulletHint.textContent =
      'Three or four points. A slide somebody has to read is a slide nobody listens to.';

    const notesLabel = document.createElement('p');
    notesLabel.className = 'sl-label';
    notesLabel.textContent = 'Speaker notes — only you see these';
    const notes = document.createElement('textarea');
    notes.className = 'sl-notes';
    notes.value = slide.notes;
    notes.addEventListener('input', () => {
      slide.notes = notes.value;
      persist();
    });

    const notesHint = document.createElement('p');
    notesHint.className = 'sl-hint';
    notesHint.textContent =
      'What you will actually say, and the answer to the question this slide invites.';

    const remove = button('Delete this slide', false, () => {
      if (!deck || deck.slides.length <= 1) {
        showToast('A deck needs at least one slide.', { kind: 'warn' });
        return;
      }
      deck.slides.splice(index, 1);
      index = Math.max(0, index - 1);
      persist();
      render();
    });
    remove.style.marginTop = '6px';

    editor.append(
      titleLabel, title,
      bulletsLabel, bullets, bulletHint,
      notesLabel, notes, notesHint,
      remove,
    );
  }

  function render(): void {
    renderBar();
    renderRail();
    renderEditor();
  }

  render();
  body.innerHTML = '';
  body.appendChild(root);
}
