/**
 * ui/markdown.ts — render an instructor's reply as formatted text, safely.
 *
 * The text comes from a language model, so it is untrusted: nothing here
 * ever assigns it to innerHTML. Every piece becomes a DOM node whose content
 * is set with textContent, which makes markup in the reply inert — a model
 * that writes <script> produces the literal characters "<script>".
 *
 * Supported, because it is what instructor replies actually use:
 *   # headings, **bold**, *italic*, `code`, ``` fenced blocks ```,
 *   - / * / • bullet lists, 1. numbered lists, > quotes, | tables |,
 *   and [Critical]/[High]/[Medium]/[Low] severity badges.
 * Links render as their text followed by the URL in brackets; they are not
 * clickable, so a reply cannot send the learner anywhere.
 */

export const MARKDOWN_CSS = `
.md{line-height:1.55;font-size:12.4px;}
.md>*:first-child{margin-top:0;}
.md>*:last-child{margin-bottom:0;}
.md p{margin:0 0 7px;}
.md h1,.md h2,.md h3,.md h4{margin:10px 0 5px;font-weight:650;line-height:1.3;}
.md h1{font-size:14.5px;}.md h2{font-size:13.5px;}.md h3,.md h4{font-size:12.8px;}
.md ul,.md ol{margin:0 0 7px;padding-left:20px;}
.md li{margin:2px 0;}
.md blockquote{margin:0 0 7px;padding:4px 10px;border-left:3px solid var(--border);color:var(--muted);}
.md code{font-family:Consolas,'Cascadia Mono',monospace;font-size:11.5px;padding:1px 4px;border-radius:3px;background:rgba(127,127,127,.18);}
.md pre{margin:0 0 8px;padding:8px 10px;border-radius:5px;background:#0c0c0c;color:#e5e5e5;overflow:auto;}
.md pre code{padding:0;background:none;font-size:11.5px;white-space:pre;}
.md table{border-collapse:collapse;margin:0 0 8px;font-size:11.8px;}
.md th,.md td{border:1px solid var(--border);padding:3px 7px;text-align:left;vertical-align:top;}
.md th{background:rgba(127,127,127,.12);}
.md hr{border:none;border-top:1px solid var(--border);margin:8px 0;}
.md .sev{display:inline-block;padding:0 6px;border-radius:9px;font-size:10.5px;font-weight:700;color:#fff;}
.md .sev-Critical{background:#dc2626;}.md .sev-High{background:#ea580c;}.md .sev-Medium{background:#ca8a04;}.md .sev-Low{background:#2563eb;}
`;

/** Add the stylesheet once per document. */
export function ensureMarkdownStyles(): void {
  if (typeof document === 'undefined' || document.getElementById('md-css')) return;
  const style = document.createElement('style');
  style.id = 'md-css';
  style.textContent = MARKDOWN_CSS;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------

// Underscore emphasis only counts at word boundaries (as in CommonMark):
// identity names are full of underscores — Enterprise_Root, Tier0_Admins,
// Default_Enterprise_Password_Policy — and must survive intact.
const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*|(?<![A-Za-z0-9])__[^_\n]+__(?![A-Za-z0-9]))|(\*[^*\s][^*\n]*\*|(?<![A-Za-z0-9])_[^_\s][^_\n]*?_(?![A-Za-z0-9]))|(\[(Critical|High|Medium|Low)\])|(\[[^\]\n]+\]\([^)\s]+\))/;

function appendInline(parent: Node, text: string): void {
  let rest = text;
  while (rest) {
    const m = INLINE.exec(rest);
    if (!m) {
      parent.appendChild(document.createTextNode(rest));
      return;
    }
    if (m.index > 0) parent.appendChild(document.createTextNode(rest.slice(0, m.index)));
    const tok = m[0];
    if (m[1]) {
      const c = document.createElement('code');
      c.textContent = tok.slice(1, -1);
      parent.appendChild(c);
    } else if (m[2]) {
      const b = document.createElement('strong');
      appendInline(b, tok.slice(2, -2));
      parent.appendChild(b);
    } else if (m[3]) {
      const i = document.createElement('em');
      appendInline(i, tok.slice(1, -1));
      parent.appendChild(i);
    } else if (m[4]) {
      const s = document.createElement('span');
      s.className = `sev sev-${m[5]}`;
      s.textContent = m[5]!;
      parent.appendChild(s);
    } else if (m[6]) {
      const lm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok)!;
      parent.appendChild(document.createTextNode(`${lm[1]} (${lm[2]})`));
    }
    rest = rest.slice(m.index + tok.length);
  }
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

const BULLET = /^\s*([-*•])\s+(.*)$/;
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/;
const HEADING = /^(#{1,4})\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

/** Render `text` into a new element with class "md". */
export function renderMarkdown(text: string): HTMLElement {
  ensureMarkdownStyles();
  const root = document.createElement('div');
  root.className = 'md';
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  let para: string[] = [];

  const flushPara = (): void => {
    if (!para.length) return;
    const p = document.createElement('p');
    para.forEach((l, k) => {
      if (k > 0) p.appendChild(document.createElement('br'));
      appendInline(p, l);
    });
    root.appendChild(p);
    para = [];
  };

  while (i < lines.length) {
    const line = lines[i]!;

    // Fenced code block (an unterminated fence — mid-stream — runs to the end).
    if (/^\s*```/.test(line)) {
      flushPara();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i]!)) code.push(lines[i++]!);
      i++;
      const pre = document.createElement('pre');
      const c = document.createElement('code');
      c.textContent = code.join('\n');
      pre.appendChild(c);
      root.appendChild(pre);
      continue;
    }

    if (!line.trim()) {
      flushPara();
      i++;
      continue;
    }

    const h = HEADING.exec(line);
    if (h) {
      flushPara();
      const el = document.createElement(`h${Math.min(4, h[1]!.length)}`);
      appendInline(el, h[2]!);
      root.appendChild(el);
      i++;
      continue;
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushPara();
      root.appendChild(document.createElement('hr'));
      i++;
      continue;
    }

    // Table: a header row followed by a separator row.
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]!)) {
      flushPara();
      const table = document.createElement('table');
      const head = document.createElement('tr');
      for (const cell of splitRow(line)) {
        const th = document.createElement('th');
        appendInline(th, cell);
        head.appendChild(th);
      }
      table.appendChild(head);
      i += 2;
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim()) {
        const tr = document.createElement('tr');
        for (const cell of splitRow(lines[i]!)) {
          const td = document.createElement('td');
          appendInline(td, cell);
          tr.appendChild(td);
        }
        table.appendChild(tr);
        i++;
      }
      root.appendChild(table);
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      flushPara();
      const q = document.createElement('blockquote');
      const quoted: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i]!)) quoted.push(lines[i++]!.replace(/^\s*>\s?/, ''));
      appendInline(q, quoted.join(' '));
      root.appendChild(q);
      continue;
    }

    const isBullet = BULLET.test(line);
    const isNumber = NUMBERED.test(line);
    if (isBullet || isNumber) {
      flushPara();
      const list = document.createElement(isBullet ? 'ul' : 'ol');
      if (isNumber) list.setAttribute('start', NUMBERED.exec(line)![1]!);
      const pattern = isBullet ? BULLET : NUMBERED;
      let last: HTMLLIElement | null = null;
      while (i < lines.length) {
        const cur = lines[i]!;
        const m = pattern.exec(cur);
        if (m) {
          last = document.createElement('li');
          appendInline(last, m[2]!);
          list.appendChild(last);
          i++;
        } else if (last && /^\s{2,}\S/.test(cur)) {
          // Indented continuation line ("   Control: …") belongs to the item.
          last.appendChild(document.createElement('br'));
          appendInline(last, cur.trim());
          i++;
        } else break;
      }
      root.appendChild(list);
      continue;
    }

    para.push(line);
    i++;
  }
  flushPara();
  return root;
}
