# 90-Day IAM Job-Ready Challenge

Thirteen one-week labs that take you from Active Directory basics to a
job-ready Junior IAM Engineer portfolio. Open **90-Day Challenge** (📅) on the
IAM Range desktop to see the schedule, today's task, each lab's checklist and
a feedback form; the lab text itself is in `labs/`.

## Environment — everything inside IAM Range

| Labs | Done in | Buttons in the lab |
|---|---|---|
| 1–3, 9–11, 13 | The app's own Active Directory, `omari.test` (`DC=omari,DC=test`), under `OU=Challenge90` | Active Directory, Terminal (AD), PowerShell ISE, Access Reviews, Ticket Queue, Cloud Identity |
| 4–8 | Your real Microsoft Entra ID tenant, in the app's **Browser** (Entra admin center, Azure portal), plus **PowerShell (this PC)** for Microsoft Graph | Entra admin center, Azure portal, My Apps, SAML Toolkit, jwt.ms, Graph Explorer, PowerShell (this PC) |
| 12 | PowerShell (this PC) + your normal browser for `http://localhost:8000` | PowerShell (this PC), Sheets |

Each lab opens with **Do this lab in the app**: which button, which command,
in order. Every Active Directory command in those sections is run through the
app's simulator by the test suite, in lab order, so the steps are known to work.

**PowerShell (this PC)** is real Windows PowerShell running on your computer,
inside the app (desktop app only). Functions and variables persist between
commands; `Read-Host -AsSecureString` shows a masked box; **Stop** ends a
running command. The Microsoft sign-in pages load inside the desktop app's
Browser; the web build cannot frame them and offers **Open ↗** instead.

The *Hands-on lab* sections keep the real-server versions of every script
(`corp.technobiz.local`): write them, commit them to GitHub, and run them on a
real domain controller whenever you have one.

## Active Directory Users and Computers

The **Active Directory** window is built to match the real console
(`dsa.msc` on Windows Server), so the clicks you learn here are the clicks
you make at work:

- **Tree:** `Active Directory Users and Computers [OMARI-DC01.omari.test]` →
  *Saved Queries* and `omari.test` with *Builtin, Computers, Domain
  Controllers, ForeignSecurityPrincipals, Managed Service Accounts, Users*,
  plus every OU you create. CN=Users and Builtin hold the default accounts
  and groups (Domain Admins, Domain Users, krbtgt...).
- **Menus:** File / Action / View / Help, the MMC toolbar, and the real
  right-click menus: *Delegate Control…, Find…, New → Organizational Unit /
  User / Group*, and on a user *Copy…, Add to a group…, Disable Account,
  Reset Password…, Move…, Cut, Delete, Rename, Properties*.
- **Dialogs:** the three-page *New Object - User* wizard, *New Object -
  Group* (scope and type), *New Object - Organizational Unit* (with *Protect
  container from accidental deletion*), *Select Groups* with **Check
  Names**, the *Move* container tree, *Find Users, Contacts, and Groups*,
  and the *Delegation of Control Wizard*.
- **Properties:** General, Address, Account (Unlock account, account
  options, Logon Hours, Account expires), Profile, Telephones, Organization,
  Member Of and the rest. **View → Advanced Features** adds LostAndFound,
  System and the *Object*, *Security* and *Attribute Editor* tabs.
- Drag an object onto an OU (or Cut / Paste) to move it; **View →
  Add/Remove Columns…** and **Action → Export List…** turn the result pane
  into a report.

Every click runs the same capability as the matching cmdlet (`New-ADUser`,
`Set-ADUser -Office`, `Set-ADGroup -GroupScope`, `Rename-ADObject`,
`Move-ADObject`, `Set-ADOrganizationalUnit -ProtectedFromAccidentalDeletion`,
`Grant-IamDelegation`), so the terminal and the console always agree and
both land in `Get-IamAuditLog`. Built-in objects (Domain Admins, Builtin
groups, computers) are shown as a new DC shows them; a CN=Users default group
becomes a real, manageable group the first time you add someone to it.

## Where the mentor conversation's files live

The mentor's final kit (`IAM-Labs/Lab01-AD-Base/...`) names each script
after its job. The labs keep the same scripts with the fixes listed in the
commit history, under a `C90` prefix so no function can be mistaken for a
cmdlet from Microsoft's ActiveDirectory module, and with approved PowerShell
verbs (`Invoke-`, not `Process-`). Name them either way in your repo.

| Conversation file | Lab | Here |
|---|---|---|
| `Lab01-AD-Base/scripts/create-user-and-group.ps1`, `architecture/ad-base.mmd` | 1 | `scripts/New-C90BaseLab.ps1`, `architecture/ad-base.mmd` |
| `Lab02/.../AD-Automation.psm1` (`New-ADUserBulk`, `Disable-ADUserBulk`, `Get-ADUserReport`, `Get-ADGroupMembershipReport`, `New-ADDepartmentGroups`), `Run-Onboarding.ps1`, `new-hires.csv`, `terminations.csv` | 2 | `automation/C90.ADToolkit.psm1` (`New-C90UserBulk`, `Disable-C90UserBulk`, `Get-C90UserReport`, `New-C90DepartmentGroup`), same CSVs |
| `Lab03/.../lockout-investigator.ps1`, `password-policy-check.ps1`, `replication-check.ps1`, `group-access-test.ps1` | 3 | `C90.Diagnostics.ps1`: `Get-C90LockoutReport`, `Get-C90PasswordStatus`, `Test-C90ObjectOnAllDCs`, `Test-C90GroupAccess` |
| `Lab04/.../create-entra-user.ps1` | 4 | `scripts/New-C90CloudUsers.ps1` |
| `Lab05/.../mfa-sso-troubleshooter.ps1` | 5 | `mfa-sso/Get-C90MfaStatus.ps1` |
| `Lab06/.../entra-app-inventory.ps1` | 6 | `apps/Get-C90AppInventory.ps1` |
| `Lab07/.../ca-policy-inventory.ps1` | 7 | `conditional-access/Export-C90CaPolicies.ps1` |
| `Lab08/.../Graph-Automation.psm1`, `Assign-Licenses-By-Dept.ps1`, `new-hires.csv` | 8 | `C90.Graph.psm1` (`Get-C90GraphToken`, `Invoke-C90Graph`, `Set-C90License`, `Add-C90GroupMember`, `Get-C90StaleUsers`), `run.ps1` |
| `Lab09/.../JML-Automation.psm1` (`Process-Joiner/Mover/Leaver`, `Write-JmlLog`), `Process-JML-Feed.ps1`, `jml-feed.csv` | 9 | `C90.Jml.psm1` (`Invoke-C90Joiner/Mover/Leaver`, `Invoke-C90JmlFeed`, `Write-C90JmlLog`), `data/jml-feed.csv` |
| `Lab10/.../Access-Request.psm1`, `Submit-Access-Request.ps1`, `Approve-Request.ps1`, `Revoke-Expired-JIT.ps1`, `Start-Management-Review.ps1`, `requests.csv`, `reviews.csv` | 10 | `C90.Jit.psm1` (`Grant-C90JitAccess`, `Revoke-C90ExpiredAccess`), `jit-grants.csv`, `reviews/<group>-review.csv` |
| `Lab11/.../New-Access-Request.ps1`, `Approve-Access-Request.ps1`, `Close-Access-Request.ps1`, `Review-Access.ps1`, `requests.csv` | 11 | `ticketing/C90.Tickets.psm1` (`New-C90Ticket`, `Set-C90TicketState`, `Complete-C90Ticket`, `Get-C90Tickets`, `Get-C90SlaReport`) |
| `Lab12/dashboards/identity-governance/index.html` (+ date-range filter, print-to-PDF challenge) | 12 | `dashboard/index.html` |

## Schedule

| Days | Lab | Phase | Repo |
|---|---|---|---|
| 1–7 | 1. AD Enterprise Base | AD Foundation | `iam-ad-enterprise-lab` |
| 8–14 | 2. PowerShell AD Automation Toolkit | AD Foundation | `iam-ad-enterprise-lab` |
| 15–21 | 3. AD Troubleshooting Deep Dive | AD Foundation | `iam-ad-enterprise-lab` |
| 22–28 | 4. Entra ID Foundations | Entra ID & Cloud | `iam-entra-id-lab` |
| 29–35 | 5. MFA & SSO | Entra ID & Cloud | `iam-entra-id-lab` |
| 36–42 | 6. Enterprise Apps & App Registrations | Entra ID & Cloud | `iam-entra-id-lab` |
| 43–49 | 7. Conditional Access Deep Dive | Entra ID & Cloud | `iam-entra-id-lab` |
| 50–56 | 8. Microsoft Graph & OAuth | Entra ID & Cloud | `iam-graph-automation` |
| 57–63 | 9. JML Workflow Automation | Lifecycle & Governance | `iam-jml-automation` |
| 64–70 | 10. Just-in-Time Access & Access Reviews | Lifecycle & Governance | `iam-access-governance` |
| 71–77 | 11. Access Request Ticketing | Lifecycle & Governance | `iam-access-governance` |
| 78–84 | 12. Identity Governance Dashboard | Lifecycle & Governance | `iam-access-governance` |
| 85–90 | 13. Capstone & Job-Ready | Job-Ready | `iam-90-day-capstone` |

A standard week (~8 hours): day 1 read + quick review, days 2–4 build, day 5
break it and fix it, day 6 GitHub write-up, day 7 checklist + interview answer
+ feedback.

## Resetting

- **Restart this lab** (feedback panel): the lab starts again *today* with a
  full week; later labs move with it. Only this lab's ticks and feedback clear.
- **Restart challenge…** (top bar): Day 1 becomes today, all 90 days are
  re-dated, and all ticks and feedback clear.
- To reset the directory itself, use **Reset Environment** in the app.

## Giving feedback

At the end of each lab, fill in the feedback panel in the app (repo URL,
what went well, errors, one improvement, difficulty) and click **Copy
feedback**. Paste it to your mentor; the next lab can be adjusted from it.

## Rules

- No real passwords, secrets or personal data in any repo. Prompts and
  environment variables only; synthetic data for anything public.
- Lab 10 Part D (AD Privileged Access Management feature) is **irreversible** —
  optional, snapshot first.
