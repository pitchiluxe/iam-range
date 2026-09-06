/**
 * ui/consoles/documentationWindow.ts — the offline IAM/PIM reference.
 *
 * Two audiences. A learner reads it directly, by topic or by search. The tutor
 * cites it, and clicking a citation lands here on that article — which is the
 * whole reason the tutor's answers are worth trusting: a claim you can open and
 * read is a claim you can reject.
 *
 * Entirely offline. Nothing here fetches, so the reference works on a
 * disconnected machine and cannot rot behind a dead link.
 */
import { ARTICLES, articleById, searchArticles, type Article } from '@/config/knowledgeBase';
import { requestApp } from '@/util/appLauncher';

const TOPIC_LABEL: Record<Article['topic'], string> = {
  directory: 'Directory & structure',
  lifecycle: 'Joiner / Mover / Leaver',
  access: 'Access & entitlement',
  privileged: 'Privileged access (PIM)',
  authentication: 'Authentication & SSO',
  operations: 'Operations & evidence',
};

const TOPIC_ORDER: Article['topic'][] = [
  'directory',
  'lifecycle',
  'access',
  'privileged',
  'authentication',
  'operations',
];

/**
 * The article a fresh window should land on.
 *
 * Module-level because the request ("show me ou-design") and the window that
 * serves it are separated by an event round trip through the overlay. An
 * already-open window is navigated directly instead, via `live` below.
 */
let pendingArticleId: string | null = null;
/** The live window, if there is one. Held with its root so we can tell a window
 *  that is still on screen from one whose closure merely outlived it. */
let live: { root: HTMLElement; select: (id: string) => void } | null = null;

/** Open Documentation at a given article. Called by the tutor's citations. */
export function openDocumentation(articleId: string): void {
  // A closed window leaves its closure behind. Calling it would navigate a
  // detached DOM and leave the reopened window on the wrong article, so the
  // root's connectedness — not the closure's existence — decides.
  if (live?.root.isConnected) {
    live.select(articleId);
    requestApp('documentation'); // already open — bring it to the front
    return;
  }
  live = null;
  pendingArticleId = articleId;
  requestApp('documentation');
}

export function renderDocumentationWindow(body: HTMLElement): void {
  body.style.cssText =
    'display:flex;height:100%;background:#0e1116;font-family:"Segoe UI",system-ui,sans-serif;' +
    'color:#e6e6e6;';

  // --- Sidebar: search + contents ------------------------------------------
  const side = document.createElement('div');
  side.style.cssText =
    'flex-shrink:0;width:260px;background:#161b22;border-right:1px solid #2d343d;' +
    'display:flex;flex-direction:column;';

  const searchWrap = document.createElement('div');
  searchWrap.style.cssText = 'padding:10px;border-bottom:1px solid #2d343d;';
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = 'Search the reference…';
  search.style.cssText =
    'width:100%;box-sizing:border-box;padding:7px 9px;border-radius:4px;border:1px solid #2d343d;' +
    'background:#0e1116;color:#e6e6e6;font-size:12px;outline:none;';
  searchWrap.appendChild(search);
  side.appendChild(searchWrap);

  const contents = document.createElement('div');
  contents.style.cssText = 'flex:1;overflow-y:auto;padding:6px 0;';
  side.appendChild(contents);

  // --- Reading pane ---------------------------------------------------------
  const pane = document.createElement('div');
  pane.style.cssText = 'flex:1;overflow-y:auto;padding:22px 28px;min-width:0;';

  body.append(side, pane);

  let currentId: string | null = null;

  function entry(a: Article): HTMLElement {
    const btn = document.createElement('button');
    btn.textContent = a.title;
    btn.dataset.articleId = a.id;
    btn.style.cssText =
      'display:block;width:100%;text-align:left;padding:6px 12px;border:none;cursor:pointer;' +
      'font-size:11.5px;line-height:1.4;background:transparent;color:#c9d1d9;';
    btn.onclick = () => select(a.id);
    return btn;
  }

  /** Contents grouped by topic, or a flat result list while searching. */
  function paintContents(query: string): void {
    contents.innerHTML = '';

    if (query.trim()) {
      const hits = searchArticles(query, 20);
      if (hits.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'padding:12px;font-size:11.5px;color:#8b95a1;';
        empty.textContent = 'No article matches that.';
        contents.appendChild(empty);
        return;
      }
      for (const a of hits) contents.appendChild(entry(a));
      paintSelection();
      return;
    }

    for (const topic of TOPIC_ORDER) {
      const inTopic = ARTICLES.filter((a) => a.topic === topic);
      if (inTopic.length === 0) continue;
      const head = document.createElement('div');
      head.textContent = TOPIC_LABEL[topic];
      head.style.cssText =
        'padding:10px 12px 4px;font-size:10px;letter-spacing:.06em;text-transform:uppercase;' +
        'color:#6b7482;';
      contents.appendChild(head);
      for (const a of inTopic) contents.appendChild(entry(a));
    }
    paintSelection();
  }

  function paintSelection(): void {
    for (const el of Array.from(contents.querySelectorAll<HTMLElement>('[data-article-id]'))) {
      const on = el.dataset.articleId === currentId;
      el.style.background = on ? '#2563eb' : 'transparent';
      el.style.color = on ? '#fff' : '#c9d1d9';
    }
  }

  /**
   * Render an article.
   *
   * The bodies are written as light markdown — `**bold**` leads, indented
   * blocks for the OU tree. Rendering it inline avoids pulling a markdown
   * dependency into a window that shows thirteen static documents.
   */
  function select(id: string): void {
    const a = articleById(id);
    if (!a) return;
    currentId = id;
    paintSelection();

    pane.innerHTML = '';
    pane.scrollTop = 0;

    const topic = document.createElement('div');
    topic.textContent = TOPIC_LABEL[a.topic];
    topic.style.cssText =
      'font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#4ec9b0;margin-bottom:6px;';

    const h = document.createElement('h1');
    h.textContent = a.title;
    h.style.cssText = 'margin:0 0 4px;font-size:20px;font-weight:600;';

    const sub = document.createElement('div');
    sub.textContent = a.summary;
    sub.style.cssText = 'font-size:12.5px;color:#8b95a1;margin-bottom:18px;';

    pane.append(topic, h, sub);

    for (const block of a.body.split(/\n\s*\n/)) {
      const el = document.createElement(block.startsWith('    ') ? 'pre' : 'p');
      el.style.cssText =
        block.startsWith('    ')
          ? 'background:#161b22;border:1px solid #2d343d;border-radius:4px;padding:12px 14px;' +
            'font-family:Consolas,Monaco,monospace;font-size:11.5px;line-height:1.5;' +
            'overflow-x:auto;color:#c9d1d9;'
          : 'font-size:13px;line-height:1.75;margin:0 0 14px;max-width:70ch;color:#d7dde4;';

      if (block.startsWith('    ')) {
        el.textContent = block.replace(/^ {4}/gm, '');
      } else {
        // **bold** → <strong>, with the text escaped by construction because
        // every fragment goes in as a text node.
        for (const [i, part] of block.replace(/\n/g, ' ').split(/\*\*/).entries()) {
          if (i % 2 === 1) {
            const s = document.createElement('strong');
            s.textContent = part;
            s.style.color = '#fff';
            el.appendChild(s);
          } else {
            el.appendChild(document.createTextNode(part));
          }
        }
      }
      pane.appendChild(el);
    }
  }

  search.oninput = () => paintContents(search.value);
  paintContents('');

  // A citation click that arrived before this window existed.
  const landing = pendingArticleId ?? ARTICLES[0]?.id;
  pendingArticleId = null;
  if (landing) select(landing);

  // Stay reachable while open, so a later citation re-navigates rather than
  // needing the window closed and reopened.
  live = { root: body, select };
}
