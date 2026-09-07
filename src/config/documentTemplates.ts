/**
 * config/documentTemplates.ts — the documents an identity engineer writes.
 *
 * Writing things up is not clerical overhead in this job; it is a graded part
 * of it. An incident nobody wrote up cannot be reviewed, an access review with
 * no record did not happen, and "walk me through how you documented that" is a
 * real interview question. The scoring rubric this project implements gives
 * documentation and evidence fifteen points each.
 *
 * So Writer ships with the actual forms rather than a blank page. Each one is
 * shaped like the deliverable it names, with the prompts that stop a write-up
 * being useless — what the evidence was, what the timeline was, what changed,
 * and what would stop it happening again.
 */

export interface DocumentTemplate {
  id: string;
  title: string;
  /** One line, shown in the New Document dialog. */
  description: string;
  /** Starting content, as HTML. */
  body: string;
}

const h = (text: string): string => `<h2>${text}</h2>`;
const p = (text: string): string => `<p>${text}</p>`;
const hint = (text: string): string =>
  `<p><em style="color:#8b95a1;">${text}</em></p>`;

export const DOCUMENT_TEMPLATES: readonly DocumentTemplate[] = [
  {
    id: 'blank',
    title: 'Blank document',
    description: 'Start from nothing.',
    body: '<p><br></p>',
  },
  {
    id: 'incident',
    title: 'Incident report',
    description: 'Timeline, evidence, impact and remediation for a security incident.',
    body: [
      '<h1>Incident report</h1>',
      p('<strong>Reference:</strong> INC-____ &nbsp;·&nbsp; <strong>Severity:</strong> ____ &nbsp;·&nbsp; <strong>Author:</strong> ____'),
      h('Summary'),
      hint('Two or three sentences. What happened, to whom, and is it over?'),
      p('<br>'),
      h('Timeline'),
      hint('Times in one zone, stated. Detection is an event; so is every action you took.'),
      '<ul><li>__:__ &nbsp;—&nbsp; </li><li>__:__ &nbsp;—&nbsp; </li><li>__:__ &nbsp;—&nbsp; </li></ul>',
      h('Evidence'),
      hint(
        'Audit entries, sign-in records, before-and-after state. An assertion with no ' +
          'entry behind it is an opinion.',
      ),
      p('<br>'),
      h('Impact'),
      hint('Which accounts, which data, which systems. Say plainly if the answer is none.'),
      p('<br>'),
      h('Root cause'),
      hint('The cause, not the symptom. If you do not know yet, write that instead of guessing.'),
      p('<br>'),
      h('Remediation'),
      hint('What you changed to stop it, and what you would change to stop it recurring.'),
      p('<br>'),
    ].join(''),
  },
  {
    id: 'access-review',
    title: 'Access review summary',
    description: 'Scope, findings and decisions from a review campaign.',
    body: [
      '<h1>Access review summary</h1>',
      p('<strong>Campaign:</strong> ____ &nbsp;·&nbsp; <strong>Period:</strong> ____ &nbsp;·&nbsp; <strong>Reviewer:</strong> ____'),
      h('Scope'),
      hint('Which group, application or set of privileged roles, and how many entries.'),
      p('<br>'),
      h('Findings'),
      hint(
        'Dormant accounts, standing privilege, people whose department changed but whose ' +
          'groups did not, service accounts nobody claims, and access granted directly to ' +
          'individuals rather than through a group.',
      ),
      '<ul><li></li><li></li></ul>',
      h('Decisions'),
      hint('Keep or remove, per entry, with the reason. "Approved all" is not a decision.'),
      p('<br>'),
      h('Actions taken'),
      hint(
        'Removal has to actually happen. A review whose decisions are recorded and never ' +
          'applied finds the same rows next quarter.',
      ),
      p('<br>'),
    ].join(''),
  },
  {
    id: 'offboarding',
    title: 'Offboarding checklist',
    description: 'The leaver steps, in the order that closes every route.',
    body: [
      '<h1>Offboarding checklist</h1>',
      p('<strong>Leaver:</strong> ____ &nbsp;·&nbsp; <strong>Last day:</strong> ____ &nbsp;·&nbsp; <strong>Ticket:</strong> ____'),
      h('Steps'),
      hint('Order matters. A disabled account with a live session still works.'),
      [
        '<ul>',
        '<li>Disable the account in Active Directory</li>',
        '<li>Run a directory sync cycle, or confirm one has run since</li>',
        '<li>Revoke live sessions in the cloud tenant</li>',
        '<li>Confirm every application account is deactivated, not only the tenant</li>',
        '<li>Remove group memberships and privileged assignments</li>',
        '<li>Reassign any service accounts they owned</li>',
        '<li>Record the evidence below</li>',
        '</ul>',
      ].join(''),
      h('Evidence'),
      hint(
        'Audit entries for each step, and a failed sign-in afterwards proving the account ' +
          'is genuinely closed rather than merely marked closed.',
      ),
      p('<br>'),
      h('Exceptions'),
      hint('Anything left deliberately, who approved it, and when it will be revisited.'),
      p('<br>'),
    ].join(''),
  },
  {
    id: 'change-record',
    title: 'Change record',
    description: 'What you changed, why, and how to undo it.',
    body: [
      '<h1>Change record</h1>',
      p('<strong>Change:</strong> ____ &nbsp;·&nbsp; <strong>Date:</strong> ____ &nbsp;·&nbsp; <strong>Requested by:</strong> ____'),
      h('What changed'),
      hint('The object, the attribute, the before value and the after value.'),
      p('<br>'),
      h('Why'),
      hint('The ticket or the approval. "Asked in a message" is a finding, not a reason.'),
      p('<br>'),
      h('Verification'),
      hint(
        'How you know it took effect. The log records what was attempted; check the state ' +
          'itself.',
      ),
      p('<br>'),
      h('Rollback'),
      hint('The exact steps to put it back, written before you need them.'),
      p('<br>'),
    ].join(''),
  },
  {
    id: 'runbook',
    title: 'Runbook',
    description: 'A procedure someone else can follow at 3am.',
    body: [
      '<h1>Runbook: ____</h1>',
      h('When to use this'),
      hint('The symptom that brings someone here, in the words they would search for.'),
      p('<br>'),
      h('Before you start'),
      hint('Access needed, approvals needed, and anything that must be true first.'),
      p('<br>'),
      h('Steps'),
      hint('Numbered, exact, with the command or the console named for each.'),
      '<ol><li></li><li></li><li></li></ol>',
      h('How to tell it worked'),
      hint('The check, not the hope.'),
      p('<br>'),
      h('If it did not work'),
      hint('Who to escalate to, and what to hand them.'),
      p('<br>'),
    ].join(''),
  },
];

export const TEMPLATE_BY_ID: Record<string, DocumentTemplate> = Object.fromEntries(
  DOCUMENT_TEMPLATES.map((t) => [t.id, t]),
);
