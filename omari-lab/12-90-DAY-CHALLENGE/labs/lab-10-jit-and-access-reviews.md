# Lab 10 — Just-in-Time Access & Access Reviews

**Days 64–70 · Phase 3: Lifecycle & Governance · Repo:** `iam-access-governance`

## Do this lab in the app

The app has privileged identity management (PIM) built in: time-bound role
activation that expires by itself. That is the JIT half of this lab.

**JIT access** — a role that grants the Finance reports share, eligible but not active:

```powershell
New-ADGroup -Name Finance-Reports -GroupScope Global -GroupCategory Security -Path "OU=Groups,OU=Challenge90,DC=omari,DC=test" -Description "Finance reporting share (JIT only)"
New-Share -Name FinanceReports -Path "C:\Shares\FinanceReports"
Grant-SharePermission -Name FinanceReports -Trustee Finance-Reports -Access Modify
New-IamRole -Name role-finance-reports -Description "JIT access to Finance reports"
New-PimEligibility -Identity alex.rivera -Role role-finance-reports
Get-PimAssignment -Identity alex.rivera
```

Alex asks for access; the owner (sarah.johnson) approves in the ticket; Alex
activates for 15 minutes with a justification:

```powershell
Enable-PimRole -Identity alex.rivera -Role role-finance-reports -Minutes 15 -Justification "REQ-0001 Q3 audit sample"
Get-PimAssignment -Identity alex.rivera
Get-PimStandingPrivilege
```

Come back after 15 minutes: `Get-PimAssignment -Identity alex.rivera` shows it
expired with nobody touching it. `Get-IamAuditLog -Last 20` is your evidence of
grant *and* expiry.

Finished before the window closes? Give the access back — least privilege is
also ending it early:

```powershell
Disable-PimRole -Identity alex.rivera -Role role-finance-reports
Get-PimAssignment -Identity alex.rivera
```

**Access review** — open **Access Reviews** on the desktop, start a campaign
for `Finance-Team`, and decide each member (add `alex.rivera` to the group
first so there's a wrong member to find):

```powershell
Add-ADGroupMember -Identity Finance-Team -Members alex.rivera
Get-ADGroupMember Finance-Team
```

Apply the *Remove* decision, then prove it happened:
`Get-ADGroupMember Finance-Team` and `Get-IamAuditLog -Last 10`.

Write `C90.Jit.psm1` from the reference below in **PowerShell ISE** and commit
it — it is the same control on a real domain without PIM.

## Career objective

Replace standing access with time-bound access that removes itself, and run an
access review whose decisions are actually applied — the two controls auditors
ask about most after JML.

## Quick review

1. Standing privilege vs just-in-time: what risk does JIT remove?
2. Who should approve access to a resource: IT, the requester's manager, or the resource owner?
3. What must happen to a *Remove* decision in an access review, and how fast?
4. Why is "reviewer approved everything in 30 seconds" a finding?
5. What evidence proves a JIT grant expired?

## Scenario

Alex needs `Finance-Reports` access for a 4-hour audit task. Finance's owner
approves. Access must disappear on its own. Separately, Finance wants a
quarterly review of `Finance-Team` with decisions applied the same day.

## Concept

```
Request ─► Approve (owner) ─► Grant (group add + expiry recorded)
                                   │
          Scheduled task every 15 min: expired? ─► Remove ─► log
Review: export members ─► owner decides Keep/Remove ─► apply ─► evidence
```

## Hands-on lab

### Part A — resources and owners

```powershell
$Root = 'OU=Challenge90,DC=corp,DC=technobiz,DC=local'
New-ADGroup Finance-Reports -GroupScope Global -GroupCategory Security -Path "OU=Groups,$Root" `
    -ManagedBy (Get-ADUser sarah.johnson).DistinguishedName -Description 'Finance reporting share (JIT only)'
New-Item C:\Shares\FinanceReports -ItemType Directory -Force
New-SmbShare -Name FinanceReports -Path C:\Shares\FinanceReports -FullAccess 'CORP\Domain Admins' -ChangeAccess 'CORP\Finance-Reports'
```

`ManagedBy` is the resource owner — the only valid approver.

### Part B — JIT module (`C90.Jit.psm1`)

```powershell
#Requires -Modules ActiveDirectory
$Script:Store = 'C:\C90\jit-grants.csv'
$Script:Log   = 'C:\C90\jit.log'
New-Item -ItemType Directory -Force C:\C90 | Out-Null

function Write-JitLog([string]$m) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $m" | Add-Content $Script:Log }

function Grant-C90JitAccess {
    param(
        [Parameter(Mandatory)][string]$User, [Parameter(Mandatory)][string]$Group,
        [Parameter(Mandatory)][string]$ApprovedBy, [Parameter(Mandatory)][string]$Justification,
        [ValidateRange(0.25, 72)][double]$Hours = 4
    )
    $g = Get-ADGroup $Group -Properties ManagedBy
    $owner = if ($g.ManagedBy) { (Get-ADUser $g.ManagedBy).SamAccountName }
    if ($ApprovedBy -ne $owner) { throw "Only the owner ($owner) can approve access to $Group" }
    if ($ApprovedBy -eq $User)  { throw 'Requester cannot approve their own access' }   # separation of duties

    Add-ADGroupMember $Group -Members $User
    $grant = [pscustomobject]@{
        Id = [guid]::NewGuid().ToString('N').Substring(0, 8); User = $User; Group = $Group
        ApprovedBy = $ApprovedBy; Justification = $Justification
        GrantedAt = (Get-Date).ToString('o'); ExpiresAt = (Get-Date).AddHours($Hours).ToString('o')
        Status = 'Active'; RevokedAt = ''
    }
    $grant | Export-Csv $Script:Store -NoTypeInformation -Append
    Write-JitLog "GRANT $($grant.Id) $User -> $Group until $($grant.ExpiresAt) by $ApprovedBy"
    $grant
}

function Revoke-C90ExpiredAccess {
    if (-not (Test-Path $Script:Store)) { return }
    $grants = @(Import-Csv $Script:Store)
    $now = Get-Date
    foreach ($g in $grants | Where-Object { $_.Status -eq 'Active' -and [datetime]$_.ExpiresAt -le $now }) {
        Remove-ADGroupMember $g.Group -Members $g.User -Confirm:$false
        $g.Status = 'Expired'; $g.RevokedAt = $now.ToString('o')
        Write-JitLog "REVOKE $($g.Id) $($g.User) -> $($g.Group) (expired)"
    }
    $grants | Export-Csv $Script:Store -NoTypeInformation   # [datetime] of an ISO 8601 string parses on any locale
}

Export-ModuleMember -Function Grant-C90JitAccess, Revoke-C90ExpiredAccess
```

Copy the module to `C:\C90\` and schedule the revoker:

```powershell
Copy-Item .\C90.Jit.psm1 C:\C90\ -Force
$action  = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -Command "Import-Module C:\C90\C90.Jit.psm1; Revoke-C90ExpiredAccess"'
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 15)
Register-ScheduledTask -TaskName 'C90-JIT-Revoke' -Action $action -Trigger $trigger -User 'SYSTEM' -RunLevel Highest
```

Test with a 15-minute grant:

```powershell
Import-Module C:\C90\C90.Jit.psm1 -Force
Grant-C90JitAccess -User alex.rivera -Group Finance-Reports -ApprovedBy alex.rivera -Justification test   # must fail (SoD)
Grant-C90JitAccess -User alex.rivera -Group Finance-Reports -ApprovedBy sarah.johnson -Justification 'Q3 audit sample' -Hours 0.25
Get-ADGroupMember Finance-Reports            # Alex is in
# ...wait 15–30 minutes...
Get-ADGroupMember Finance-Reports            # Alex is gone
Get-Content C:\C90\jit.log
```

### Part C — access review

```powershell
# 1. Export the campaign for the owner
$group = 'Finance-Team'
Get-ADGroupMember $group | Get-ADUser -Properties Department, Title, LastLogonDate, Enabled |
    Select-Object SamAccountName, Name, Department, Title, Enabled, LastLogonDate,
        @{ n = 'Decision'; e = { '' } }, @{ n = 'Reason'; e = { '' } } |
    Export-Csv ".\reviews\$group-review.csv" -NoTypeInformation

# 2. The owner fills Decision (Keep/Remove) + Reason in Sheets/Excel.
#    Add alex.rivera to Finance-Team first so there's a wrong member to find.

# 3. Apply decisions and produce evidence
$decisions = Import-Csv ".\reviews\$group-review.csv"
if ($decisions | Where-Object { $_.Decision -notin 'Keep','Remove' }) { throw 'Every row needs Keep or Remove' }
$decisions | Where-Object Decision -eq 'Remove' | ForEach-Object {
    Remove-ADGroupMember $group -Members $_.SamAccountName -Confirm:$false
    [pscustomobject]@{ Group = $group; User = $_.SamAccountName; Action = 'Removed'
        Reason = $_.Reason; At = (Get-Date).ToString('o'); By = $env:USERNAME }
} | Export-Csv ".\reviews\$group-review-applied.csv" -NoTypeInformation
```

The in-app **Access Reviews** console runs the same campaign in the simulator —
do one there too and compare.

### Part D — (optional, read the warning) AD native time-bound membership

AD can expire membership itself (`Add-ADGroupMember -MemberTimeToLive`) once the
*Privileged Access Management* optional feature is on:

```powershell
Enable-ADOptionalFeature 'Privileged Access Management Feature' -Scope ForestOrConfigurationSet -Target corp.technobiz.local
```

**Warning: enabling it can never be undone** for the forest. Snapshot DC01
first, and only do this if you accept that. The scheduled-task design above
teaches the same control reversibly. Entra ID's equivalent is **PIM for
Groups** (P2) — try it only if your trial is still active.

## Validation checklist

- `Finance-Reports` group, `FinanceReports` share and `role-finance-reports` created
- Alex eligible, activated for 15 minutes with a justification
- Activation expired (or was ended early) and the audit log shows both events
- `Get-PimStandingPrivilege` reports no standing privilege
- Access review on `Finance-Team` completed; Alex removed and proven with `Get-ADGroupMember`
- `C90.Jit.psm1` written and committed to GitHub

## Challenge

IAM-10092: an approved JIT user still can't open `\\DC01\FinanceReports`. The
grant is `Active`. Name three causes (token not refreshed, NTFS denies even
though the share allows, wrong group granted) and how you'd prove which.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Task runs but nothing is revoked | Task can't load the module path, or runs without AD rights — check *Last Run Result* |
| `Cannot convert value to type System.DateTime` | CSV edited in Excel and dates reformatted — keep ISO 8601 |
| Revoked user still has access | Existing Kerberos ticket — access ends at next sign-in or `klist purge` |

## GitHub assignment

Repo `iam-access-governance`: `C90.Jit.psm1`, task registration script, sample
`jit.log`, review CSVs (lab data), `docs/lab10-jit-reviews.md`.

## Resume bullet

> Implemented just-in-time group access in Active Directory with owner-only
> approval, separation-of-duties checks and automatic expiry, and ran an access
> review whose removals were applied and evidenced the same day.

## Interview question

"How do you reduce standing privileged access?" JIT with approval and expiry,
reviews for what must stay, and evidence that expiry actually happened.

## Homework

- Read Microsoft Learn: *What is Privileged Identity Management?*
- Add an email/Teams notification stub to `Grant-C90JitAccess`.
