# Lab 9 — JML Workflow Automation (AD + Entra ID)

**Days 57–63 · Phase 3: Lifecycle & Governance · Repo:** `iam-jml-automation`

## Do this lab in the app

The app's `omari.test` domain is synced to a simulated Entra ID tenant — a
real hybrid pattern: AD is the source, the cloud copy follows.

**Row 1 · JOIN** Lena Ortiz into Finance (ticket HR-3001, approved by sarah.johnson):

```powershell
New-ADUser -Name "Lena Ortiz" -GivenName Lena -Surname Ortiz -SamAccountName lena.ortiz -Department Finance -Title Analyst -Path "OU=Employees,OU=Challenge90,DC=omari,DC=test" -ChangePasswordAtLogon $true -Enabled $true
Add-ADGroupMember -Identity Finance-Team -Members lena.ortiz
Connect-Entra
Start-DirectorySync -Provider entra
Get-CloudUser -Provider entra -Upn lena.ortiz@omari.test
```

**Row 2 · JOIN** Omar Haddad has **no approver** — do nothing, and log why in
your write-up. Refusing is the control.

**Row 3 · MOVE** Lena to Sales. Removing the old access is the step audits
catch missing:

```powershell
Get-ADPrincipalGroupMembership lena.ortiz
Remove-ADGroupMember -Identity Finance-Team -Members lena.ortiz
Add-ADGroupMember -Identity Sales-Team -Members lena.ortiz
Move-ADObject -Identity lena.ortiz -TargetDepartment Sales
Get-ADUser lena.ortiz -Properties Department, MemberOf
```

**Row 4 · LEAVE** Priya Patel (HR-3004):

```powershell
Get-ADPrincipalGroupMembership priya.patel
Remove-ADGroupMember -Identity Sales-Team -Members priya.patel
Set-ADAccountPassword -Identity priya.patel -NewPassword "Lv9!x7Qm2#Rt4pZw"
Disable-ADAccount -Identity priya.patel -Reason "HR-3004 leaver"
Move-ADObject -Identity priya.patel -TargetPath "OU=Disabled,OU=Challenge90,DC=omari,DC=test"
Revoke-UserSession -Identity priya.patel
Start-DirectorySync -Provider entra
Revoke-CloudSession -Provider entra -Upn priya.patel@omari.test
Get-CloudUser -Provider entra -Upn priya.patel@omari.test
```

Now try `Disable-CloudUser -Provider entra -Upn priya.patel@omari.test`. It is
refused: a synced user is disabled *on premises* and the sync carries it to the
cloud. Explain that in your README.

**Evidence:** `Get-IamAuditLog -Last 40`, then `Export-IamAuditLog -Last 40` and
paste the CSV into **Sheets**. Open **Cloud Identity** to screenshot the synced
state. The reset password above is only for this simulator; a real leaver gets
a random one from the script's `New-C90RandomPassword`.

Write `C90.Jml.psm1` from the reference below in **PowerShell ISE** and commit it.

## Career objective

Automate Joiner, Mover and Leaver end to end from an HR feed across AD and
Entra ID, with approvals, an audit log, `-WhatIf`, and a leaver process that
actually removes access *and* live sessions.

## Quick review

1. In a hybrid estate with Entra Connect, where do you create a user — AD or Entra?
2. What access should a mover *lose*, and why is that the step most often skipped?
3. Disable vs delete for leavers — which, and for how long?
4. Why revoke sign-in sessions when you disable an account?
5. What makes an HR-driven process auditable?

## Scenario

HR drops `jml-feed.csv` every morning. Each row is a JOIN, MOVE or LEAVE with an
HR ticket and an approver. Process it unattended, refuse rows without approval,
and log every change.

## Concept

**Source of truth → decision → change → evidence.** HR is the source; the
approver column is the decision; your script makes the change; the log is the
evidence. In a real hybrid tenant, Entra Connect copies AD users to the cloud
and you would only touch AD. This lab has no Entra Connect, so the script
updates both — which is exactly the "two systems drift apart" problem sync
exists to solve. Write that down in your README.

## Hands-on lab

### Feed (`data/jml-feed.csv`)

```csv
Action,EmployeeId,FirstName,LastName,SamAccountName,Department,Title,Manager,Ticket,ApprovedBy
JOIN,1101,Lena,Ortiz,lena.ortiz,Finance,Analyst,sarah.johnson,HR-3001,sarah.johnson
JOIN,1102,Omar,Haddad,omar.haddad,Engineering,Engineer,,HR-3002,
MOVE,1101,Lena,Ortiz,lena.ortiz,Sales,Account Manager,alex.rivera,HR-3003,alex.rivera
LEAVE,1005,Priya,Patel,priya.patel,,,,HR-3004,alex.rivera
```

Row 2 has no approver: it must be **rejected**, not processed.

### Module (`C90.Jml.psm1`)

```powershell
#Requires -Modules ActiveDirectory
$Script:Root    = 'OU=Challenge90,DC=corp,DC=technobiz,DC=local'
$Script:Tenant  = '<tenant>.onmicrosoft.com'
$Script:LogFile = ".\logs\jml-$(Get-Date -Format yyyyMMdd).jsonl"

function Write-C90JmlLog {
    param([string]$Ticket, [string]$User, [string]$Action, [string]$Result, [string]$Detail)
    New-Item -ItemType Directory -Force (Split-Path $Script:LogFile) | Out-Null
    [pscustomobject]@{ Time = (Get-Date).ToString('o'); Operator = $env:USERNAME; Ticket = $Ticket
        User = $User; Action = $Action; Result = $Result; Detail = $Detail } |
        ConvertTo-Json -Compress | Add-Content $Script:LogFile
}

function New-C90RandomPassword {
    $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*'.ToCharArray()
    $bytes = [byte[]]::new(24); [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)   # works on PS 5.1
    ConvertTo-SecureString (-join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })) -AsPlainText -Force
}

function Invoke-C90Joiner {
    [CmdletBinding(SupportsShouldProcess)] param([Parameter(Mandatory)]$Row, [string]$GraphToken)
    if (Get-ADUser -Filter "SamAccountName -eq '$($Row.SamAccountName)'") { return 'Skipped: exists' }
    if (-not $PSCmdlet.ShouldProcess($Row.SamAccountName, 'JOIN')) { return 'WhatIf' }
    $params = @{
        Name = "$($Row.FirstName) $($Row.LastName)"; GivenName = $Row.FirstName; Surname = $Row.LastName
        SamAccountName = $Row.SamAccountName; UserPrincipalName = "$($Row.SamAccountName)@corp.technobiz.local"
        EmployeeID = $Row.EmployeeId; Department = $Row.Department; Title = $Row.Title
        Path = "OU=Employees,$Script:Root"; AccountPassword = (New-C90RandomPassword)
        Enabled = $true; ChangePasswordAtLogon = $true
    }
    if ($Row.Manager) { $params.Manager = (Get-ADUser $Row.Manager).DistinguishedName }
    New-ADUser @params -ErrorAction Stop
    Add-ADGroupMember "$($Row.Department)-Team" -Members $Row.SamAccountName
    # The manager receives a password-reset link through the service desk; the random password is never shown.
    'Created'
}

function Invoke-C90Mover {
    [CmdletBinding(SupportsShouldProcess)] param([Parameter(Mandatory)]$Row, [string]$GraphToken)
    $u = Get-ADUser $Row.SamAccountName -Properties Department, MemberOf -ErrorAction Stop
    $old = $u.Department                               # the attribute, not a guess from the OU path
    if ($old -eq $Row.Department) { return 'Skipped: same department' }
    if (-not $PSCmdlet.ShouldProcess($Row.SamAccountName, "MOVE $old -> $($Row.Department)")) { return 'WhatIf' }
    # Movers lose the old department's access. This is the step audits catch missing.
    Remove-ADGroupMember "$old-Team" -Members $u -Confirm:$false -ErrorAction SilentlyContinue
    Add-ADGroupMember "$($Row.Department)-Team" -Members $u
    $set = @{ Department = $Row.Department; Title = $Row.Title }
    if ($Row.Manager) { $set.Manager = (Get-ADUser $Row.Manager).DistinguishedName }
    Set-ADUser $u @set
    "Moved $old -> $($Row.Department)"
}

function Invoke-C90Leaver {
    [CmdletBinding(SupportsShouldProcess)] param([Parameter(Mandatory)]$Row, [string]$GraphToken)
    $u = Get-ADUser $Row.SamAccountName -Properties MemberOf -ErrorAction Stop
    $groups = ($u.MemberOf | ForEach-Object { ($_ -split ',')[0] -replace '^CN=' }) -join ';'
    if (-not $PSCmdlet.ShouldProcess($Row.SamAccountName, 'LEAVE')) { return "WhatIf (would remove $groups)" }
    Disable-ADAccount $u
    Set-ADAccountPassword $u -Reset -NewPassword (New-C90RandomPassword)   # kills any known password
    foreach ($g in $u.MemberOf) { Remove-ADGroupMember $g -Members $u -Confirm:$false }
    Set-ADUser $u -Description "LEFT $(Get-Date -Format yyyy-MM-dd) $($Row.Ticket) groups:$groups" -Clear Manager
    Move-ADObject $u.DistinguishedName -TargetPath "OU=Disabled,$Script:Root"

    if ($GraphToken) {   # cloud copy: block sign-in and revoke refresh tokens
        $h = @{ Authorization = "Bearer $GraphToken" }
        $upn = "$($Row.SamAccountName)@$Script:Tenant"
        Invoke-RestMethod -Method Patch -Uri "https://graph.microsoft.com/v1.0/users/$upn" -Headers $h `
            -ContentType 'application/json' -Body '{"accountEnabled":false}'
        Invoke-RestMethod -Method Post -Uri "https://graph.microsoft.com/v1.0/users/$upn/revokeSignInSessions" -Headers $h
    }
    "Disabled; removed $groups"
}

function Invoke-C90JmlFeed {
    [CmdletBinding(SupportsShouldProcess)]
    param([Parameter(Mandatory)][string]$CsvPath, [string]$GraphToken)
    foreach ($row in Import-Csv $CsvPath) {
        if (-not $row.ApprovedBy) {
            Write-C90JmlLog $row.Ticket $row.SamAccountName $row.Action 'Rejected' 'No approver on HR ticket'
            [pscustomobject]@{ Ticket = $row.Ticket; User = $row.SamAccountName; Action = $row.Action; Result = 'Rejected: no approval' }
            continue
        }
        try {
            $result = switch ($row.Action.ToUpper()) {
                'JOIN'  { Invoke-C90Joiner -Row $row -GraphToken $GraphToken -WhatIf:$WhatIfPreference }
                'MOVE'  { Invoke-C90Mover  -Row $row -GraphToken $GraphToken -WhatIf:$WhatIfPreference }
                'LEAVE' { Invoke-C90Leaver -Row $row -GraphToken $GraphToken -WhatIf:$WhatIfPreference }
                default { throw "Unknown action '$($row.Action)'" }
            }
            Write-C90JmlLog $row.Ticket $row.SamAccountName $row.Action 'OK' "$result (approved by $($row.ApprovedBy))"
        } catch {
            $result = "Failed: $($_.Exception.Message)"
            Write-C90JmlLog $row.Ticket $row.SamAccountName $row.Action 'Failed' $_.Exception.Message
        }
        [pscustomobject]@{ Ticket = $row.Ticket; User = $row.SamAccountName; Action = $row.Action; Result = $result }
    }
}

Export-ModuleMember -Function Invoke-C90JmlFeed, Invoke-C90Joiner, Invoke-C90Mover, Invoke-C90Leaver
```

### Run it (on DC01)

```powershell
Import-Module .\C90.Jml.psm1 -Force
Invoke-C90JmlFeed -CsvPath .\data\jml-feed.csv -WhatIf | Format-Table   # dry run
Invoke-C90JmlFeed -CsvPath .\data\jml-feed.csv | Format-Table
Get-Content .\logs\jml-*.jsonl | ConvertFrom-Json | Format-Table Time, Ticket, User, Action, Result

# Optional cloud side (token from Lab 8's module; DC01 needs internet via RAS/NAT)
# Import-Module ..\iam-graph-automation\C90.Graph.psm1; $t = Get-C90GraphToken
# Invoke-C90JmlFeed -CsvPath .\data\jml-feed.csv -GraphToken $t
```

## Validation checklist

- HR-3002 (no approver) was not processed, and the refusal is written up
- Lena joined Finance and appears in the cloud after a sync
- Lena moved to Sales: in `Sales-Team`, **not** in `Finance-Team`
- Priya: groups recorded, removed, password reset, disabled with reason, in `OU=Disabled`
- Priya's sessions revoked on premises and in the cloud; `Disable-CloudUser` refusal explained
- Audit log exported to Sheets as evidence
- `C90.Jml.psm1` written and committed to GitHub

## Challenge

IAM-9081: after a MOVE, Lena can still open the Finance SharePoint site.
AD shows the right groups. Where else could Finance access live? (Direct
SharePoint permission, a cloud-only group, a sharing link, a cached token that
lives until it expires.) What would a leaver/mover *access report* need to
check to catch this?

## Troubleshooting

| Symptom | Cause |
|---|---|
| `Cannot find an object with identity 'X-Team'` | Department group missing — Lab 2's `New-C90DepartmentGroup` |
| Mover still has old access in AD | Old group name didn't match `Department` value (case/spacing) |
| Graph 404 for leaver | UPN in the tenant differs from `sam@tenant` |
| `-WhatIf` still changed things | A nested call missing `-WhatIf:$WhatIfPreference` |

## GitHub assignment

Repo `iam-jml-automation`: module, feed, a sample JSONL log, and
`docs/lab09-jml.md` with a sequence diagram of each flow and a paragraph on
how Entra Connect would change the design.

## Resume bullet

> Automated Joiner-Mover-Leaver processing from an HR feed across Active
> Directory and Entra ID with approval gating, removal of prior access on
> moves, session revocation for leavers, and a JSONL audit trail.

## Interview question

"What's the most common JML failure you'd look for in an audit?" Movers who
keep old access (privilege creep) — and how your mover step prevents it.

## Homework

- Add a `-ReportOnly` mode that lists, per user, access that doesn't match their department.
- Read about Entra ID *Lifecycle Workflows* and compare them with your script.
