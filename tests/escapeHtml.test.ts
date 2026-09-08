/**
 * tests/escapeHtml.test.ts — ticket text is text, not markup.
 *
 * The Ticket Console assembles its cards with innerHTML and interpolated three
 * fields it does not author: the subject, the body and every comment. The
 * first two are rewritten by Ollama whenever a model is running; the third is
 * typed by the learner.
 *
 * The mild version is a rendering fault — a model writing "use <logon>@..."
 * loses half the instruction into a tag that never closes, and the learner
 * reads a ticket with a hole in it. The serious version is that in the
 * packaged application this console runs in the workstation's own document,
 * which is the single origin permitted to reach window.electron.invoke, so
 * markup that came out of a model is parsed inside the privileged page.
 *
 * The second describe block is a source guard. It is the one that will catch
 * the next person adding a field to a card, because the escaping is easy to
 * leave off and nothing else notices.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { escapeHtml } from '@/util/escapeHtml';

const CONSOLE = readFileSync(
  join(process.cwd(), 'src', 'ui', 'consoles', 'ticketConsole.ts'),
  'utf8',
);

describe('escaping', () => {
  it('neutralises a script tag', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  it('escapes the ampersand once, not twice', () => {
    // A two-pass replace turns < into &lt; and then that & into &amp;lt;, so
    // the card shows the escape sequence instead of the character.
    expect(escapeHtml('R&D <team>')).toBe('R&amp;D &lt;team&gt;');
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
  });

  it('escapes quotes, which is what breaks out of an attribute', () => {
    expect(escapeHtml('" onmouseover="x')).toBe('&quot; onmouseover=&quot;x');
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('leaves ordinary ticket wording alone', () => {
    const body = 'Create the account jdoe, set a password, and place them in Corp/Users.';
    expect(escapeHtml(body)).toBe(body);
  });

  it('keeps the emoji and accents the tickets actually contain', () => {
    expect(escapeHtml('⏱️ Café — naïve')).toBe('⏱️ Café — naïve');
  });

  it('renders an absent field as empty rather than throwing', () => {
    // assigneeId is optional, and a card that throws while rendering takes
    // the whole queue down with it.
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(null)).toBe('');
  });
});

describe('the console does not interpolate untrusted text raw', () => {
  /**
   * Interpolations that reach markup, and only those.
   *
   * Scoped to innerHTML assignments on purpose. The same fields are also
   * interpolated into toasts and into textContent elsewhere in the file, and
   * both of those are assignments of text — escaping there would show the
   * learner `&lt;` instead of `<`, which is its own small bug. What matters is
   * the string that gets parsed as HTML.
   */
  const markupBlocks = CONSOLE.match(/\.innerHTML\s*(?:\+)?=[\s\S]*?;$/gm) ?? [];
  const interpolations = markupBlocks.flatMap((b) => b.match(/\$\{[^}]*\}/g) ?? []);

  it('found the markup it is supposed to be checking', () => {
    // A guard on an empty list passes by not looking, which is the failure
    // mode this whole file is about.
    expect(markupBlocks.length).toBeGreaterThan(3);
    expect(interpolations.length).toBeGreaterThan(5);
  });

  const untrusted = [
    { field: 't.subject', why: 'rewritten by the model' },
    { field: 't.body', why: 'rewritten by the model' },
    { field: 'c.body', why: 'typed by the learner' },
    { field: 'c.authorId', why: 'carried from the ticket' },
    { field: 't.assigneeId', why: 'carried from the ticket' },
  ];

  for (const { field, why } of untrusted) {
    it(`escapes ${field}, which is ${why}`, () => {
      const raw = interpolations.filter(
        (i) => i.includes(field) && !i.includes('escapeHtml'),
      );
      expect(raw, `${field} reaches innerHTML unescaped`).toEqual([]);
    });
  }

  it('imports the helper it uses', () => {
    expect(CONSOLE).toContain("from '@/util/escapeHtml'");
  });
});

describe('the Active Directory console', () => {
  it('builds its rows with textContent, so it never had this problem', () => {
    // Recorded because it is the better pattern and worth not regressing:
    // every value in the snap-in is assigned, never concatenated into markup.
    const ad = readFileSync(
      join(process.cwd(), 'src', 'ui', 'consoles', 'activeDirectoryWindow.ts'),
      'utf8',
    );
    const assignments = ad.match(/\.innerHTML\s*=\s*[^;]+/g) ?? [];
    // The only innerHTML writes are the empty string, used to clear a pane.
    for (const a of assignments) expect(a).toMatch(/innerHTML\s*=\s*''/);
  });
});
