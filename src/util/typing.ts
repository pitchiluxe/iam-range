/**
 * util/typing.ts — is the keystroke already spoken for?
 *
 * Several windows register their single-letter shortcuts on the document
 * rather than on their own element, because a shortcut that only works while
 * the mouse is over the right pane is not a shortcut. The cost is that those
 * handlers see every keystroke in the workstation, including the ones somebody
 * is typing into a completely different window.
 *
 * Each one grew its own guard, and they drifted. The Ticket Queue tested
 * `tagName === 'INPUT' | 'TEXTAREA' | 'SELECT'`, which is right up until the
 * field is a contenteditable -- Writer's editor and the sticky notes both are.
 * With the queue open, every `r` typed into a document was swallowed and
 * quietly resolved a ticket instead. The learner sees a text box that will not
 * take some letters, which reads as the application being broken.
 *
 * One guard, so a new console cannot rediscover the same omission.
 *
 * Deliberately duck-typed rather than `instanceof HTMLElement`: the check then
 * works on an element from another document, and is testable without a DOM.
 *
 * Every INPUT counts as typing, including checkboxes and ranges. A shortcut is
 * worth less than the risk of stealing Space from a focused checkbox, and the
 * rule is easier to keep correct than a list of text-like input types.
 */

/** The shape this module needs from an event target. */
interface MaybeElement {
  tagName?: unknown;
  isContentEditable?: unknown;
}

/** The shape this module needs from an event. */
interface MaybeEvent {
  target?: unknown;
  composedPath?: () => unknown[];
}

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * Does this element own the keystrokes aimed at it?
 *
 * True for the form controls and for anything contenteditable, which is the
 * case the hand-rolled guards missed.
 */
export function isTypingTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as MaybeElement;
  if (el.isContentEditable === true) return true;
  return typeof el.tagName === 'string' && TYPING_TAGS.has(el.tagName.toUpperCase());
}

/**
 * The same question, asked of an event.
 *
 * Prefers `composedPath()[0]` over `target`: an event crossing a shadow
 * boundary retargets to the host, and the field inside it is the thing that is
 * actually being typed into. Falls back to `target` when there is no path,
 * which is every event in this application today — the preference is there so
 * a component that grows a shadow root does not silently reintroduce the bug.
 */
export function isTypingEvent(event: unknown): boolean {
  if (!event || typeof event !== 'object') return false;
  const e = event as MaybeEvent;
  if (typeof e.composedPath === 'function') {
    const first = e.composedPath()[0];
    if (first !== undefined && isTypingTarget(first)) return true;
  }
  return isTypingTarget(e.target);
}
