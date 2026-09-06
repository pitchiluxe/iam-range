/**
 * config/knowledgeBase.ts — the written IAM/PIM reference.
 *
 * Two jobs. The Documentation app renders these articles, and the tutor
 * retrieves from them before answering, quoting the article it used.
 *
 * That grounding is deliberate. A small local model asked about PIM will
 * produce fluent, confident, occasionally wrong answers, and a learner
 * preparing for interviews cannot tell which is which. Written material the
 * tutor cites makes an answer checkable: if the model drifts, the article it
 * claims to be following says otherwise.
 *
 * Written from the operator's point of view — what you do, why, and what goes
 * wrong — because that is what the job and the interview both ask about.
 */

export interface Article {
  id: string;
  title: string;
  /** Short summary shown in the Documentation index. */
  summary: string;
  topic: 'directory' | 'lifecycle' | 'access' | 'privileged' | 'authentication' | 'operations';
  /** Terms that should pull this article into the tutor's context. */
  keywords: string[];
  body: string;
}

export const ARTICLES: readonly Article[] = [
  {
    id: 'ou-design',
    title: 'Organisational units and why structure comes first',
    summary: 'What OUs are for, how to shape them, and why the tree is not cosmetic.',
    topic: 'directory',
    // Both spellings, and the plural: word-boundary matching means "OUs" does
    // not reach the keyword "ou" on its own.
    keywords: [
      'ou',
      'ous',
      'organisational unit',
      'organizational unit',
      'structure',
      'delegation',
      'gpo',
    ],
    body: `An organisational unit is a container inside a domain. It exists for two
reasons, and neither of them is tidiness.

**Delegation.** You grant somebody rights over an OU, not over the whole domain.
The service desk can reset passwords in Corp/Users without being able to touch
Corp/ServiceAccounts. If everything lives in one container, every delegation is
a domain-wide delegation.

**Policy.** Group Policy is linked to OUs. Where an account or a workstation
sits decides which policy reaches it. Move an object and you change what applies
to it — which is why "move the user to the right OU" is a real remediation step
and not paperwork.

A common shape:

    corp.example
      Corp
        Users              staff accounts
        Groups             security groups
        ServiceAccounts    non-human accounts, delegated separately
        Workstations       computer objects
        Servers            separated because their policy differs

Design by *how you delegate and apply policy*, not by the org chart. Company
structures change constantly; your delegation model should not have to change
with them.

**Interview answer:** OUs are administrative boundaries for delegation and Group
Policy. Departmental OUs are a common mistake because reorganisations then force
directory work that has nothing to do with access.`,
  },
  {
    id: 'groups-not-people',
    title: 'Grant access to groups, never to people',
    summary: 'Why direct assignment is the root of most access problems.',
    topic: 'access',
    keywords: ['group', 'rbac', 'membership', 'direct assignment', 'entitlement'],
    body: `Access should be granted to a group, and people should be put in the group.

The reason is what happens later. When somebody leaves or changes team you need
to answer "what does this person have?" If access was granted to groups, the
answer is their group membership — one list, quick to read, quick to change. If
access was granted directly to individuals, the answer is scattered across every
system that granted it, and nobody finds all of it.

Direct assignment is not evil; it is *unmaintainable*. It usually starts as an
emergency ("just give her access now, we'll tidy it later") and is never tidied.

**Role-based access control** takes this further: define roles that map to jobs,
attach entitlements to roles, and assign roles to people. A payroll analyst gets
the payroll analyst role, not eleven individual grants.

**What goes wrong:**
- *Group sprawl* — a group per request rather than per role, ending with more
  groups than people.
- *Nested groups* nobody can trace, where effective access needs a graph walk.
- *Direct grants* that survive every review because reviews look at groups.

**Interview answer:** grant to groups so that entitlement is legible and
revocable. The test is whether you can answer "what does this person have, and
what happens when they leave" from one place.`,
  },
  {
    id: 'jml',
    title: 'Joiner, Mover, Leaver',
    summary: 'The lifecycle that most identity work actually is.',
    topic: 'lifecycle',
    keywords: ['jml', 'joiner', 'mover', 'leaver', 'onboarding', 'offboarding', 'transfer'],
    body: `Most identity work is one of three events.

**Joiner.** Create the account, place it in the right OU, add the groups the role
needs, set a credential, and confirm the person can actually sign in. Confirming
matters: an account that exists but cannot authenticate is not a completed
onboarding, and the ticket that says "done" is wrong.

**Mover.** Someone changes team. Add the new access *and remove the old*. The
removal is the half people skip, and skipping it is how privilege accumulates —
after three moves an employee holds the union of four jobs. When a review later
asks why a salesperson can approve payroll, this is the answer.

**Leaver.** Disable the account, then revoke live sessions. Order matters: a
disabled account with an active session can still act until that session ends.
Disabling and walking away leaves a window that is exactly as long as the
session lifetime.

Delete rather than disable only when policy says so. Disabled accounts retain
group membership and audit history, which investigations need; deletion destroys
the evidence and orphans anything that referenced the account.

**Interview answer:** JML is the backbone. The two questions that separate
candidates are "what do you remove on a mover" and "what do you do after
disabling on a leaver".`,
  },
  {
    id: 'least-privilege',
    title: 'Least privilege in practice',
    summary: 'The principle, and what applying it actually looks like.',
    topic: 'access',
    keywords: [
      'least privilege',
      'privilege creep',
      'standing access',
      'over-privileged',
      'admin rights',
      'too much access',
    ],
    body: `Least privilege means an identity holds the minimum access needed to do its
job, for the minimum time.

Both halves matter, and the second is the one people forget. Permanent
administrative rights "because they need it sometimes" fail the time test even
when the scope is right.

**Privilege creep** is the accumulation of access nobody removed. It comes from
movers whose old access stayed, emergency grants that were never revoked, and
project access that outlived the project. It is rarely one bad decision; it is
the absence of removal.

**How you actually apply it:**
- Grant through groups so that removal is possible at all.
- Make privileged roles *eligible* rather than assigned, so holding them is an
  act with a reason attached.
- Review periodically and remove what nobody can justify.
- Treat "temporary" grants as needing an expiry, or they are permanent.

**Interview answer:** least privilege is minimum scope *and* minimum duration.
Most organisations get the scope roughly right and the duration completely
wrong.`,
  },
  {
    id: 'pim-basics',
    title: 'Privileged Identity Management: eligible versus active',
    summary: 'The distinction PIM exists to make, and why standing access is the problem.',
    topic: 'privileged',
    keywords: [
      'pim',
      'privileged',
      'eligible',
      'activate',
      'jit',
      'just in time',
      'elevation',
      'domain admin',
      'admin rights',
    ],
    body: `PIM separates two things that permanent assignment conflates: being *able* to
hold a privileged role, and *currently holding* it.

**Eligible** means you may activate the role. You hold nothing right now. Your
day-to-day account has no administrative rights, so a phishing email that catches
you catches an ordinary user.

**Active** means you have taken the role up, for a bounded window, having stated
why. It lapses on its own.

**Standing privilege** is permanent assignment: always on, no expiry, no reason
recorded, nobody re-approving. It is what PIM exists to remove. The risk is not
that the person is untrustworthy — it is that the access is available every hour
of every day to anything that compromises their session.

**Activation controls:**
- *Justification* — a reason, recorded, usually a ticket reference.
- *Duration* — a maximum, so the window closes without anyone remembering.
- *Approval* — someone else agrees, for the most sensitive roles. You must never
  approve your own request; that removes the only control approval provides.
- *MFA on activation* — re-prove identity at the moment rights are taken up.

**What a review looks for:** permanent assignments, activations that never
expire, roles with no approver, and eligible assignments nobody has used in
months — the last being access that should probably be removed.

**Interview answer:** eligible versus active, with time-bounding and
justification. If asked for the single biggest win: eliminating standing
privilege for administrative roles.`,
  },
  {
    id: 'pim-operations',
    title: 'Running PIM day to day',
    summary: 'Activation, approval, expiry, and the reviews that keep it honest.',
    topic: 'privileged',
    keywords: ['pim', 'approval', 'activation', 'expiry', 'access review', 'break glass'],
    body: `**Activating.** Ask for the role, state why, and take the shortest window that
covers the work. An eight-hour activation for a ten-minute change is standing
privilege with extra steps.

**Approving.** Approvers should be able to see what the requester wrote and the
ticket it references. An approval that is a rubber stamp is theatre — worse than
none, because it creates a record implying scrutiny that did not happen.

**Expiry.** Activations must lapse without human action. If somebody has to
remember to deactivate, some of them will not be deactivated.

**Break-glass accounts.** Every environment needs a way in when the normal path
fails — the IdP is down, the last admin left, MFA is broken globally. A
break-glass account is permanently privileged *by design*, and the controls move
elsewhere: credentials split and stored offline, use alarms loudly, every use is
reviewed, and it is exercised periodically so you know it works before you need
it. Excluding it from your own conditional access is deliberate, and the reason
must be written down.

**Reviewing.** Ask of each privileged assignment: is this person still in the
role, do they still need it, and has it been used? Unused eligibility is a
finding, not a pass.

**Interview answer:** the operational questions are who approves, how long
activation lasts, what happens on expiry, and how break-glass is controlled.`,
  },
  {
    id: 'lockouts',
    title: 'Lockouts, disabled accounts, and password resets',
    summary: 'Four different causes behind one symptom, and how to tell them apart.',
    topic: 'operations',
    keywords: [
      'lockout',
      'locked',
      'unlock',
      'disabled',
      'password reset',
      'cannot sign in',
      'cannot log in',
    ],
    body: `"I cannot log in" has several distinct causes, and treating them as one is the
most common service desk mistake.

**Locked out.** Too many failed attempts tripped the lockout policy. The account
is otherwise fine. Remedy: unlock. Look at the failures first — repeated attempts
from an address the user does not recognise is an attack, not a forgotten
password, and unlocking without looking hands the account back to whoever was
guessing.

**Disabled.** An administrator turned it off, usually a leaver process. Remedy is
*not* unlocking; it is establishing whether it should be re-enabled at all. If
someone was offboarded, re-enabling on a phone call is how you get social
engineered.

**Password expired or reset with "must change".** Authentication succeeds and is
then refused pending a new password. Remedy: the user sets a new one — not
another admin reset.

**Wrong password.** They are mistaken about what it is, or a saved credential is
retrying an old one and causing the lockout in the first place.

**Order of work:** read the sign-in failures, decide which of the four you have,
then act. Verify identity before resetting anything — the reset itself is the
attack in a help desk social engineering attempt.

**Interview answer:** name the four causes, say that the log distinguishes them,
and mention identity verification before reset.`,
  },
  {
    id: 'sso-saml-oidc',
    title: 'SSO: SAML and OIDC',
    summary: 'How federated sign-in works and what breaks in practice.',
    topic: 'authentication',
    keywords: ['sso', 'saml', 'oidc', 'oauth', 'federation', 'assertion', 'token', 'idp', 'sp'],
    body: `Single sign-on lets one authentication serve many applications. The identity
provider authenticates; the application trusts it.

**SAML 2.0** — XML assertions, browser redirect. The IdP signs an assertion; the
service provider validates the signature and reads the subject and attributes.
Configuration to get right: entity ID, ACS URL, signing certificate, and the
attribute mapping.

**OIDC** — JSON tokens on top of OAuth 2.0. The IdP issues an ID token; the
client validates issuer, audience, signature and expiry. Configuration: client
ID and secret, redirect URI, scopes, and claim mapping.

**What actually breaks:**
- *Expired signing certificate* — worked for a year, then everyone is locked out
  at once. Rotation is a calendar item, not an incident.
- *redirect_uri mismatch* — the app sends a URI the IdP has not registered.
  Exact-match, including trailing slashes.
- *Wrong issuer or audience* — usually a copied-and-not-edited config.
- *Claim mapping* — the app wants roles and receives groups, so authentication
  succeeds and authorisation fails. Users report "I can log in but see nothing".

**Reading the failure:** authentication failures happen before the app; you see
them at the IdP. Authorisation failures happen after, and the user is signed in
but empty-handed. Knowing which you have halves the search.

**Interview answer:** SAML is XML assertions, OIDC is JSON tokens on OAuth 2.0.
For debugging, name certificate expiry, redirect URI mismatch, and claim
mapping.`,
  },
  {
    id: 'mfa',
    title: 'MFA and conditional access',
    summary: 'Factors, and applying them by risk rather than everywhere.',
    topic: 'authentication',
    keywords: ['mfa', '2fa', 'conditional access', 'totp', 'fido2', 'push', 'phishing'],
    body: `Multi-factor authentication requires something beyond the password.

**Strength order:** FIDO2 or hardware keys are phishing-resistant — the
credential is bound to the origin, so a fake site cannot use it. TOTP is good.
Push is convenient and vulnerable to fatigue attacks, where an attacker prompts
repeatedly until somebody taps approve. SMS is the weakest, defeated by SIM
swapping, and better than nothing.

**Conditional access** applies requirements by circumstance: require MFA from
outside the corporate network, block sign-in from countries you do not operate
in, require a managed device for administrative roles. The aim is proportionate
friction, not maximum friction — controls users route around are controls that
do not work.

**Operationally:**
- Lost device is a *re-enrolment*, not a reason to disable MFA. Clearing the
  registration lets the user enrol again; turning the policy off removes the
  control for everyone.
- Keep a break-glass exclusion, deliberately and documented, or a bad policy
  locks out the people who could fix it.
- Watch for prompt fatigue: repeated pushes the user did not initiate is an
  attack in progress.

**Interview answer:** name the factor types with phishing resistance as the axis,
and describe conditional access as risk-proportionate rather than blanket.`,
  },
  {
    id: 'access-reviews',
    title: 'Access reviews',
    summary: 'Periodic re-justification, and how reviews fail.',
    topic: 'access',
    keywords: ['access review', 'certification', 'attestation', 'recertification', 'audit'],
    body: `An access review asks, periodically, whether each grant is still justified.
Access decays: the grant that made sense at the time is rarely revisited, and
without review the only direction is accumulation.

**How they are run:** a campaign covers a scope — a group, an application, a set
of privileged roles — and a reviewer who actually knows (usually the line
manager, not IT) decides keep or remove for each entry.

**How they fail:**
- *Rubber stamping.* A reviewer with four hundred rows approves all of them. Keep
  scopes small enough to be read.
- *Wrong reviewer.* IT does not know whether a finance analyst still needs
  payroll. The manager does.
- *No teeth.* Decisions are recorded and never applied, so the next campaign
  finds the same rows.
- *Direct grants missed.* A review of group membership does not see access
  assigned directly to individuals.

**What to look for:** dormant accounts still holding access, standing privileged
assignments, people whose department changed but whose groups did not, and
service accounts nobody claims.

**Interview answer:** reviews are periodic re-justification by someone competent
to judge. Say that removal must actually happen, and mention direct grants as the
thing reviews commonly miss.`,
  },
  {
    id: 'service-accounts',
    title: 'Service accounts',
    summary: 'Non-human identities and why they are usually the weakest link.',
    topic: 'operations',
    keywords: ['service account', 'non-human', 'svc', 'secret', 'rotation'],
    body: `Service accounts authenticate software rather than people. They are usually the
weakest identities in an estate, for structural reasons.

**Why they rot:** nobody owns them after the person who created them leaves;
their passwords never expire because rotation breaks things; they accumulate
permissions because failures are debugged by granting more; and they are excluded
from MFA because software cannot answer a prompt.

**Doing them properly:**
- A named human owner, recorded, and reassigned when that person leaves.
- Scope to exactly what the integration needs, verified rather than assumed.
- Rotate on a schedule you have actually rehearsed.
- Separate them into their own OU so they can be delegated and reviewed apart
  from staff.
- Never use one interactively. If a person signs in as a service account, the
  audit trail no longer identifies anybody.

**Interview answer:** the risks are ownerless accounts, non-rotating credentials,
and over-permissioning. The controls are named ownership, scoped permissions and
rehearsed rotation.`,
  },
  {
    id: 'okta-entra',
    title: 'Okta and Entra ID alongside Active Directory',
    summary: 'How cloud identity relates to the on-premises directory.',
    topic: 'directory',
    keywords: ['okta', 'entra', 'azure ad', 'sync', 'hybrid', 'provisioning', 'scim'],
    body: `Most organisations run a hybrid: Active Directory on premises, a cloud identity
provider in front of SaaS.

**Direction of authority.** Usually AD is authoritative for identity and the
cloud is synchronised from it. Accounts are created in AD and appear in the
cloud; disabling in AD deprovisions in the cloud on the next sync. Knowing which
side is authoritative tells you where to make a change — editing the synced copy
either fails or is overwritten.

**Sync is not instant.** There is a cycle, typically minutes. "I disabled them
but they can still get in" is often sync latency, and for a real leaver you force
the sync or revoke sessions directly rather than waiting.

**Provisioning to applications.** SCIM lets the IdP create and deactivate
accounts inside SaaS applications. Without it, deprovisioning stops at the IdP
and the leaver keeps a working local account in every app.

**Where it breaks:** duplicate identities from a soft-match failure, attributes
that do not survive the mapping, sync running as an over-privileged account, and
deprovisioning that stops at the IdP.

**Interview answer:** name the authoritative source, the sync cycle and its
latency, and SCIM for downstream deprovisioning. The good question is "what
happens to their SaaS access when I disable them in AD, and how long does it
take".`,
  },
  {
    id: 'audit-evidence',
    title: 'Audit logs and evidence',
    summary: 'Reading the trail, and why intent is not effect.',
    topic: 'operations',
    keywords: ['audit', 'log', 'evidence', 'investigation', 'siem'],
    body: `The audit log is how you prove what happened, and usually the only way to
reconstruct an incident.

**Reading it:** identify the actor, the target and the action, then build a
timeline. For a suspected compromise: failed sign-ins, then a success, then what
that session did. The pattern of many failures followed by one success from the
same address is credential stuffing that worked.

**Evidence for a ticket:** before and after state, the action you took, the time,
and who authorised it. "Reset the password" is not evidence; the audit entry
showing the reset, plus the successful sign-in afterwards, is.

**The trap.** A log records what was *attempted*, not always what took *effect*.
A system that writes "role granted" and does not change access has produced a
misleading record, and it looks like success. When something is not behaving as
the log claims, verify the state directly rather than trusting the entry.

**Interview answer:** describe building a timeline from actor, target and action,
and name the failure-then-success pattern. Mentioning that logs can record intent
rather than effect will distinguish you.`,
  },
];

/**
 * Words too common to indicate anything. Without this, "how do I..." matches
 * every article, because every article contains "how".
 */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'you', 'your', 'how', 'what', 'why', 'when', 'who', 'does', 'did',
  'this', 'that', 'with', 'from', 'about', 'into', 'should', 'would', 'could', 'can',
  'are', 'was', 'were', 'has', 'have', 'need', 'want', 'make', 'get',
]);

/**
 * Whether the query contains a keyword as a whole word or phrase.
 *
 * Plain substring matching fails badly on short keywords: "ou" is a real
 * keyword and it is also inside "sourdough", which is how an off-topic
 * question used to score ten points against the OU article.
 */
function phraseHit(q: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`).test(q);
}

/**
 * Articles matching a free-text query, best first.
 *
 * Relevance must come from a keyword or the title — the *anchor*. Body text
 * only ranks what already matched. Without that floor, an off-topic question
 * scores on incidental words and the tutor is handed unrelated material to
 * build a confident answer from, which is worse than admitting the reference
 * does not cover it.
 */
export function searchArticles(query: string, limit = 3): Article[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const terms = q
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));

  const scored = ARTICLES.map((a) => {
    let anchor = 0;
    for (const kw of a.keywords) {
      if (phraseHit(q, kw)) anchor += 10;
      // Both directions: "unlocking" should reach the "unlock" keyword, and
      // "review" should reach "access review".
      else if (terms.some((t) => kw.includes(t) || (kw.length >= 4 && t.includes(kw)))) {
        anchor += 4;
      }
    }
    if (a.title.toLowerCase().includes(q)) anchor += 8;
    for (const t of terms) {
      if (a.title.toLowerCase().includes(t)) anchor += 3;
    }

    let support = 0;
    for (const t of terms) {
      if (a.body.toLowerCase().includes(t)) support += 1;
    }
    return { a, anchor, score: anchor + support };
  })
    .filter((x) => x.anchor > 0)
    .sort((x, y) => y.score - x.score);

  return scored.slice(0, limit).map((x) => x.a);
}

export function articleById(id: string): Article | undefined {
  return ARTICLES.find((a) => a.id === id);
}
