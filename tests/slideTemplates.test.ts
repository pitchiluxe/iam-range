/**
 * tests/slideTemplates.test.ts — the decks have to be worth presenting.
 *
 * A presentation tool whose templates are three empty headings teaches
 * nothing. These are the three readouts an identity engineer actually gives,
 * and what makes them useful is the speaker notes: the notes are where the
 * thinking goes, and a deck without them is a deck somebody reads off the
 * screen.
 *
 * So the assertions are about substance rather than structure — every slide
 * carries notes, every deck carries the sections the room expects — plus the
 * Markdown export, which is how a readout leaves the machine and reaches a
 * ticket or a wiki.
 */
import { describe, it, expect } from 'vitest';
import { DECK_TEMPLATES, DECK_TEMPLATE_BY_ID } from '@/config/slideTemplates';
import { deckToMarkdown } from '@/ui/consoles/slidesWindow';

describe('the templates', () => {
  it('covers the three readouts this role gives', () => {
    expect(DECK_TEMPLATES.map((t) => t.id).sort()).toEqual([
      'access-review',
      'post-incident',
      'privileged-access',
    ]);
  });

  it('gives every slide speaker notes', () => {
    // The notes are the whole value. A template without them is an outline.
    for (const template of DECK_TEMPLATES) {
      for (const slide of template.slides) {
        expect(slide.notes.length, `${template.id} / ${slide.title}`).toBeGreaterThan(60);
      }
    }
  });

  it('keeps slides short enough to be listened to', () => {
    // A slide somebody has to read is a slide nobody listens to.
    for (const template of DECK_TEMPLATES) {
      for (const slide of template.slides) {
        expect(slide.bullets.length, `${template.id} / ${slide.title}`).toBeLessThanOrEqual(4);
        expect(slide.bullets.length).toBeGreaterThan(0);
      }
    }
  });

  it('ends the post-incident deck on what changes, with owners', () => {
    // A review that stops at the root cause changes nothing.
    const deck = DECK_TEMPLATE_BY_ID['post-incident']!;
    const last = deck.slides[deck.slides.length - 1]!;
    expect(last.title).toMatch(/changes/i);
    expect(last.bullets.join(' ')).toMatch(/[Oo]wner/);
  });

  it('makes the access review deck distinguish deciding from completing', () => {
    // The gap between the two is where real campaigns fail to remove access.
    const deck = DECK_TEMPLATE_BY_ID['access-review']!;
    const text = deck.slides.flatMap((s) => [s.notes, ...s.bullets]).join(' ');
    expect(text).toMatch(/complet/i);
  });

  it('has every deck reachable by id', () => {
    for (const t of DECK_TEMPLATES) expect(DECK_TEMPLATE_BY_ID[t.id]).toBe(t);
  });
});

describe('exporting to Markdown', () => {
  const deck = {
    id: 'd1',
    name: 'Post-incident review',
    updatedAt: 0,
    slides: [
      { title: 'What happened', bullets: ['Locked out', 'Two hours'], notes: 'Lead with impact.' },
      { title: 'Empty', bullets: [''], notes: '' },
    ],
  };

  it('numbers the slides and keeps the deck name as the heading', () => {
    const md = deckToMarkdown(deck);
    expect(md).toContain('# Post-incident review');
    expect(md).toContain('## 1. What happened');
    expect(md).toContain('## 2. Empty');
  });

  it('writes the points as a list', () => {
    expect(deckToMarkdown(deck)).toContain('- Locked out');
  });

  it('carries the speaker notes, which is why the export is worth having', () => {
    expect(deckToMarkdown(deck)).toContain('**Speaker notes.** Lead with impact.');
  });

  it('does not emit an empty bullet or an empty note', () => {
    // Blank lines in an export become blank bullets in a ticket.
    const md = deckToMarkdown(deck);
    expect(md).not.toMatch(/^- $/m);
    expect(md.match(/Speaker notes/g) ?? []).toHaveLength(1);
  });
});
