/**
 * config/manual.ts — the course, as opposed to the reference.
 *
 * Documentation answers "what is standing privilege?". The manual answers
 * "what do I do on Monday morning, and how do I know it worked?" — ordered
 * lessons, each one performed on this workstation with the real tools, each
 * ending in the check that proves it and the question an interviewer asks.
 *
 * The ordering is not editorial. You cannot onboard anyone before there is an
 * OU to put them in, and you cannot practise a lockout before there is an
 * account to lock, so the lessons follow the same chronology the ticket
 * generator uses. A learner who works the manual top to bottom builds the
 * domain the tickets then keep asking about.
 *
 * Every command here is one the terminal actually implements, and every
 * console step names a control that exists. That is checked by
 * tests/manual.test.ts — a manual that tells you to run a cmdlet the shell
 * does not have is worse than no manual, because the learner concludes they
 * are the problem.
 */

export interface ManualStep {
  /** What to do, in the imperative. */
  do: string;
  /** The cmdlet, if this step has one. Verified against the registry. */
  cmdlet?: string;
  /** An example invocation, shown as code. */
  example?: string;
}

export interface Lesson {
  id: string;
  title: string;
  /** One sentence: what you will be able to do afterwards. */
  objective: string;
  /** Why this matters operationally, in a short paragraph. */
  why: string;
  steps: ManualStep[];
  /** How to prove it worked. Not optional — this is the habit being taught. */
  verify: string;
  /** What an interviewer asks about this, and what a good answer contains. */
  interview: string;
  /** Documentation article to read alongside it. */
  reading?: string;
  /** Application to open for this lesson. */
  app?: string;
}

export interface Chapter {
  id: string;
  title: string;
  summary: string;
  lessons: Lesson[];
}

export const MANUAL: readonly Chapter[] = [
  {
    id: 'directory',
    title: '1 · The directory',
    summary:
      'A domain with nothing in it, and the structure that has to exist before anybody can be ' +
      'put into it.',
    lessons: [
      {
        id: 'survey',
        title: 'Find out what you have',
        objective: 'Read the state of a domain before changing anything in it.',
        why:
          'You have inherited a directory. Before creating a single object, find out what is ' +
          'already there — the accounts, the structure, the privileged assignments. Every ' +
          'change you make from here is judged against this starting point, and "what did it ' +
          'look like before?" is the first question asked when something breaks.',
        steps: [
          { do: 'Open Active Directory Users and Computers and expand the domain.', app: 'active-directory' } as ManualStep,
          { do: 'List the accounts that exist.', cmdlet: 'Get-ADUser', example: 'Get-ADUser' },
          { do: 'List the organisational units.', cmdlet: 'Get-ADOrganizationalUnit', example: 'Get-ADOrganizationalUnit' },
          { do: 'List the groups.', cmdlet: 'Get-ADGroup', example: 'Get-ADGroup' },
        ],
        verify:
          'One account — the built-in administrator — no organisational units and no groups. ' +
          'That is a freshly promoted domain controller, and it is where every real one starts.',
        interview:
          '"How do you approach a directory you have never seen?" Say that you read before you ' +
          'write: the structure, the privileged accounts, and the audit log. Naming the audit ' +
          'log is what separates a good answer.',
        reading: 'ou-design',
        app: 'active-directory',
      },
      {
        id: 'ou-structure',
        title: 'Build the organisational unit structure',
        objective: 'Create an OU hierarchy designed for delegation rather than for the org chart.',
        why:
          'An OU is an administrative boundary, not a folder. You delegate rights over an OU, ' +
          'and Group Policy is linked to one, so where an object sits decides who can administer ' +
          'it and which policy reaches it. Departmental OUs are the common mistake: companies ' +
          'reorganise constantly, and then every reorganisation becomes directory work.',
        steps: [
          { do: 'Create the top-level container.', cmdlet: 'New-ADOrganizationalUnit', example: 'New-ADOrganizationalUnit -Name Corp' },
          { do: 'Create the child OUs beneath it.', cmdlet: 'New-ADOrganizationalUnit', example: 'New-ADOrganizationalUnit -Name Users -Path Corp' },
          { do: 'Separate service accounts, so they can be delegated apart from staff.', cmdlet: 'New-ADOrganizationalUnit', example: 'New-ADOrganizationalUnit -Name ServiceAccounts -Path Corp' },
          { do: 'Confirm the tree in the console, or with Get-ADOrganizationalUnit.', cmdlet: 'Get-ADOrganizationalUnit' },
        ],
        verify:
          'The tree in Active Directory Users and Computers shows Corp with its children. If it ' +
          'does not, the OU was created somewhere else — check the -Path you used.',
        interview:
          '"What are OUs for?" Delegation and Group Policy. Add that you design by how you ' +
          'delegate rather than by the org chart, and say why.',
        reading: 'ou-design',
        app: 'active-directory',
      },
      {
        id: 'group-model',
        title: 'Define the group model',
        objective: 'Create the groups that access will be granted to, before granting any access.',
        why:
          'Access goes to groups, and people go in groups. The reason is what happens later: ' +
          'when somebody leaves, their group membership is one list you can read and revoke. ' +
          'Access granted directly to individuals is scattered across every system that granted ' +
          'it, and nobody ever finds all of it.',
        steps: [
          { do: 'Create a group per role, not per request.', cmdlet: 'New-ADGroup', example: 'New-ADGroup -Name grp-helpdesk-tier1 -Description "Service desk tier 1"' },
          { do: 'Create the groups the other departments will need.', cmdlet: 'New-ADGroup' },
          { do: 'Check what exists.', cmdlet: 'Get-ADGroup', example: 'Get-ADGroup' },
        ],
        verify:
          'Get-ADGroup lists the groups, and each name says which job it corresponds to. If a ' +
          'name only makes sense next to a ticket number, it is a request rather than a role.',
        interview:
          '"Why not just grant access to the user?" Because entitlement has to be legible and ' +
          'revocable. The test is whether you can answer "what does this person have" from one ' +
          'place.',
        reading: 'groups-not-people',
        app: 'active-directory',
      },
    ],
  },
  {
    id: 'lifecycle',
    title: '2 · Joiner, mover, leaver',
    summary: 'The three events that make up most identity work, and the half of each that people skip.',
    lessons: [
      {
        id: 'joiner',
        title: 'Onboard somebody properly',
        objective: 'Create an account that can actually sign in, and prove that it can.',
        why:
          'Creating the object is the easy half. An account that exists but cannot authenticate ' +
          'is not a completed onboarding, and the ticket that says "done" is wrong. Confirming ' +
          'the sign-in is what makes it finished.',
        steps: [
          { do: 'Create the account.', cmdlet: 'New-ADUser', example: 'New-ADUser -SamAccountName jdoe -Name "John Doe" -Department "Help Desk" -Title "Service Desk Analyst"' },
          { do: 'Put it in the right OU.', cmdlet: 'Move-ADObject', example: 'Move-ADObject -Identity jdoe -TargetPath Users' },
          { do: 'Add the groups the role needs.', cmdlet: 'Add-ADGroupMember', example: 'Add-ADGroupMember -Identity grp-helpdesk-tier1 -Members jdoe' },
          { do: 'Set a password the person will change at first sign-in.', cmdlet: 'Set-ADAccountPassword' },
          { do: 'Sign out, and sign in as them from the login screen.' },
        ],
        verify:
          'The new account appears on the login screen and signs in. Their desktop shows the ' +
          'applications their department is entitled to — Help Desk gets Active Directory, ' +
          'Finance does not.',
        interview:
          '"Walk me through onboarding." Create, place, group, credential, and confirm the ' +
          'sign-in. Mentioning the confirmation is the part most candidates leave out.',
        reading: 'jml',
        app: 'active-directory',
      },
      {
        id: 'mover',
        title: 'Move somebody between teams',
        objective: 'Change what somebody has access to — including taking the old access away.',
        why:
          'The removal is the half people skip, and skipping it is how privilege accumulates. ' +
          'After three moves an employee holds the union of four jobs. When a review later asks ' +
          'why a salesperson can approve payroll, this is the answer.',
        steps: [
          { do: 'Add the access the new role needs.', cmdlet: 'Add-ADGroupMember' },
          { do: 'Remove the access the old role needed.', cmdlet: 'Remove-ADGroupMember', example: 'Remove-ADGroupMember -Identity grp-helpdesk-tier1 -Members jdoe' },
          { do: 'Move the account to the OU that matches its new place.', cmdlet: 'Move-ADObject' },
          { do: 'Read back their membership and check nothing is left over.', cmdlet: 'Get-ADPrincipalGroupMembership' },
        ],
        verify:
          'Their group membership lists the new role and not the old one. If both are there, ' +
          'you have done the easy half.',
        interview:
          '"What do you do on a transfer?" Add and remove. If you only say add, the interviewer ' +
          'has their answer.',
        reading: 'jml',
        app: 'active-directory',
      },
      {
        id: 'leaver',
        title: 'Offboard somebody, and close every route',
        objective: 'Disable an account and confirm no path into the estate is still open.',
        why:
          'Order matters. A disabled account with a live session keeps working until that ' +
          'session expires, and an application the identity provider cannot deprovision keeps ' +
          'its own working account regardless. Disabling and walking away leaves a window as ' +
          'long as the session lifetime, and a local account that never closes.',
        steps: [
          { do: 'Disable the account on premises.', cmdlet: 'Disable-ADAccount', example: 'Disable-ADAccount -Identity jdoe' },
          { do: 'Check what the cloud tenant currently believes.', cmdlet: 'Get-DirectorySyncStatus', example: 'Get-DirectorySyncStatus -Provider okta' },
          { do: 'Run a sync cycle rather than waiting for the schedule.', cmdlet: 'Start-DirectorySync', example: 'Start-DirectorySync -Provider okta' },
          { do: 'Revoke live sessions.', cmdlet: 'Revoke-CloudSession', example: 'Revoke-CloudSession -Provider okta -Upn jdoe@iamlab.com' },
          { do: 'Look for application accounts the tenant could not reach.', cmdlet: 'Get-OrphanedAppAccount', example: 'Get-OrphanedAppAccount -Provider okta' },
        ],
        verify:
          'The account is disabled on premises and in the tenant, no sessions remain, and ' +
          'Get-OrphanedAppAccount is empty. If it is not, switch SCIM on for that application ' +
          'and check again.',
        interview:
          '"How do you offboard?" Disable, sync, revoke sessions, confirm downstream. Naming ' +
          'session revocation and SCIM is what makes the answer credible.',
        reading: 'jml',
        app: 'active-directory',
      },
      {
        id: 'lockout',
        title: 'Tell a lockout from a disabled account',
        objective: 'Diagnose "I cannot sign in" instead of guessing at it.',
        why:
          'Four different causes produce one symptom: locked out, disabled, password expired, ' +
          'and simply wrong. Treating them as one is the most common service desk mistake, and ' +
          'unlocking an account without reading the failures first hands it back to whoever was ' +
          'guessing the password.',
        steps: [
          { do: 'Read the sign-in failures before touching anything.', cmdlet: 'Get-SignInLog' },
          { do: 'Look at the account state.', cmdlet: 'Get-ADUser', example: 'Get-ADUser -Identity jdoe' },
          { do: 'If it is locked and the failures look like a forgotten password, unlock it.', cmdlet: 'Unlock-ADAccount', example: 'Unlock-ADAccount -Identity jdoe' },
          { do: 'If it is disabled, find out why before re-enabling anything.', cmdlet: 'Enable-ADAccount' },
        ],
        verify:
          'The account signs in, and the audit log shows the unlock followed by a successful ' +
          'sign-in. The successful sign-in is the evidence; the unlock on its own is only intent.',
        interview:
          '"A user cannot log in. What do you check?" Name the four causes, say the log ' +
          'distinguishes them, and mention verifying identity before resetting anything.',
        reading: 'lockouts',
        app: 'active-directory',
      },
    ],
  },
  {
    id: 'privileged',
    title: '3 · Privileged access',
    summary:
      'The difference between being able to hold an administrative role and currently holding ' +
      'it, and why that difference is the whole discipline.',
    lessons: [
      {
        id: 'standing',
        title: 'Find standing privilege',
        objective: 'Locate permanent administrative access nobody re-approves.',
        why:
          'Standing privilege is always on, has no expiry, records no reason, and nobody ' +
          're-approves it. The risk is not that the holder is untrustworthy — it is that the ' +
          'access is available every hour of every day to anything that compromises their ' +
          'session. Removing it is the single biggest win in privileged access.',
        steps: [
          { do: 'List every privileged assignment in the tenant.', cmdlet: 'Get-PimAssignment', example: 'Get-PimAssignment' },
          { do: 'Ask specifically for the permanent ones.', cmdlet: 'Get-PimStandingPrivilege', example: 'Get-PimStandingPrivilege' },
        ],
        verify:
          'Every row returned is permanent access somebody holds right now without having ' +
          'asked for it today. An empty result means the tenant is time-bound, which is the ' +
          'goal.',
        interview:
          '"What is wrong with permanent admin rights?" They fail the time half of least ' +
          'privilege. Say that the scope is usually roughly right and the duration is usually ' +
          'completely wrong.',
        reading: 'pim-basics',
        app: 'terminal',
      },
      {
        id: 'eligible',
        title: 'Replace it with eligibility',
        objective: 'Make somebody eligible for a role rather than assigned to it.',
        why:
          'Eligible means they may activate the role and hold nothing right now, so their ' +
          'day-to-day account has no administrative rights and a phishing email that catches ' +
          'them catches an ordinary user. Taking the role up becomes an act with a reason ' +
          'attached and an expiry on it.',
        steps: [
          { do: 'Create the eligible assignment.', cmdlet: 'New-PimEligibility', example: 'New-PimEligibility -Identity jdoe -Role role-domain-admins' },
          { do: 'Remove the permanent assignment it replaces.', cmdlet: 'Remove-PimAssignment' },
          { do: 'Confirm no standing privilege remains.', cmdlet: 'Get-PimStandingPrivilege' },
        ],
        verify:
          'Get-PimAssignment shows the person as eligible, and Get-PimStandingPrivilege is ' +
          'empty. Eligible with the permanent assignment still in place is not a fix.',
        interview:
          '"Explain eligible versus active." Eligible is permission to take it up; active is ' +
          'holding it, time-boxed, with a justification.',
        reading: 'pim-basics',
        app: 'terminal',
      },
      {
        id: 'activate',
        title: 'Activate a role for a change window',
        objective: 'Take up a privileged role for as long as the work takes and no longer.',
        why:
          'An eight-hour activation for a ten-minute change is standing privilege with extra ' +
          'steps. The justification is what makes the access reviewable afterwards, and the ' +
          'expiry is what closes it without anyone having to remember.',
        steps: [
          { do: 'Activate with a reason and a duration that matches the work.', cmdlet: 'Enable-PimRole', example: 'Enable-PimRole -Identity jdoe -Role role-domain-admins -Justification "INC-4471" -Minutes 60' },
          { do: 'Try it without a justification, and read the refusal.', cmdlet: 'Enable-PimRole' },
          { do: 'End it early once the work is done.', cmdlet: 'Disable-PimRole' },
        ],
        verify:
          'Get-PimAssignment shows the role active with an expiry and the justification you ' +
          'gave. After the window passes it returns to eligible on its own.',
        interview:
          '"What controls should activation have?" Justification, maximum duration, approval ' +
          'for the most sensitive roles, and MFA at the moment of elevation.',
        reading: 'pim-operations',
        app: 'terminal',
      },
      {
        id: 'approval',
        title: 'Approve somebody else’s activation',
        objective: 'Operate the approval step, and see why self-approval is refused.',
        why:
          'Approval is the only control that puts a second person in the path. An approver who ' +
          'rubber-stamps is worse than no approver, because the record implies scrutiny that ' +
          'did not happen — and approving your own request removes the control entirely.',
        steps: [
          { do: 'Require approval on the role.', cmdlet: 'Get-PimAssignment' },
          { do: 'Request activation as the person who needs it.', cmdlet: 'Enable-PimRole' },
          { do: 'Try to approve your own request, and read the refusal.', cmdlet: 'Approve-PimRequest' },
          { do: 'Approve it as somebody else.', cmdlet: 'Approve-PimRequest', example: 'Approve-PimRequest -Identity jdoe -Role role-domain-admins' },
        ],
        verify:
          'The assignment moves from pending-approval to active, and the record names who ' +
          'approved it. Your own attempt was refused.',
        interview:
          '"Who approves privileged activation?" Somebody other than the requester, with the ' +
          'justification and the ticket in front of them.',
        reading: 'pim-operations',
        app: 'terminal',
      },
    ],
  },
  {
    id: 'cloud',
    title: '4 · Cloud identity',
    summary: 'Okta and Entra ID in front of the domain, and the four things that go wrong there.',
    lessons: [
      {
        id: 'authority',
        title: 'Work out which side is authoritative',
        objective: 'Know where to make a change in a hybrid estate.',
        why:
          'Usually Active Directory is the source of truth and the cloud holds copies. Editing ' +
          'the synced copy either fails or is silently overwritten at the next cycle, so ' +
          'knowing which side owns the attribute is half of hybrid troubleshooting.',
        steps: [
          { do: 'Connect to the tenant.', cmdlet: 'Connect-Okta', example: 'Connect-Okta' },
          { do: 'Look at the accounts and their origin.', cmdlet: 'Get-CloudUser', example: 'Get-CloudUser -Provider okta' },
          { do: 'Try to disable a synced account in the cloud, and read the refusal.', cmdlet: 'Disable-CloudUser' },
        ],
        verify:
          'Synced accounts are refused with a message naming Active Directory. Cloud-only ' +
          'accounts, which nothing on premises owns, are not.',
        interview:
          '"Where do you make the change in a hybrid setup?" On the authoritative side, and say ' +
          'which that is and how you would confirm it.',
        reading: 'okta-entra',
        app: 'cloud-identity',
      },
      {
        id: 'latency',
        title: 'Explain "I disabled them and they can still get in"',
        objective: 'Diagnose sync latency with evidence rather than with a shrug.',
        why:
          'Sync runs on a cycle, typically every thirty minutes. Between your change and that ' +
          'cycle, the cloud is genuinely still enforcing the old state. For a real leaver you ' +
          'force the sync rather than wait.',
        steps: [
          { do: 'Disable an account on premises.', cmdlet: 'Disable-ADAccount' },
          { do: 'Ask the tenant what it currently believes.', cmdlet: 'Get-CloudUser' },
          { do: 'Ask what has not caught up, and when the last cycle ran.', cmdlet: 'Get-DirectorySyncStatus' },
          { do: 'Force a cycle.', cmdlet: 'Start-DirectorySync' },
        ],
        verify:
          'Before the cycle the cloud copy is active and the delta names it. Afterwards the ' +
          'tenant matches the directory and the delta is empty.',
        interview:
          '"They were disabled but still signed in. Why?" Sync latency or a session that was ' +
          'never revoked. Say how you would tell the two apart.',
        reading: 'okta-entra',
        app: 'cloud-identity',
      },
      {
        id: 'scim',
        title: 'Close the leaver gap inside applications',
        objective: 'Find accounts still working in a SaaS app after the person was disabled.',
        why:
          'SCIM lets the identity provider deactivate accounts inside an application. Without ' +
          'it, deprovisioning stops at the provider and the leaver keeps a working local ' +
          'account in every app. This is the most common finding in a leaver audit.',
        steps: [
          { do: 'List accounts still active for disabled people.', cmdlet: 'Get-OrphanedAppAccount' },
          { do: 'Switch SCIM on for that application.', cmdlet: 'Set-ScimProvisioning', example: 'Set-ScimProvisioning -Provider okta -App "HR Portal"' },
          { do: 'Check the gap has closed.', cmdlet: 'Get-OrphanedAppAccount' },
        ],
        verify:
          'The orphan list is empty, and the application shows the account deactivated rather ' +
          'than active. Switching SCIM on reconciles what was missed while it was off.',
        interview:
          '"What happens to their SaaS access when you disable them in AD?" It depends on ' +
          'whether the app is provisioned through the IdP. Name SCIM and the latency.',
        reading: 'okta-entra',
        app: 'cloud-identity',
      },
      {
        id: 'duplicates',
        title: 'Clean up a duplicate identity',
        objective: 'Recognise and resolve one person with two cloud objects.',
        why:
          'Somebody creates an account directly in the tenant instead of waiting for the sync. ' +
          'The connector then cannot match it, and the person ends up with two objects sharing ' +
          'a login — landing unpredictably in one or the other, with different group ' +
          'membership each time.',
        steps: [
          { do: 'Find objects sharing a login.', cmdlet: 'Get-CloudDuplicate', example: 'Get-CloudDuplicate -Provider okta' },
          { do: 'Establish which one is synced from the directory — that is the authoritative one.', cmdlet: 'Get-CloudUser' },
          { do: 'Deal with the cloud-only object, and record what you did.' },
        ],
        verify:
          'Get-CloudDuplicate returns nothing, and the surviving object is the synced one. ' +
          'Keeping the cloud-only copy would leave the person outside the directory.',
        interview:
          '"How do duplicate identities happen?" A failed soft match, usually because an ' +
          'account was created in the cloud for somebody who also has an on-premises one.',
        reading: 'okta-entra',
        app: 'cloud-identity',
      },
    ],
  },
  {
    id: 'operations',
    title: '5 \u00b7 Review, recovery and evidence',
    summary:
      'The standing jobs. Certifying access you granted, proving you can still get in when the '
      + 'identity provider fails, and producing something an auditor or an interviewer can read.',
    lessons: [
      {
        id: 'certification',
        title: 'Run an access review',
        objective: 'Certify every membership in the directory, and remove what is not needed.',
        why:
          'Certification is the standing quarterly job and the control an auditor asks about '
          + 'first. It is also the one most often performed without effect: a campaign where '
          + 'every reviewer decided and nobody completed it has removed no access at all. '
          + 'Entitlement accumulates because leavers and movers are handled one at a time and '
          + 'nobody ever looks at the whole picture.',
        steps: [
          { do: 'Open Access Reviews and start a campaign. It scopes itself to every membership that exists.' },
          {
            do: 'Work the list. The last sign-in column is the argument \u2014 access nobody has used is the easiest to justify removing.',
          },
          { do: 'Decide every row. The campaign refuses to complete while any is undecided, because approving by default is rubber-stamping.' },
          { do: 'Complete it. Nothing is removed until you do; the button says how many memberships it is about to take away.' },
          { do: 'Read back what happened.', cmdlet: 'Get-IamAuditLog', example: 'Get-IamAuditLog -Action review' },
          { do: 'Export the result to Sheets if you need to count or chart it for a readout.' },
        ],
        verify:
          'The revoked accounts are out of their groups in Active Directory, and the audit log '
          + 'holds one review.completed entry naming how many were revoked and how many kept. '
          + 'If the memberships are unchanged, the campaign was decided but never completed.',
        interview:
          '"How do you run an access review?" Scope it, get a decision on every line, and '
          + 'complete it. Say that revocations apply on completion \u2014 the campaign nobody '
          + 'finished is the commonest way a review removes nothing.',
        app: 'access-reviews',
      },
      {
        id: 'emergency-access',
        title: 'Stand up break-glass, then prove it works',
        objective: 'Build an emergency way in, and test it by breaking the normal one.',
        why:
          'A break-glass account is how you get back in when the identity provider is refusing '
          + 'every MFA challenge and the administrators are locked out. It sits outside the '
          + 'controls protecting everyone else, which makes it the most valuable account in the '
          + 'estate and the one most worth watching. Emergency access nobody has exercised is a '
          + 'belief rather than a control.',
        steps: [
          { do: 'Open Emergency Access and read the posture. Every unticked item says what it needs.' },
          { do: 'Create two accounts, not one. One is a single point of failure \u2014 lose the credential or the person holding it and the recovery path is gone when it is needed.' },
          { do: 'Exclude both from every policy that requires MFA. Excluded from one of two is not emergency access; the policy that still applies is the one that blocks the recovery.' },
          { do: 'Turn on sign-in alerting. Watching them is the price of exempting them.' },
          { do: 'Run the drill. It breaks MFA across the tenant, so the excluded accounts are the only way in.' },
          { do: 'Recover, then rotate. A used emergency credential is a spent one.' },
          { do: 'Write the post-incident note in Slides \u2014 the template carries the sections the room expects.' },
        ],
        verify:
          'During the drill the break-glass accounts are excluded from MFA and an ordinary '
          + 'administrator is not. The audit log records the fault, the recovery and the '
          + 'exclusion as a risk accepted on purpose.',
        interview:
          '"Why two break-glass accounts, and who holds the credentials?" Two because one is a '
          + 'single point of failure. Say they are excluded from conditional access on purpose, '
          + 'alerted on every sign-in, and rotated after any use.',
        app: 'break-glass',
      },
      {
        id: 'evidence',
        title: 'Answer a question from the log, and produce the evidence',
        objective: 'Investigate what happened, and hand somebody proof they can check.',
        why:
          'The audit log is the most valuable thing this estate produces and the least used. '
          + '"Who granted this?", "what changed on Tuesday?" and "show me every privileged '
          + 'activation" are weekly questions, and the answer has to be something another person '
          + 'can verify rather than a sentence claiming it. Evidence is also what separates '
          + '"I did a course" from "here is the estate I built and the log behind it".',
        steps: [
          { do: 'Open Log Search and narrow with field terms: actor, action, target, since. action: matches a family, so action:pim. finds every privileged event.' },
          { do: 'Read the same log from the shell when you want it in a pipeline.', cmdlet: 'Get-IamAuditLog', example: 'Get-IamAuditLog -Action group.add' },
          { do: 'Export to CSV and open it in Sheets to count. COUNTIF answers "how many of these are stale".' },
          { do: 'Capture what you found with Snip & Annotate, and redact the names that should not travel \u2014 an opaque block, never a blur, because a blur can be undone.' },
          { do: 'Use Screen Pen when you need to point at something on a live console rather than a captured picture.' },
          { do: 'Produce the evidence pack from Lab Plan. It carries what you completed, the log entries behind each claim, and what is still outstanding.' },
        ],
        verify:
          'The pack is in Documents, names the tasks you actually finished, and quotes the audit '
          + 'entries under each one. If it claims work the directory cannot show, it is wrong and '
          + 'so is the claim.',
        interview:
          '"How would you prove that change was authorised?" Name the log, the fields you would '
          + 'filter on, and the fact that you would redact other people\u2019s data before '
          + 'attaching anything. Then say you would keep the raw export alongside the summary.',
        app: 'log-search',
      },
    ],
  },
];

export const ALL_LESSONS: readonly Lesson[] = MANUAL.flatMap((c) => c.lessons);

export function lessonById(id: string): Lesson | undefined {
  return ALL_LESSONS.find((l) => l.id === id);
}

/** Chapter a lesson belongs to, for breadcrumbs and progress. */
export function chapterOf(lessonId: string): Chapter | undefined {
  return MANUAL.find((c) => c.lessons.some((l) => l.id === lessonId));
}
