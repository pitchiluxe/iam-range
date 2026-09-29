# Lab 13 — Capstone & Job-Ready

**Days 85–90 · Phase 4: Job-Ready · Repo:** `iam-90-day-capstone` + profile README

## Do this lab in the app

The end-to-end run happens in the `omari.test` domain. Jordan Lee's whole life:

```powershell
New-ADUser -Name "Jordan Lee" -GivenName Jordan -Surname Lee -SamAccountName jordan.lee -Department Finance -Path "OU=Employees,OU=Challenge90,DC=omari,DC=test" -AccountPassword (ConvertTo-SecureString "Lab13-Welcome!" -AsPlainText -Force) -ChangePasswordAtLogon $true -Enabled $true
Add-ADGroupMember -Identity Finance-Team -Members jordan.lee
Start-DirectorySync -Provider entra
New-PimEligibility -Identity jordan.lee -Role role-finance-reports
Enable-PimRole -Identity jordan.lee -Role role-finance-reports -Minutes 15 -Justification "REQ-0100 capstone"
Get-PimAssignment -Identity jordan.lee
Remove-ADGroupMember -Identity Finance-Team -Members jordan.lee
Add-ADGroupMember -Identity Sales-Team -Members jordan.lee
Move-ADObject -Identity jordan.lee -TargetDepartment Sales
Remove-ADGroupMember -Identity Sales-Team -Members jordan.lee
Disable-ADAccount -Identity jordan.lee -Reason "REQ-0101 capstone leaver"
Move-ADObject -Identity jordan.lee -TargetPath "OU=Disabled,OU=Challenge90,DC=omari,DC=test"
Revoke-UserSession -Identity jordan.lee
Start-DirectorySync -Provider entra
Get-IamAuditLog -Last 40
```

Between steps: sign out and sign in as Jordan once (forced password change),
run a ticket in **PowerShell (this PC)** for the JIT request, and use
**Access Reviews** to keep Jordan while still in Finance. Record the whole run
with the app's screen recorder. Days 87–90 (portfolio, resume, interviews,
applications) use **Browser** (GitHub, LinkedIn), **Writer**, **Sheets** and
**Interview**.

## Career objective

Prove the whole lifecycle works as one system, then package twelve weeks of
work so a recruiter understands it in 30 seconds and a hiring manager can go
deep for 30 minutes.

## Quick review

1. Can you draw, from memory, the path from HR feed to disabled leaver across AD and Entra ID?
2. Which of your labs shows least privilege most clearly?
3. What's one thing that broke during the challenge, and how did you find the cause?
4. Which KPI from Lab 12 would you show a CISO?
5. What is the one-line summary of your portfolio?

## Scenario

A hiring manager asks: "Show me one person's whole life in your environment."
You'll run it live — join, request, review, move, leave — with evidence at
every step.

## Hands-on lab

### Day 85–86 — end-to-end run

Work in the app (see "Do this lab in the app" above):

| Step | Lab | Evidence |
|---|---|---|
| 1. HR feed JOINs `jordan.lee` (Finance) | 9 | JML log line, AD object, group |
| 2. Jordan signs in on the app's lock screen, forced password change | 1 | Screenshot |
| 3. Jordan requests `Finance-Reports` via ticket, owner approves, JIT granted | 10, 11 | Ticket history, JIT log |
| 4. Grant expires on its own | 10 | Revoke log line |
| 5. Quarterly review of `Finance-Team` keeps Jordan | 10 | Review CSV |
| 6. HR feed MOVEs Jordan to Sales | 9 | Old group removed |
| 7. HR feed LEAVEs Jordan | 9 | Disabled, no groups, sessions revoked |
| 8. Dashboard reflects all of it | 12 | Screenshot |
| 9. Lockout + diagnostics on the way (optional) | 3 | Report |

Write `RUNBOOK.md` in `iam-90-day-capstone` with each step's command and
evidence link. Record a 5-minute screen video walking through it.

### Day 87 — portfolio polish

For each repo (`iam-ad-enterprise-lab`, `iam-entra-id-lab`,
`iam-graph-automation`, `iam-jml-automation`, `iam-access-governance`,
`iam-90-day-capstone`) the README must have:

1. One-sentence problem statement (business terms, not tool names)
2. Architecture diagram (Mermaid)
3. What you built, as bullets with the skill in bold
4. How to run it (copy-pasteable)
5. One real problem you hit and how you diagnosed it
6. Security notes: no secrets, synthetic data, least privilege choices

Then a **profile README** (`<username>/<username>`) linking all six in a table.
Run a final secret scan on every repo:

```powershell
git log -p | Select-String -Pattern 'client_secret\s*=\s*["''][^<]', 'password\s*=\s*["''][^<]'
```

### Day 88 — resume and LinkedIn

- Collect the 12 resume bullets from Labs 1–12; pick the strongest 6 for a
  *Projects* section titled "IAM Engineering Lab (90 days)".
- Headline: *Junior IAM Engineer | Active Directory · Entra ID · PowerShell · Microsoft Graph · JML · Conditional Access*.
- Pin the capstone repo and the video on LinkedIn *Featured*.

### Day 89 — interview rehearsal

Use the in-app **Interview** window (IAM Range) for drills, then answer these
out loud, 2 minutes each, recording yourself:

1. Onboarding in AD from HR request to first sign-in (Lab 1)
2. Repeated lockouts (Lab 3)
3. AD vs Entra ID (Lab 4)
4. Rolling out MFA without an outage (Lab 5)
5. A developer wants `Directory.ReadWrite.All` (Lab 6)
6. User blocked by Conditional Access (Lab 7)
7. OAuth for a non-technical manager (Lab 8)
8. The most common JML audit failure (Lab 9)
9. Reducing standing privilege (Lab 10)
10. Proving an access grant was approved (Lab 11)
11. Metrics that show an IAM program works (Lab 12)
12. "Tell me about a time something broke" (any lab — use STAR)

### Day 90 — apply

- Target roles: *IAM Analyst*, *Junior IAM Engineer*, *Identity Administrator*,
  *Access Management Analyst*, *IT Security Analyst (Identity)*.
- For each posting, map three of its requirements to three of your labs in the
  cover letter's second paragraph.
- Send 10 applications; track them in the Sheets app (company, role, date,
  link, contact, status, follow-up date).

## Validation checklist

- End-to-end run completed with evidence for all eight steps
- `RUNBOOK.md` and a 5-minute video exist
- Six repo READMEs follow the six-part template; profile README links them
- Secret scan clean on every repo
- Resume + LinkedIn updated
- 12 interview answers recorded; 10 applications sent and tracked

## Challenge

Pick the weakest of your twelve labs (your own feedback notes will tell you
which). Spend 90 minutes improving *that* one — and add a "What I'd do next"
section to its README.

## GitHub assignment

`iam-90-day-capstone`: `RUNBOOK.md`, evidence screenshots, video link,
architecture diagram of the full estate, and `LESSONS.md` — your top ten lessons
from the 90 days.

## Resume bullet

> Completed a 90-day hands-on IAM program: built a hybrid AD/Entra ID
> environment and automated the full identity lifecycle (JML, JIT access,
> access reviews, ticketing, KPI dashboard) with PowerShell and Microsoft
> Graph; six public repositories with runbooks and evidence.

## Interview question

"Walk me through your portfolio." Two minutes: problem → what you built →
the hardest bug → what you'd do next. Then offer the capstone video.

## Homework

Keep going: one small improvement per week, and a short post about each lab on
LinkedIn. Consistent visible work is what gets the first IAM role.
