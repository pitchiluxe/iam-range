/**
 * util/escapeHtml.ts — text that is going into markup is still text.
 *
 * The Ticket Console builds its cards with innerHTML and interpolated the
 * ticket's subject, its body and every comment straight into the template.
 * None of those three are the application's own strings:
 *
 *   - the subject and body are rewritten by Ollama whenever a model is
 *     running, and a model writes whatever it writes. It does not need to be
 *     malicious to break the card: "use <logon>@iamlab.com" or a stray <br>
 *     is enough for part of the ticket to vanish into a tag that never
 *     closes, and the learner is left reading an instruction with a hole in
 *     it;
 *   - comments are typed by the learner, and a password or a filter expression
 *     with a `<` in it is ordinary content in an IAM lab.
 *
 * In the packaged application this is more than a rendering fault. The console
 * runs in the workstation's own document, which is the one origin allowed to
 * reach window.electron.invoke — so markup that arrives from a model and is
 * parsed as markup is running inside the privileged page. Escaping is the fix
 * that holds regardless of what produced the string.
 *
 * The Active Directory console needs none of this: it builds every row with
 * textContent, which cannot have this problem in the first place. That is the
 * better pattern, and where markup is being assembled by hand this is the
 * minimum.
 */

const REPLACEMENTS: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Render a value as HTML-safe text.
 *
 * `&` is replaced first by virtue of being in the same pass — a two-step
 * replace would turn `<` into `&lt;` and then that `&` into `&amp;lt;`.
 *
 * Non-strings are coerced rather than refused: these come out of a data model
 * where a field can be absent, and `undefined` printed in a card is a smaller
 * problem than a card that throws while rendering.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => REPLACEMENTS[ch] ?? ch);
}
