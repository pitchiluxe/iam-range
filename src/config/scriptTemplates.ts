/**
 * config/scriptTemplates.ts — the PowerShell automation library.
 *
 * Each template is a working script the learner opens, edits (usually just the
 * name list at the top), and runs. They are the scripts an IAM operator
 * actually keeps in a Scripts folder: bulk intake, offboarding, group
 * membership, credential resets, audit checks.
 *
 * Written so the interesting part is always the first few lines — the array of
 * names — because that is the bit the ticket dictates and the learner retypes.
 */

export interface ScriptTemplate {
  id: string;
  name: string;
  /** One line describing when an operator reaches for this. */
  purpose: string;
  /** Ticket kinds this automates, for the gallery's grouping. */
  category: 'provisioning' | 'offboarding' | 'access' | 'credentials' | 'audit';
  body: string;
}

export const SCRIPT_TEMPLATES: readonly ScriptTemplate[] = [
  {
    id: 'bulk-new-hires',
    name: 'Bulk onboarding — new hires',
    purpose: 'Create accounts for a batch of joiners and put them in their department group.',
    category: 'provisioning',
    body: `# Bulk onboarding
# Paste the usernames from the ticket between the quotes, comma separated.
# Everything below the list can stay as it is.

$names = @(
  'ana.silva',
  'ben.okafor',
  'cara.reid'
)

foreach ($n in $names) {
  New-ADUser -SamAccountName $n -Name $n -Department Finance -Title Analyst
  Add-ADGroupMember -Identity $n -Group grp-finance-payroll
}

# Check the result
Get-ADUser -Department Finance
`,
  },
  {
    id: 'bulk-interns',
    name: 'Bulk onboarding — interns (least privilege)',
    purpose: 'Provision short-term staff with read-only access only.',
    category: 'provisioning',
    body: `# Summer intake — interns get the read-only group, nothing else.
# Least privilege: do NOT add these to grp-finance-payroll.

$interns = @(
  'sam.oduya',
  'lena.hart',
  'raj.mehta'
)

foreach ($i in $interns) {
  New-ADUser -SamAccountName $i -Name $i -Department Engineering -Title Intern
  Add-ADGroupMember -Identity $i -Group grp-hr-readers
}

Get-ADUser -Department Engineering
`,
  },
  {
    id: 'bulk-offboard',
    name: 'Bulk offboarding — leavers',
    purpose: 'Disable accounts and kill live sessions for a batch of departures.',
    category: 'offboarding',
    body: `# Offboarding batch.
# Disable first, THEN revoke sessions — a disabled account with a live session
# can still be used until that session is killed.

$leavers = @(
  'dan.rivera'
)

foreach ($l in $leavers) {
  Disable-ADAccount -Identity $l -Reason "Offboarded per ticket"
  Revoke-UserSession -Identity $l
}

Get-IamAuditLog -Last 20
`,
  },
  {
    id: 'bulk-group-add',
    name: 'Grant group access to a batch',
    purpose: 'Add several people to one group after an approved access request.',
    category: 'access',
    body: `# Approved access request — add the listed people to one group.

$members = @(
  'cara.patel',
  'erin.cho'
)

foreach ($m in $members) {
  Add-ADGroupMember -Identity $m -Group grp-finance-payroll
}

Get-ADGroupMember
`,
  },
  {
    id: 'bulk-group-remove',
    name: 'Revoke group access (access review)',
    purpose: 'Strip memberships flagged as excessive during a review.',
    category: 'access',
    body: `# Access review remediation — remove the flagged memberships.

$flagged = @(
  'alex.morgan',
  'bob.sato'
)

foreach ($f in $flagged) {
  Remove-ADGroupMember -Identity $f -Group grp-finance-payroll
}

Get-IamAuditLog -Last 20
`,
  },
  {
    id: 'bulk-password-reset',
    name: 'Bulk password reset',
    purpose: 'Reset credentials after a leak, forcing a change at next sign-in.',
    category: 'credentials',
    body: `# Credential rotation after a suspected leak.
# ChangePasswordAtLogon means the temporary password cannot be kept.

$affected = @(
  'greta.olsen',
  'cara.patel'
)

foreach ($a in $affected) {
  Set-ADAccountPassword -Identity $a -NewPassword "TempPass!2026#" -ChangePasswordAtLogon
}

Get-IamAuditLog -Last 20
`,
  },
  {
    id: 'unlock-and-verify',
    name: 'Unlock accounts and verify',
    purpose: 'Clear lockouts, then confirm the accounts are back in service.',
    category: 'credentials',
    body: `# Lockout remediation.
# Unlock-ADAccount only clears a LOCKED account — a disabled one needs
# Enable-ADAccount, which is a different decision with a different approval.

$locked = @(
  'greta.olsen'
)

foreach ($u in $locked) {
  Unlock-ADAccount -Identity $u
}

Get-ADUser
`,
  },
  {
    id: 'mfa-reset-batch',
    name: 'Reset MFA for a batch',
    purpose: 'Clear MFA registrations so users can re-enrol on a new device.',
    category: 'credentials',
    body: `# MFA device replacement.
# Clearing the registration lets the user enrol again; it does not disable MFA.

$users = @(
  'finn.muller'
)

foreach ($u in $users) {
  Reset-MfaRegistration -Identity $u
  Set-MfaMethod -Identity $u -Method totp
}

Get-ADUser
`,
  },
  {
    id: 'audit-review',
    name: 'Audit check — who did what',
    purpose: 'Pull the recent audit trail and the current account state for evidence.',
    category: 'audit',
    body: `# Evidence gathering.
# Run this after making changes so the log shows the before/after.

Get-IamAuditLog -Last 40
Get-ADUser
Get-ADGroup
Get-UserSession
`,
  },
  {
    id: 'bulk-onboarding-csv',
    name: 'Bulk onboarding from a CSV list',
    purpose: 'Create 10 fictional employees from a list and place them in department OUs and groups.',
    category: 'provisioning',
    body: `# Bulk onboarding from a CSV-style list.
# In production this data would come from Import-Csv. Here it is split by
# department so the simulated shell can create the accounts in the right
# OU and assign the right role group. Add or remove names as needed.

$hrUsers = @(
  'ana.smith'
  'cara.reid'
)

$itUsers = @(
  'ben.okafor'
  'dan.rivera'
)

$financeUsers = @(
  'elena.voss'
  'finn.muller'
)

$salesUsers = @(
  'greta.olsen'
  'henry.tan'
)

$helpdeskUsers = @(
  'isabel.martinez'
  'james.nguyen'
)

# Create the role groups in the Groups OU. Run the analyst-env lesson first
# so the Groups OU exists.
New-ADGroup -Name grp-hr-readers -Description "HR read access" -Path Groups
New-ADGroup -Name grp-iam-admins -Description "IT admin access" -Path Groups
New-ADGroup -Name grp-finance-payroll -Description "Finance payroll access" -Path Groups
New-ADGroup -Name grp-sales-readers -Description "Sales read access" -Path Groups
New-ADGroup -Name grp-helpdesk-tier1 -Description "Help Desk tier 1" -Path Groups

foreach ($n in $hrUsers) {
  New-ADUser -SamAccountName $n -Name $n -Department HR -Title "HR Staff" -Path Users -AccountPassword "TempPass!2026##" -ChangePasswordAtLogon
  Add-ADGroupMember -Identity $n -Group grp-hr-readers
}

foreach ($n in $itUsers) {
  New-ADUser -SamAccountName $n -Name $n -Department IT -Title "IT Admin" -Path Users -AccountPassword "TempPass!2026#" -ChangePasswordAtLogon
  Add-ADGroupMember -Identity $n -Group grp-iam-admins
}

foreach ($n in $financeUsers) {
  New-ADUser -SamAccountName $n -Name $n -Department Finance -Title "Finance Analyst" -Path Users -AccountPassword "TempPass!2026#" -ChangePasswordAtLogon
  Add-ADGroupMember -Identity $n -Group grp-finance-payroll
}

foreach ($n in $salesUsers) {
  New-ADUser -SamAccountName $n -Name $n -Department Sales -Title "Sales Rep" -Path Users -AccountPassword "TempPass!2026#" -ChangePasswordAtLogon
  Add-ADGroupMember -Identity $n -Group grp-sales-readers
}

foreach ($n in $helpdeskUsers) {
  New-ADUser -SamAccountName $n -Name $n -Department "Help Desk" -Title "Service Desk Analyst" -Path Users -AccountPassword "TempPass!2026#" -ChangePasswordAtLogon
  Add-ADGroupMember -Identity $n -Group grp-helpdesk-tier1
}

Get-ADUser
Get-ADGroup
`,
  },
];

/** Templates the learner saved themselves, kept in the browser. */
const SAVED_KEY = 'script_templates_saved';

export interface SavedScript {
  id: string;
  name: string;
  body: string;
  savedAt: number;
}

export function loadSavedScripts(): SavedScript[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    return raw ? (JSON.parse(raw) as SavedScript[]) : [];
  } catch {
    return [];
  }
}

export function saveScript(name: string, body: string): SavedScript {
  const entry: SavedScript = {
    id: `saved-${Date.now().toString(36)}`,
    name,
    body,
    savedAt: Date.now(),
  };
  const all = [...loadSavedScripts(), entry];
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(all));
  } catch {
    /* quota — the script stays usable in the editor regardless */
  }
  return entry;
}

export function deleteSavedScript(id: string): void {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(loadSavedScripts().filter((s) => s.id !== id)));
  } catch {
    /* ignore */
  }
}
