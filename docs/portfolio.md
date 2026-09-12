# Using IAM Range to build an IAM Analyst portfolio

This lab is not a game; it is a source of artifacts you can show to a hiring
manager. Every command leaves real evidence in the simulated directory. The
artifacts below map directly to the responsibilities in an entry-level IAM
Analyst job description.

## What an IAM Analyst actually does

- Creates and disables accounts from HR/CSV feeds.
- Builds and maintains AD groups and OUs.
- Enforces password and lockout policies.
- Reviews access requests, group memberships and privileged assignments.
- Investigates failed sign-ins and access-denied reports.
- Produces evidence an auditor can read.

## Portfolio artifacts to capture from this lab

Each item below should be exported as a screenshot, a Writer document, or a
spreadsheet formula. Save them in a folder called `iam-range-evidence` and link
to it from your resume or LinkedIn featured section.

### 1. OU and group structure

**What to do:** Complete the `analyst-env` and `analyst-rbac` lessons.

**Evidence:** A screenshot of the Active Directory tree showing `Corp`, `HR`,
`IT`, `Finance`, `Sales`, `Users` and `Groups`, plus the group list with
`grp-hr-managers`, `grp-hr-readers`, `grp-iam-admins`, etc.

**Why it helps:** It shows you can design an administrative boundary before any
account exists.

### 2. Bulk onboarding script

**What to do:** Run the `Bulk onboarding from a CSV list` script in the
PowerShell ISE.

**Evidence:** A before-and-after `Get-ADUser` and `Get-ADGroup` screenshot, plus
the script itself.

**Why it helps:** Hiring managers want to know you can automate provisioning
instead of clicking through GUIs.

### 3. Least-privilege file share

**What to do:** Complete `analyst-shares`.

**Evidence:** Three screenshots or terminal outputs:

- `Grant-SharePermission` showing Allow Read, Allow Modify and Deny Full.
- `Get-EffectiveAccess -Name HR -Identity ana.smith` returning `Read`.
- `Get-EffectiveAccess -Name HR -Identity ben.okafor` returning `Deny`.

**Why it helps:** This is a real interview scenario. Explaining that Deny takes
precedence over Allow is a high-signal answer.

### 4. Password and lockout policy

**What to do:** Complete `analyst-policy`.

**Evidence:** The outputs of `Get-PasswordPolicy` and `Get-AccountLockoutPolicy`
showing the target values (min 14, complexity, 90 days, threshold 5, 30
minutes). Include the failed `New-ADUser` attempt with the weak password.

**Why it helps:** The job description explicitly asked for these values. Your
evidence matches the requirement exactly.

### 5. Privilege-creep finding with audit trail

**What to do:** Complete `analyst-audit`.

**Evidence:** A Writer document or markdown note with:

- The `Add-ADGroupMember` command that simulated the finding.
- The `Get-ADPrincipalGroupMembership` output before removal.
- The `Remove-ADGroupMember` output.
- An `Export-IamAuditLog` CSV filtered to the relevant group changes.

**Why it helps:** Auditors and interviewers both want to see how you connect a
claim to a timestamped log entry.

### 6. Dormant-account risk

**What to do:** Complete `analyst-dormant`.

**Evidence:** The `Get-DormantAccount -Days 90` output and a short note stating
which account is high risk and why.

**Why it helps:** Dormant accounts are a classic access-review finding. Showing
you can query them puts you ahead of candidates who only know the theory.

### 7. Entra ID sync verification

**What to do:** Complete `analyst-cloud`.

**Evidence:** A screenshot of `Get-CloudUser -Provider entra -Upn
ben.okafor@iamlab.com` showing `Origin: synced`.

**Why it helps:** Hybrid identity is the normal enterprise shape. Employers want
analysts who understand on-prem to cloud sync, not just cloud-only administration.

### 8. Offboarding SOP and password guide

**What to do:** Complete `analyst-docs`.

**Evidence:** The saved `IAM Analyst offboarding SOP`, `New-hire password
training guide` and `Auditor evidence pack` from the Writer app.

**Why it helps:** These are the exact documents an IAM analyst writes. A
portfolio without writing samples is incomplete.

## How to present it

1. Create a PDF or markdown file called `IAM-Range-Portfolio.md`.
2. For each artifact, add:
   - The scenario
   - The commands you ran
   - The evidence (screenshot or paste)
   - One sentence on the business outcome
3. Host it on LinkedIn, a GitHub repository, or a personal site.
4. In interviews, walk through one finding from start to finish. Employers
   remember a clean story better than a long list.

## One-line pitch

> "I built a simulated enterprise workstation and used it to demonstrate RBAC,
> privilege-creep remediation, dormant-account review, Entra sync and
> auditor-ready evidence collection."
