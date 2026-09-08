/**
 * tests/textEntry.test.ts — the workstation must always accept typing.
 *
 * Two defects, found by driving the running application, both presenting to
 * the learner as "this text box does not work":
 *
 *   1. The Screen Pen lays a full-screen canvas over the desktop at z-index
 *      8000. In drawing mode that canvas takes every click, so no text box
 *      below it can ever receive focus -- Active Directory's dialogs, the
 *      interview drill's answer box, the ticket search, all of them. Nothing
 *      on screen says so: the fields render normally because they are simply
 *      underneath. The only way out was a small toolbar chip somebody who had
 *      forgotten about the pen would never connect to the symptom.
 *
 *   2. The Ticket Queue registers a capture-phase keydown handler on the
 *      document for its single-letter shortcuts (r resolves, f searches, a
 *      assigns, 1-9 jump). It exempted INPUT, TEXTAREA and SELECT but not
 *      contenteditable, so with the queue open -- which is most of the time,
 *      since tickets drive the labs -- every `r` and `f` typed into Writer or
 *      a sticky note was swallowed and silently resolved a ticket instead.
 *      Verified in the browser: a keydown for `r` dispatched at the Writer
 *      editor came back with defaultPrevented === true.
 *
 * The shared guard exists so a third console cannot reintroduce (2) by
 * hand-rolling the same tagName test and forgetting the same case.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isTypingTarget, isTypingEvent } from '@/util/typing';

const src = (...parts: string[]): string =>
  readFileSync(join(process.cwd(), 'src', ...parts), 'utf8');

/** Minimal stand-ins: the guard is deliberately duck-typed so it is testable
 *  without a DOM, and so it survives an element from another document. */
const el = (tagName: string, contentEditable = false): unknown => ({
  tagName,
  isContentEditable: contentEditable,
});

describe('isTypingTarget', () => {
  it('recognises the form controls that own their keystrokes', () => {
    expect(isTypingTarget(el('INPUT'))).toBe(true);
    expect(isTypingTarget(el('TEXTAREA'))).toBe(true);
    expect(isTypingTarget(el('SELECT'))).toBe(true);
  });

  it('recognises contenteditable, which is the case that was missed', () => {
    // Writer's editor and the sticky notes are DIVs, not INPUTs.
    expect(isTypingTarget(el('DIV', true))).toBe(true);
  });

  it('leaves ordinary elements alone, so shortcuts still work', () => {
    expect(isTypingTarget(el('DIV'))).toBe(false);
    expect(isTypingTarget(el('BUTTON'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(undefined)).toBe(false);
  });

  it('is case-insensitive about the tag name', () => {
    expect(isTypingTarget(el('input'))).toBe(true);
  });

  it('reads an event through composedPath when there is one', () => {
    const target = el('DIV');
    const inner = el('TEXTAREA');
    expect(isTypingEvent({ target, composedPath: () => [inner, target] })).toBe(true);
    expect(isTypingEvent({ target: inner })).toBe(true);
    expect(isTypingEvent({ target })).toBe(false);
  });
});

describe('global keyboard shortcuts defer to the focused field', () => {
  /** Consoles that put a keydown handler on the document rather than on their
   *  own element, and so can reach a field in another window. */
  const GLOBAL_SHORTCUT_CONSOLES = ['ticketConsole', 'calculatorWindow'];

  for (const name of GLOBAL_SHORTCUT_CONSOLES) {
    it(`${name} uses the shared guard`, () => {
      const code = src('ui', 'consoles', `${name}.ts`);
      expect(code).toMatch(/isTypingEvent|isTypingTarget/);
    });

    it(`${name} does not hand-roll the tagName test`, () => {
      const code = src('ui', 'consoles', `${name}.ts`);
      // The hand-rolled version is what missed contenteditable.
      expect(code).not.toMatch(/tagName\s*===\s*'INPUT'/);
      expect(code).not.toMatch(/\^\(INPUT\|TEXTAREA\|SELECT\)\$/);
    });
  }
});

describe('the Screen Pen can always be got off the screen', () => {
  const code = src('ui', 'desktopAnnotator.ts');

  it('opens in click-through, not drawing', () => {
    // Drawing mode blocks every application underneath it.
    expect(code).toMatch(/let drawMode = false/);
  });

  it('leaves drawing mode on Escape', () => {
    // The banner promises this; before the fix nothing implemented it.
    expect(code).toMatch(/key !== 'Escape'/);
    expect(code).toMatch(/setMode\(false\)/);
  });

  it('takes its Escape handler with it when it closes', () => {
    // A document-level listener outliving its overlay is the next bug.
    expect(code).toMatch(/removeEventListener\('keydown', onEscape/);
  });

  it('says on screen that clicks are going to the pen', () => {
    expect(code).toMatch(/Esc/);
  });
});

describe('Active Directory dialogs are ready to be typed into', () => {
  const code = src('ui', 'consoles', 'activeDirectoryWindow.ts');

  it('focuses the first field when the dialog opens', () => {
    // Every text box in Active Directory lives in one of these dialogs, and
    // none of them placed the caret. The dialog opened looking ready and was
    // not, which is indistinguishable from a field that refuses input.
    expect(code).toMatch(/focusFirstField|\.focus\(\)/);
  });

  it('accepts Enter for OK and Escape for Cancel', () => {
    expect(code).toMatch(/key === 'Enter'/);
    expect(code).toMatch(/key === 'Escape'/);
  });
});
