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
          { do: 'Add the groups the role needs.', cmdlet: 'Add-ADGroupMember', example: 'Add-ADGroupMember -Identity jdoe -Group grp-helpdesk-tier1' },
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
          { do: 'Remove the access the old role needed.', cmdlet: 'Remove-ADGroupMember', example: 'Remove-ADGroupMember -Identity jdoe -Group grp-helpdesk-tier1' },
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
          { do: 'Connect to the cloud tenant before changing it.', cmdlet: 'Connect-Okta', example: 'Connect-Okta' },
          { do: 'Run a sync cycle rather than waiting for the schedule.', cmdlet: 'Start-DirectorySync', example: 'Start-DirectorySync -Provider okta' },
          { do: 'Revoke live sessions.', cmdlet: 'Revoke-CloudSession', example: 'Revoke-CloudSession -Provider okta -Upn jdoe@omari.test' },
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
          { do: 'If it is locked and the failures look like a forgotten password, unlock it with the user name from the queue.', cmdlet: 'Unlock-ADAccount' },
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
          { do: 'Create the privileged role that will be eligible.', cmdlet: 'New-IamRole', example: 'New-IamRole -Name role-domain-admins -Description "Domain Administrators" -Permissions domain:*' },
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
          { do: 'Approve it as somebody else.', cmdlet: 'Approve-PimRequest' },
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
          { do: 'Its camera photographs the screen with your annotations on it, and its recorder captures the walkthrough with your narration — both land in Documents. Say what you are doing and why while you do it; that recording is the closest thing to rehearsing the interview.' },
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
  {
    id: 'analyst-lab',
    title: '6 \u00b7 IAM Analyst lab',
    summary:
      'A capstone that walks through an IAM analyst job description using the simulated ' +
      'workstation: build the structure, provision users, enforce RBAC, set password and ' +
      'lockout policies, secure file shares, audit access, find dormant accounts, verify ' +
      'Entra sync, resolve helpdesk issues, and document the work.',
    lessons: [
      {
        id: 'analyst-env',
        title: 'Prepare the domain for the analyst lab',
        objective: 'Confirm the directory structure exists before users are created.',
        why:
          'Analyst work starts on a directory somebody else built. Before creating or moving ' +
          'accounts, verify the structure is there: OUs for each department and an OU for groups. ' +
          'Creating users into a structure that does not exist is the commonest first-day error.',
        steps: [
          { do: 'Open Active Directory Users and Computers and read the current tree.', app: 'active-directory' } as ManualStep,
          { do: 'List the organisational units.', cmdlet: 'Get-ADOrganizationalUnit' },
          { do: 'Create the top-level Corp OU if it is missing.', cmdlet: 'New-ADOrganizationalUnit', example: 'New-ADOrganizationalUnit -Name Corp' },
          { do: 'Create the department OUs if they are missing.', cmdlet: 'New-ADOrganizationalUnit', example: 'New-ADOrganizationalUnit -Name HR -Path Corp' },
          { do: 'Create an OU to hold user accounts if it is missing.', cmdlet: 'New-ADOrganizationalUnit', example: 'New-ADOrganizationalUnit -Name Users -Path Corp' },
          { do: 'Create an OU to hold security groups if it is missing.', cmdlet: 'New-ADOrganizationalUnit', example: 'New-ADOrganizationalUnit -Name Groups -Path Corp' },
          { do: 'List the OUs and groups so you know what is already in place.', cmdlet: 'Get-ADOrganizationalUnit' },
        ],
        verify:
          'The tree shows Corp with the department, Users and Groups OUs. Get-ADGroup lists the ' +
          'role groups the later lessons will use.',
        interview:
          '"What do you check before bulk-creating accounts?" The OU and group structure. Say ' +
          'that creating accounts into missing containers is the first failure.',
        reading: 'ou-design',
        app: 'active-directory',
      },
      {
        id: 'analyst-provision',
        title: 'Bulk-provision from a CSV-style list',
        objective: 'Create ten accounts in one script and place each in the right OU and group.',
        why:
          'A real HR system hands over a CSV. The analyst script reads it, generates usernames, ' +
          'creates accounts, sets temporary passwords, places them in OUs and adds the role ' +
          'groups. Doing this by hand for ten people is a mistake waiting to happen.',
        steps: [
          { do: 'Open the PowerShell ISE and load the "Bulk onboarding from a CSV list" template.', app: 'script-editor' } as ManualStep,
          { do: 'Read the list of employees and the department groups it will use.' },
          { do: 'Run the script and watch for any failures or duplicate-name errors.' },
          { do: 'List the new accounts.', cmdlet: 'Get-ADUser' },
          { do: 'Check that a sample account is in its role group.', cmdlet: 'Get-ADPrincipalGroupMembership', example: 'Get-ADPrincipalGroupMembership -Identity ana.smith' },
        ],
        verify:
          'Get-ADUser shows ten new accounts, one per department. Get-ADPrincipalGroupMembership ' +
          'on a sample shows the role group matching their department.',
        interview:
          '"How do you bulk-provision accounts?" From a CSV or HR feed, generating usernames, ' +
          'placing the account in the right OU and group, and verifying a sample.',
        reading: 'jml',
        app: 'script-editor',
      },
      {
        id: 'analyst-rbac',
        title: 'Design and enforce RBAC',
        objective: 'Create role groups and make sure people are in the right ones.',
        why:
          'Access goes to groups, people go in groups, and a role is a job that needs a set of ' +
          'entitlements. If a person has a group from a previous team, that is privilege creep ' +
          'and the next access review will find it.',
        steps: [
          { do: 'Create the manager role group for HR.', cmdlet: 'New-ADGroup', example: 'New-ADGroup -Name grp-hr-managers -Description "HR managers with write access" -Path Groups' },
          { do: 'Promote an HR staff member into the manager group.', cmdlet: 'Add-ADGroupMember', example: 'Add-ADGroupMember -Identity cara.reid -Group grp-hr-managers' },
          { do: 'Remove the old group that no longer matches the promoted role.', cmdlet: 'Remove-ADGroupMember', example: 'Remove-ADGroupMember -Identity cara.reid -Group grp-hr-readers' },
          { do: 'Create the HR file share to practise least-privilege file permissions.', cmdlet: 'New-Share', example: 'New-Share -Name HR -Path "C:\\CompanyData\\HR"' },
          { do: 'Grant HR managers Modify access to the share.', cmdlet: 'Grant-SharePermission', example: 'Grant-SharePermission -Name HR -Trustee grp-hr-managers -Access Modify' },
          { do: 'Grant HR staff Read access to the share.', cmdlet: 'Grant-SharePermission', example: 'Grant-SharePermission -Name HR -Trustee grp-hr-readers -Access Read' },
          { do: 'Deny the IT admin group access to the HR share.', cmdlet: 'Grant-SharePermission', example: 'Grant-SharePermission -Name HR -Trustee grp-iam-admins -Access Full -Type Deny' },
          { do: 'Read the membership to confirm the move is clean.', cmdlet: 'Get-ADPrincipalGroupMembership', example: 'Get-ADPrincipalGroupMembership -Identity cara.reid' },
          { do: 'Check the effective access for an HR staff member.', cmdlet: 'Get-EffectiveAccess', example: 'Get-EffectiveAccess -Name HR -Identity ana.smith' },
        ],
        verify:
          'Get-ADPrincipalGroupMembership for each sample user shows only the groups for their ' +
          'current department and role. Old group membership is gone.',
        interview:
          '"What is privilege creep and how do you stop it?" Old access that never got removed. ' +
          'Stop it by removing the old groups on a mover and reviewing periodically.',
        reading: 'groups-not-people',
        app: 'active-directory',
      },
      {
        id: 'analyst-policy',
        title: 'Enforce password and lockout policies',
        objective: 'Set the company password and account lockout policy and prove they are active.',
        why:
          'Policies only matter if the directory enforces them. A new-hire guide is not enough; ' +
          'the password length, complexity, age and lockout threshold are checked on every reset.',
        steps: [
          { do: 'Open the terminal and review the current password policy.', app: 'terminal' } as ManualStep,
          { do: 'Set the minimum password length to 14, require complexity and a 90-day age.', cmdlet: 'Set-PasswordPolicy', example: 'Set-PasswordPolicy -MinimumLength 14 -ComplexityEnabled $true -MaximumAge 90' },
          { do: 'Confirm the policy is in force.', cmdlet: 'Get-PasswordPolicy' },
          { do: 'Set the lockout threshold to 5 failed attempts for 30 minutes.', cmdlet: 'Set-AccountLockoutPolicy', example: 'Set-AccountLockoutPolicy -Threshold 5 -Duration 30' },
          { do: 'Confirm the lockout policy is in force.', cmdlet: 'Get-AccountLockoutPolicy' },
          { do: 'Try creating a test account with a weak password to see the policy reject it.', cmdlet: 'New-ADUser', example: 'New-ADUser -Name test.user -AccountPassword weak' },
        ],
        verify:
          'Get-PasswordPolicy returns min 14, complexity true, max age 90. Get-AccountLockoutPolicy ' +
          'returns threshold 5 and duration 30. The weak test password was rejected.',
        interview:
          '"What is the difference between a password policy and an account lockout policy?" ' +
          'Password policy controls the password itself; lockout policy controls what happens ' +
          'after repeated failed sign-ins.',
        reading: 'jml',
        app: 'terminal',
      },
      {
        id: 'analyst-shares',
        title: 'Secure file shares with least privilege',
        objective: 'Create a share, set Allow and Deny permissions, and verify effective access.',
        why:
          'File shares are where least privilege is most often wrong. An analyst must be able to ' +
          'read the explicit permissions, resolve group membership, and see that Deny wins over ' +
          'every Allow that would otherwise apply.',
        steps: [
          { do: 'Open the terminal and create the HR share.', app: 'terminal' } as ManualStep,
          { do: 'Create the HR file share.', cmdlet: 'New-Share', example: 'New-Share -Name HR -Path "C:\\CompanyData\\HR"' },
          { do: 'Grant HR managers Modify access.', cmdlet: 'Grant-SharePermission', example: 'Grant-SharePermission -Name HR -Trustee grp-hr-managers -Access Modify' },
          { do: 'Grant HR staff Read access.', cmdlet: 'Grant-SharePermission', example: 'Grant-SharePermission -Name HR -Trustee grp-hr-readers -Access Read' },
          { do: 'Deny the IT admin group access to the HR share.', cmdlet: 'Grant-SharePermission', example: 'Grant-SharePermission -Name HR -Trustee grp-iam-admins -Access Full -Type Deny' },
          { do: 'Check the effective access for an HR staff member.', cmdlet: 'Get-EffectiveAccess', example: 'Get-EffectiveAccess -Name HR -Identity ana.smith' },
          { do: 'Check the effective access for a member of the IT admin group.', cmdlet: 'Get-EffectiveAccess', example: 'Get-EffectiveAccess -Name HR -Identity ben.okafor' },
        ],
        verify:
          'Get-EffectiveAccess shows ana.smith has Read, an HR manager has Modify, and an IT admin ' +
          'is denied. The Deny permission overrides group membership that would otherwise grant access.',
        interview:
          '"Why does Deny take precedence over Allow?" Because explicit exclusions must win over ' +
          'broad group grants, otherwise you cannot block a group from sensitive data.',
        reading: 'least-privilege',
        app: 'terminal',
      },
      {
        id: 'analyst-audit',
        title: 'Audit access and report the risk',
        objective: 'Read the audit log, export the evidence, and remediate a privilege-creep finding.',
        why:
          'An IAM analyst is expected to find the risks the directory hides: failed logins, ' +
          'unexpected group memberships, and people whose groups do not match their department. ' +
          'The evidence must be exportable and verifiable by another person.',
        steps: [
          { do: 'Open Log Search and look for failed sign-in attempts.', app: 'log-search' } as ManualStep,
          { do: 'Read the audit log from the shell for the last 40 events.', cmdlet: 'Get-IamAuditLog', example: 'Get-IamAuditLog -Last 40' },
          { do: 'List any standing privileged assignments as part of the risk report.', cmdlet: 'Get-PimStandingPrivilege' },
          { do: 'Export failed sign-in and group-change events to CSV for spreadsheet analysis.', cmdlet: 'Export-IamAuditLog', example: 'Export-IamAuditLog -Filter signin.failure -Last 50' },
          { do: 'Open the exported CSV in Sheets and count failures with a formula.', app: 'sheets' } as ManualStep,
          { do: 'Simulate a privilege-creep finding by adding an IT user to an HR group.', cmdlet: 'Add-ADGroupMember', example: 'Add-ADGroupMember -Identity ben.okafor -Group grp-hr-readers' },
          { do: 'Read the membership of the user and spot the wrong group.', cmdlet: 'Get-ADPrincipalGroupMembership', example: 'Get-ADPrincipalGroupMembership -Identity ben.okafor' },
          { do: 'Remove the group that does not match the user\'s department.', cmdlet: 'Remove-ADGroupMember', example: 'Remove-ADGroupMember -Identity ben.okafor -Group grp-hr-readers' },
          { do: 'Open the Writer and start an Access Review summary.', app: 'writer' } as ManualStep,
          { do: 'Document the finding, the evidence, and the remedial action.' },
        ],
        verify:
          'The report names the user, the unexpected group, the exported CSV, and the action that ' +
          'removed it. Every claim is tied to a timestamped log entry.',
        interview:
          '"How do you prove a privilege-creep finding?" With an audit event, an exported log, the ' +
          'current group membership, and the action that removed the access.',
        reading: 'access-reviews',
        app: 'log-search',
      },
      {
        id: 'analyst-dormant',
        title: 'Find dormant accounts',
        objective: 'Identify accounts that have never signed in or have been inactive for a set period.',
        why:
          'Dormant accounts are a common access-review finding. An analyst must be able to query ' +
          'the last sign-in, distinguish never-used from stale, and document the risk for the ' +
          'auditor or the access-review campaign.',
        steps: [
          { do: 'Open the terminal and review the account list.', app: 'terminal' } as ManualStep,
          { do: 'List accounts that have not signed in for the last 90 days.', cmdlet: 'Get-DormantAccount', example: 'Get-DormantAccount -Days 90' },
          { do: 'Identify any accounts that have never signed in since they were created.' },
          { do: 'Document one dormant account and the recommended action in the Auditor evidence pack.' },
        ],
        verify:
          'Get-DormantAccount returns at least one account with no recent sign-in. The finding is ' +
          'noted with the username, department and last sign-in date.',
        interview:
          '"How do you decide whether a dormant account is a risk?" By its privilege, department, ' +
          'and whether it was ever used. Never-used and privileged accounts are the highest risk.',
        reading: 'audit-evidence',
        app: 'terminal',
      },
      {
        id: 'analyst-cloud',
        title: 'Verify cloud sync to Entra',
        objective: 'Connect to the Entra tenant, run a sync, and verify the result.',
        why:
          'Most enterprises are hybrid. An IAM analyst must be able to prove that on-prem changes ' +
          'reach the cloud, and that a disabled or deleted on-prem account is reflected in the ' +
          'tenant after the sync cycle.',
        steps: [
          { do: 'Open the cloud identity console and connect to Entra.', app: 'cloud-identity' } as ManualStep,
          { do: 'Connect to the Entra tenant.', cmdlet: 'Connect-Entra' },
          { do: 'Run a directory sync cycle.', cmdlet: 'Start-DirectorySync', example: 'Start-DirectorySync -Provider entra' },
          { do: 'Check a synced account in the cloud tenant.', cmdlet: 'Get-CloudUser', example: 'Get-CloudUser -Provider entra -Upn ben.okafor@omari.test' },
        ],
        verify:
          'Get-CloudUser returns ben.okafor@omari.test with Origin set to synced. Entra is connected ' +
          'and the directory has been pushed successfully.',
        interview:
          '"How do you know a directory sync worked?" By connecting to the tenant, running the sync, ' +
          'and then reading a user whose Origin shows it came from on-prem.',
        reading: 'okta-entra',
        app: 'cloud-identity',
      },
      {
        id: 'analyst-helpdesk',
        title: 'Resolve common helpdesk issues',
        objective: 'Unlock an account and investigate an access-denied report.',
        why:
          'The two most common helpdesk calls are "I cannot sign in" and "I cannot reach this". ' +
          'The first needs the failures read before the unlock, and the second needs the group ' +
          'membership read before the change.',
        steps: [
          { do: 'Open the Ticket Queue and find the locked-out account.', app: 'ticket-console' } as ManualStep,
          { do: 'Confirm the locked-out account in Active Directory.', cmdlet: 'Get-ADUser' },
          { do: 'Read the sign-in failures in the log before unlocking.', cmdlet: 'Get-IamAuditLog', example: 'Get-IamAuditLog -Last 20' },
          { do: 'Unlock the account with the user name from the queue.', cmdlet: 'Unlock-ADAccount' },
          { do: 'Investigate the access-denied report by checking effective access.', cmdlet: 'Get-EffectiveAccess', example: 'Get-EffectiveAccess -Name HR -Identity greta.olsen' },
          { do: 'Add the missing group or remove the one that is blocking access.', cmdlet: 'Add-ADGroupMember', example: 'Add-ADGroupMember -Identity greta.olsen -Group grp-hr-readers' },
        ],
        verify:
          'The account is unlocked and signs in again, and the user in the access-denied report ' +
          'now has the correct groups for their task.',
        interview:
          '"A user cannot access a share. What do you check?" The group membership, not the ' +
          'account status, and whether the group has the right share permission.',
        reading: 'lockouts',
        app: 'active-directory',
      },
      {
        id: 'analyst-docs',
        title: 'Document the work for an auditor',
        objective: 'Write an offboarding SOP, a password guide and an auditor evidence pack.',
        why:
          'The job is not only doing the work; it is producing something another person can ' +
          'follow and audit. A runbook written in the first person and missing the rollback is ' +
          'not a control. Each document is a portfolio artifact that proves the analyst can ' +
          'communicate risk and evidence.',
        steps: [
          { do: 'Open Writer and start the IAM Analyst offboarding SOP.', app: 'writer' } as ManualStep,
          { do: 'Complete each section with the steps, evidence checks and escalation path.' },
          { do: 'Create the new-hire password training guide in the same way.' },
          { do: 'Start the Auditor evidence review template and document a privilege-creep or dormant-account finding, the log evidence and the remediation.' },
          { do: 'Save all three documents in Writer and check the Lab Plan for completion.' },
        ],
        verify:
          'All three documents are saved in Writer and the Lab Plan shows the documentation ' +
          'lesson complete. The SOP contains the exact offboarding order, the guide lists the ' +
          'policy requirements, and the evidence pack ties a finding to a timestamped log.',
        interview:
          '"Why does an IAM analyst write procedures?" Because access work is reviewed by ' +
          'auditors, and evidence is what makes a claim believable.',
        reading: 'jml',
        app: 'writer',
      },
    ],
  },
  {
    id: 'year-1',
    title: 'Year 1 · Help Desk and Workstation Foundations',
    summary:
      'Workstation, network, Windows administration, Group Policy, PowerShell discovery and ' +
      'help-desk tickets — the foundation for every later IAM lab.',
    lessons: [
      {
        id: 'y1-host',
        title: 'Host and Hyper-V readiness',
        objective: 'Review the OMARI lab prerequisites before building the real Hyper-V VMs.',
        why:
          'A simulated desktop is not a substitute for a real domain. The help-desk and IAM work ' +
          'that follows depends on a host that can run Hyper-V, a private switch, and a domain ' +
          'controller. Knowing how to check those prerequisites is the first step.',
        steps: [
          { do: 'Open the Career Lab and read the Year 1 overview.', app: 'career-lab' } as ManualStep,
          { do: 'Open the omari-lab README and note the host requirements.' },
          { do: 'Review the Test-HostReadiness script in File Explorer.' },
          { do: 'Sign in to the simulated workstation to begin the lab.', cmdlet: 'Get-ComputerInfo', example: 'Get-ComputerInfo' },
        ],
        verify:
          'The Career Lab is open, the README is located, and Get-ComputerInfo reports the ' +
          'simulated OMARI-WS01 identity.',
        interview:
          '"What would stop you from building a Hyper-V lab on a workstation?" Virtualisation must ' +
          'be enabled in BIOS, Hyper-V must be installed, and there must be enough RAM and disk for ' +
          'a domain controller and a client.',
        app: 'career-lab',
      },
      {
        id: 'y1-network',
        title: 'Network connectivity and name resolution',
        objective: 'Test basic network reachability and DNS resolution for OMARI hosts.',
        why:
          'Most "cannot sign in" and "drive is not available" tickets are network or DNS problems ' +
          'before they are identity problems. Ping, nslookup and the network mindset come first.',
        steps: [
          { do: 'Ping the simulated default gateway to confirm the switch is up.', cmdlet: 'Test-Connection', example: 'Test-Connection -Target 10.10.10.1' },
          { do: 'Resolve the domain controller by name.', cmdlet: 'Resolve-DnsName', example: 'Resolve-DnsName -Name dc01.omari.test' },
          { do: 'Compare the result to the IP address shown in the network diagram.' },
        ],
        verify:
          'The ping succeeds and Resolve-DnsName returns 10.10.10.10 for the domain controller.',
        interview:
          '"A user cannot reach an internal host by name but can reach it by IP. What is the most ' +
          'likely cause?" DNS resolution. The client is not using the domain controller as a DNS ' +
          'server, or the record is missing.',
        app: 'terminal',
      },
      {
        id: 'y1-windows',
        title: 'Windows administration basics',
        objective: 'Inspect the simulated workstation, its services, processes and security log.',
        why:
          'An IAM analyst is often asked to explain why an account is failing, why a service will ' +
          'not start, or whether an event log shows an attack. Windows admin literacy is the ' +
          'foundation of that explanation.',
        steps: [
          { do: 'Review the computer identity and operating system.', cmdlet: 'Get-ComputerInfo' },
          { do: 'List the critical services and check that AD and DNS are running.', cmdlet: 'Get-Service', example: "Get-Service -Name 'AD WS'" },
          { do: 'Look at recent processes to spot anything unusual.', cmdlet: 'Get-Process', example: 'Get-Process -Name svchost' },
          { do: 'Read the security log for sign-in and group-change events.', cmdlet: 'Get-EventLog', example: 'Get-EventLog -LogName Security' },
        ],
        verify:
          'Get-Service shows AD WS and DNS running, Get-Process returns a filtered list, and the ' +
          'security log shows recent sign-in and group-change events.',
        interview:
          '"Where would you look first if an account keeps locking out?" The security log for ' +
          'event 4625, and then the services that handle authentication.',
        app: 'terminal',
      },
      {
        id: 'y1-gpo',
        title: 'Group Policy overview',
        objective: 'Review the baseline group policies that apply to OMARI users and computers.',
        why:
          'Group Policy is how AD enforces password, lockout, drive maps and many security ' +
          'settings. An IAM analyst who cannot read a GPO cannot explain why access behaves the way ' +
          'it does.',
        steps: [
          { do: 'List the baseline group policy objects.', cmdlet: 'Get-GpoReport', example: 'Get-GpoReport' },
          { do: 'Filter to the password and lockout baseline.', cmdlet: 'Get-GpoReport', example: 'Get-GpoReport -Name Baseline' },
          { do: 'Compare the simulated policy to the values set in the IAM Range manual.' },
        ],
        verify:
          'Get-GpoReport lists Baseline, Drive Maps and AppLocker, and the Baseline policy shows ' +
          'password and lockout settings.',
        interview:
          '"How does Group Policy affect an IAM analyst?" It enforces the password and lockout ' +
          'policy that the analyst sees in the password-reset and account-unlock tickets.',
        app: 'terminal',
      },
      {
        id: 'y1-powershell',
        title: 'PowerShell help and discovery',
        objective: 'Learn how to discover cmdlets and read their syntax in the terminal.',
        why:
          'The terminal in this lab has a fixed set of cmdlets, but a real Windows admin must be ' +
          'able to discover commands. Get-Help and Get-Command are the two discovery tools to start ' +
          'with.',
        steps: [
          { do: 'Open the terminal and get help for New-ADUser.', cmdlet: 'Get-Help', example: 'Get-Help -Name New-ADUser' },
          { do: 'List every available command and search for one that works with groups.', cmdlet: 'Get-Command', example: 'Get-Command -Name *Group*' },
        ],
        verify:
          'Get-Help returns the synopsis for New-ADUser, and Get-Command returns the AD group ' +
          'cmdlets in the registry.',
        interview:
          '"You do not know the exact cmdlet to add a user to a group. What do you do first?" Use ' +
          'Get-Help or Get-Command to find Add-ADGroupMember and read its parameters.',
        app: 'terminal',
      },
      {
        id: 'y1-helpdesk',
        title: 'Help-desk ticket practice',
        objective: 'Resolve common help-desk tickets using the simulated queue.',
        why:
          'Many IAM analysts start on a help desk. The tickets they see — lockouts, password ' +
          'resets, group membership, disabled accounts — are the same symptoms that later become ' +
          'identity-governance findings.',
        steps: [
          { do: 'Open the Ticket Queue and review the open help-desk tickets.', app: 'ticket-console' } as ManualStep,
          { do: 'Find a locked-out account and check the audit log for failures.', cmdlet: 'Get-ADUser' },
          { do: 'Unlock the account and clear the failure count.', cmdlet: 'Unlock-ADAccount' },
          { do: 'Resolve a wrong-group ticket by adding or removing the right group.', cmdlet: 'Add-ADGroupMember' },
        ],
        verify:
          'Two help-desk tickets are resolved, one lockout is cleared, and one group membership is ' +
          'corrected.',
        interview:
          '"What is the difference between a disabled account and a locked account?" Disabled is ' +
          'administrative; locked is the result of too many bad passwords and usually clears ' +
          'automatically or with an unlock.',
        app: 'ticket-console',
      },
      {
        id: 'y1-capstone',
        title: 'Year 1 capstone: document and escalate',
        objective: 'Write an incident report and export an evidence pack from the Lab Plan.',
        why:
          'The help-desk stage teaches the habit of evidence. Before moving to Year 2, the learner ' +
          'produces an incident report and a Lab Plan evidence pack that an interviewer or auditor ' +
          'could review.',
        steps: [
          { do: 'Open Writer and write a short incident report for one of the help-desk tickets.', app: 'writer' } as ManualStep,
          { do: 'Include the symptoms, the evidence, the fix, and the verification.' },
          { do: 'Open the Lab Plan and export the evidence pack for the course.', app: 'lab-plan' } as ManualStep,
          { do: 'Save the pack to the Documents folder and check that the Year 1 capstone is marked done.' },
        ],
        verify:
          'Writer contains an incident report and the Lab Plan evidence pack is exported to ' +
          'Documents.',
        interview:
          '"Why does an IAM analyst keep evidence of a help-desk fix?" Because the same account ' +
          'might be involved in a later access review, audit or security incident.',
        app: 'lab-plan',
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
