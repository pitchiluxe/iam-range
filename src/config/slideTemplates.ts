/**
 * config/slideTemplates.ts — the decks an identity engineer actually presents.
 *
 * Presenting is part of the job and part of the rubric: communication carries
 * ten points, and "walk the leadership team through what happened" is a real
 * task with a real failure mode. Engineers who can do the work and cannot
 * explain it to a room do not get promoted out of the queue.
 *
 * So the templates are the three readouts this role gives, each with the
 * structure that stops the presentation being a wall of logs — what happened,
 * what it means, what changes. The prompts inside them are the questions the
 * room asks, in the order it asks them.
 */

export interface SlideSeed {
  title: string;
  bullets: string[];
  notes: string;
}

export interface DeckTemplate {
  id: string;
  name: string;
  blurb: string;
  slides: SlideSeed[];
}

export const DECK_TEMPLATES: DeckTemplate[] = [
  {
    id: 'post-incident',
    name: 'Post-incident review',
    blurb: 'What happened, why, and what changes. The readout after an outage or a breach.',
    slides: [
      {
        title: 'What happened',
        bullets: [
          'One sentence a non-engineer can repeat',
          'When it started, when it was detected, when it ended',
          'Who was affected, and how many',
        ],
        notes:
          'Lead with the impact, not the cause. The room wants to know what it cost before ' +
          'it wants to know why. Detection time is the number leadership remembers — a long ' +
          'gap between start and detection is the finding, whatever the root cause was.',
      },
      {
        title: 'Timeline',
        bullets: [
          'First signal, and what raised it',
          'What was tried, in order',
          'What actually resolved it',
        ],
        notes:
          'Times from the audit log, not from memory. If the log cannot support a line of ' +
          'this timeline, say so on the slide rather than filling the gap — an unsupported ' +
          'timeline is the thing an auditor will pull on.',
      },
      {
        title: 'Root cause',
        bullets: [
          'The change or condition that made this possible',
          'Why the existing controls did not stop it',
          'What made it hard to detect',
        ],
        notes:
          'A cause, not a culprit. "Somebody clicked the wrong button" is not a root cause — ' +
          'the question is why the button was reachable, and why nothing caught it afterwards.',
      },
      {
        title: 'What changes',
        bullets: [
          'The control that would have prevented it',
          'The control that would have detected it sooner',
          'Owner and date for each',
        ],
        notes:
          'Two or three actions with names against them. A list of eight with no owners is ' +
          'a list nobody does, and the room can tell the difference.',
      },
    ],
  },
  {
    id: 'access-review',
    name: 'Access review readout',
    blurb: 'The quarterly certification result, for the people who signed off on it.',
    slides: [
      {
        title: 'Campaign summary',
        bullets: [
          'Scope: how many memberships, across how many groups',
          'Decided: how many approved, how many revoked',
          'Completed on: the date access actually changed',
        ],
        notes:
          'The decided and completed dates are different, and the gap matters. A campaign ' +
          'everybody decided and nobody completed removed no access at all.',
      },
      {
        title: 'What was removed',
        bullets: [
          'Revocations by group, largest first',
          'Dormant accounts that lost access',
          'Anything contested, and who decided it',
        ],
        notes:
          'Name the dormant ones. Access nobody has used in ninety days is the easiest thing ' +
          'to justify removing, and it is the strongest evidence the review was real.',
      },
      {
        title: 'What this tells us',
        bullets: [
          'Where entitlement is accumulating',
          'Groups that need a different model, not another review',
          'The next campaign, and what changes about it',
        ],
        notes:
          'A review that finds the same thing every quarter is a review nobody is acting on. ' +
          'The interesting finding is the pattern, not the count.',
      },
    ],
  },
  {
    id: 'privileged-access',
    name: 'Privileged access proposal',
    blurb: 'Making the case for eligibility over standing admin rights.',
    slides: [
      {
        title: 'Where we are',
        bullets: [
          'How many accounts hold permanent privilege',
          'How often that privilege is actually used',
          'What an attacker gets from one of them',
        ],
        notes:
          'The usage number is the argument. Standing privilege that is exercised twice a ' +
          'year is a permanent risk for an occasional convenience.',
      },
      {
        title: 'What we propose',
        bullets: [
          'Eligible instead of active, with activation on request',
          'Approval, justification and a maximum duration',
          'Break-glass accounts for when the system itself fails',
        ],
        notes:
          'Expect the objection: "what if I need it at three in the morning?" The answer is ' +
          'activation takes a minute and break-glass exists for when it cannot. Have both ' +
          'ready before you present.',
      },
      {
        title: 'What it costs',
        bullets: [
          'Time added to a privileged action',
          'Who approves, and what happens when they are away',
          'What we can stop worrying about afterwards',
        ],
        notes:
          'Naming the cost is what makes the proposal credible. A change presented as free ' +
          'gets treated as unexamined.',
      },
    ],
  },
];

export const DECK_TEMPLATE_BY_ID: Record<string, DeckTemplate> = Object.fromEntries(
  DECK_TEMPLATES.map((t) => [t.id, t]),
);
