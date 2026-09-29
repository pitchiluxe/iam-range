# Lab 2 — PowerShell AD Automation Toolkit

**Days 8–14 · Phase 1: AD Foundation · Repo:** `iam-ad-enterprise-lab` (folder `automation/`)

## Do this lab in the app

You automate against the app's `omari.test` domain, building on Lab 1.

1. **Terminal** — the department groups:

```powershell
New-ADGroup -Name Engineering-Team -GroupScope Global -GroupCategory Security -Path "OU=Groups,OU=Challenge90,DC=omari,DC=test"
New-ADGroup -Name HR-Team -GroupScope Global -GroupCategory Security -Path "OU=Groups,OU=Challenge90,DC=omari,DC=test"
New-ADGroup -Name Finance-Team -GroupScope Global -GroupCategory Security -Path "OU=Groups,OU=Challenge90,DC=omari,DC=test"
New-ADGroup -Name IT-Team -GroupScope Global -GroupCategory Security -Path "OU=Groups,OU=Challenge90,DC=omari,DC=test"
```

2. **PowerShell ISE** — paste this, click **Run**, and read the per-line results.
   Then run it a second time: every line fails with "already exists". That is
   the simulator's version of the `Skipped` rows your real module reports.

```powershell
# PowerShell ISE — bulk onboarding from the HR list, one loop per department
$engineering = @('maria.chen')
$hr = @('james.wilson')
$finance = @('sarah.johnson')
$it = @('david.kim')
$sales = @('priya.patel')
foreach ($u in $engineering) {
  New-ADUser -Name $u -SamAccountName $u -Department Engineering -Path "OU=Employees,OU=Challenge90,DC=omari,DC=test" -ChangePasswordAtLogon $true -Enabled $true
  Add-ADGroupMember -Identity Engineering-Team -Members $u
}
foreach ($u in $hr) {
  New-ADUser -Name $u -SamAccountName $u -Department HR -Path "OU=Employees,OU=Challenge90,DC=omari,DC=test" -ChangePasswordAtLogon $true -Enabled $true
  Add-ADGroupMember -Identity HR-Team -Members $u
}
foreach ($u in $finance) {
  New-ADUser -Name $u -SamAccountName $u -Department Finance -Path "OU=Employees,OU=Challenge90,DC=omari,DC=test" -ChangePasswordAtLogon $true -Enabled $true
  Add-ADGroupMember -Identity Finance-Team -Members $u
}
foreach ($u in $it) {
  New-ADUser -Name $u -SamAccountName $u -Department IT -Path "OU=Employees,OU=Challenge90,DC=omari,DC=test" -ChangePasswordAtLogon $true -Enabled $true
  Add-ADGroupMember -Identity IT-Team -Members $u
}
foreach ($u in $sales) {
  New-ADUser -Name $u -SamAccountName $u -Department Sales -Path "OU=Employees,OU=Challenge90,DC=omari,DC=test" -ChangePasswordAtLogon $true -Enabled $true
  Add-ADGroupMember -Identity Sales-Team -Members $u
}
```

3. **Terminal** — offboard the leaver (record the groups first: that is your
   rollback and your evidence), then report:

```powershell
Get-ADPrincipalGroupMembership james.wilson
Remove-ADGroupMember -Identity HR-Team -Members james.wilson
Disable-ADAccount -Identity james.wilson -Reason "HR-2041 Resigned"
Move-ADObject -Identity james.wilson -TargetPath "OU=Disabled,OU=Challenge90,DC=omari,DC=test"
Get-ADUser -Filter * -SearchBase "OU=Challenge90,DC=omari,DC=test" -Properties Department, Enabled | Select-Object SamAccountName, Department, Enabled
```

4. Copy the report into **Sheets** and save it as your onboarding report.
5. Write the full `C90.ADToolkit.psm1` module from the reference below in
   **PowerShell ISE** or Notepad and commit it to GitHub — it is the version
   you would run on a real domain controller.

## Career objective

Turn Lab 1's clicks into a reusable PowerShell module that onboards and
offboards from CSV, is safe to re-run, and produces a report an auditor can
read. "Can you script it?" is the question that separates help desk from IAM.

## Quick review

1. What does `-WhatIf` do, and how does a function get it for free?
2. Why check whether a user exists before calling `New-ADUser`?
3. What is the difference between `Get-ADGroupMember` and `Get-ADPrincipalGroupMembership`?
4. Why should a script never contain a default password?
5. What makes a script *idempotent*?

## Scenario

HR sends a CSV of five new hires and a list of five leavers. Create the new
hires in the right place with their department group, disable the leavers
(keeping them for audit), and hand IT a report.

## Concept

Bulk operations fail *partially*. A good toolkit never stops at the first bad
row: it records `Created`, `Skipped` or `Failed` per row and carries on, so the
output is the audit trail.

## Hands-on lab

### Part A — input data (`automation/data/`)

`new-hires.csv` — values with commas are quoted; the manager is a
`SamAccountName`, which the script resolves, instead of a raw DN.

```csv
FirstName,LastName,SamAccountName,Department,Title,Manager
Maria,Chen,maria.chen,Engineering,Software Engineer,
James,Wilson,james.wilson,HR,HR Specialist,
Sarah,Johnson,sarah.johnson,Finance,Accountant,
David,Kim,david.kim,IT,Systems Administrator,
Priya,Patel,priya.patel,Sales,Account Executive,alex.rivera
```

`terminations.csv`

```csv
SamAccountName,Reason,Ticket
james.wilson,Resigned,HR-2041
```

### Part B — the module (`automation/C90.ADToolkit.psm1`)

```powershell
#Requires -Modules ActiveDirectory
$Script:Root   = 'OU=Challenge90,DC=corp,DC=technobiz,DC=local'
$Script:Suffix = 'corp.technobiz.local'

function New-C90DepartmentGroup {
    [CmdletBinding(SupportsShouldProcess)]
    param([string[]]$Department = @('Sales','Engineering','HR','Finance','IT'))
    foreach ($d in $Department) {
        $name = "$d-Team"
        if (Get-ADGroup -Filter "Name -eq '$name'") { Write-Verbose "$name exists"; continue }
        if ($PSCmdlet.ShouldProcess($name, 'Create group')) {
            New-ADGroup -Name $name -GroupScope Global -GroupCategory Security `
                -Path "OU=Groups,$Script:Root" -Description "Department group for $d"
        }
    }
}

function New-C90UserBulk {
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [Parameter(Mandatory)][string]$CsvPath,
        [Parameter(Mandatory)][securestring]$TemporaryPassword
    )
    foreach ($row in Import-Csv $CsvPath) {
        $sam = $row.SamAccountName
        try {
            if (Get-ADUser -Filter "SamAccountName -eq '$sam'") {
                [pscustomobject]@{ User = $sam; Status = 'Skipped'; Detail = 'Already exists' }; continue
            }
            $params = @{
                Name = "$($row.FirstName) $($row.LastName)"; GivenName = $row.FirstName
                Surname = $row.LastName; SamAccountName = $sam
                UserPrincipalName = "$sam@$Script:Suffix"; Department = $row.Department
                Title = $row.Title; Path = "OU=Employees,$Script:Root"
                AccountPassword = $TemporaryPassword; Enabled = $true; ChangePasswordAtLogon = $true
            }
            if ($row.Manager) { $params.Manager = (Get-ADUser $row.Manager).DistinguishedName }
            if (-not $PSCmdlet.ShouldProcess($sam, 'Create user')) {
                [pscustomobject]@{ User = $sam; Status = 'WhatIf'; Detail = 'Would create' }; continue
            }
            New-ADUser @params -ErrorAction Stop
            Add-ADGroupMember -Identity "$($row.Department)-Team" -Members $sam -ErrorAction Stop
            [pscustomobject]@{ User = $sam; Status = 'Created'; Detail = "$($row.Department)-Team" }
        } catch {
            [pscustomobject]@{ User = $sam; Status = 'Failed'; Detail = $_.Exception.Message }
        }
    }
}

function Disable-C90UserBulk {
    [CmdletBinding(SupportsShouldProcess)]
    param([Parameter(Mandatory)][string]$CsvPath)
    foreach ($row in Import-Csv $CsvPath) {
        $sam = $row.SamAccountName
        try {
            $u = Get-ADUser $sam -Properties MemberOf -ErrorAction Stop
            # Record memberships BEFORE removing them — that is the rollback and the evidence.
            $groups = $u.MemberOf | ForEach-Object { (Get-ADGroup $_).Name }
            if (-not $PSCmdlet.ShouldProcess($sam, 'Disable, strip groups, move to Disabled')) {
                [pscustomobject]@{ User = $sam; Status = 'WhatIf'; Detail = "Would remove: $($groups -join ';')" }; continue
            }
            Disable-ADAccount $u
            foreach ($g in $u.MemberOf) { Remove-ADGroupMember -Identity $g -Members $u -Confirm:$false }
            Set-ADUser $u -Description "Disabled $(Get-Date -Format yyyy-MM-dd) $($row.Ticket): $($row.Reason)" -Clear Manager
            Move-ADObject $u.DistinguishedName -TargetPath "OU=Disabled,$Script:Root"
            [pscustomobject]@{ User = $sam; Status = 'Disabled'; Detail = "Removed: $($groups -join ';')" }
        } catch {
            [pscustomobject]@{ User = $sam; Status = 'Failed'; Detail = $_.Exception.Message }
        }
    }
}

function Get-C90UserReport {
    param([string]$OutFile = ".\reports\users-$(Get-Date -Format yyyyMMdd).csv")
    New-Item -ItemType Directory -Force -Path (Split-Path $OutFile) | Out-Null
    Get-ADUser -Filter * -SearchBase $Script:Root -Properties Department, Title, Manager, Enabled, LastLogonDate, WhenCreated, MemberOf |
        Select-Object SamAccountName, Name, Department, Title, Enabled, LastLogonDate, WhenCreated,
            @{ n = 'Manager'; e = { if ($_.Manager) { (Get-ADUser $_.Manager).SamAccountName } } },
            @{ n = 'Groups';  e = { ($_.MemberOf | ForEach-Object { ($_ -split ',')[0] -replace '^CN=' }) -join ';' } } |
        Tee-Object -Variable report | Export-Csv $OutFile -NoTypeInformation
    Write-Host "Report: $OutFile"
    $report
}

Export-ModuleMember -Function New-C90DepartmentGroup, New-C90UserBulk, Disable-C90UserBulk, Get-C90UserReport
```

`Domain Users` is the primary group, so it is not in `MemberOf` and is never
stripped — the transcript's special case is unnecessary.

### Part C — run it

```powershell
Import-Module .\automation\C90.ADToolkit.psm1 -Force
New-C90DepartmentGroup -Verbose

$pw = Read-Host 'Temporary password' -AsSecureString
New-C90UserBulk -CsvPath .\automation\data\new-hires.csv -TemporaryPassword $pw -WhatIf   # dry run first
New-C90UserBulk -CsvPath .\automation\data\new-hires.csv -TemporaryPassword $pw | Format-Table
New-C90UserBulk -CsvPath .\automation\data\new-hires.csv -TemporaryPassword $pw | Format-Table  # re-run: all Skipped

Disable-C90UserBulk -CsvPath .\automation\data\terminations.csv | Format-Table
Get-C90UserReport | Format-Table SamAccountName, Department, Enabled, Groups
```

## Validation checklist

- Five `*-Team` groups exist in `OU=Groups,OU=Challenge90`
- The ISE script created five users, each in their department group
- Second run of the script created nothing (every line "already exists")
- `james.wilson`'s groups recorded before removal
- `james.wilson` is disabled with a ticket reason and sits in `OU=Disabled`
- Onboarding report pasted into Sheets and saved
- `C90.ADToolkit.psm1` written and committed to GitHub

## Challenge

After the run, **Maria Chen** gets "The user name or password is incorrect" on
CLIENT01. List what you check: account enabled, `pwdLastSet`, the password
meeting the domain policy, which UPN or `CORP\` name she typed, lockout state.

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `The password does not meet the length, complexity, or history requirement` | Temp password too weak for the policy | Check `Get-ADDefaultDomainPasswordPolicy` |
| `Directory object not found` on `-Path` | OU missing or DN typo | `Get-ADOrganizationalUnit -Filter * \| Select DistinguishedName` |
| `Cannot find an object with identity: 'X-Team'` | Groups not created | Run `New-C90DepartmentGroup` first |
| `Access is denied` | Not elevated / not a domain admin | Run elevated as `CORP\Administrator` |

## GitHub assignment

Commit `automation/` (module, data, a sample report with lab data only) and
`docs/lab02-automation.md` with the output of each run pasted in.

## Resume bullet

> Wrote an idempotent PowerShell module for bulk AD onboarding and offboarding
> from HR CSV feeds, with `-WhatIf` support, per-row audit results and
> pre-removal group snapshots for rollback.

## Interview question

"Your bulk script failed halfway through 200 users. What happens now?" Talk
about per-row results, idempotent re-runs and why you snapshot before you remove.

## Homework

- Add `-LogPath` so every result row is also appended to a CSV log.
- Read `Get-Help about_Functions_CmdletBindingAttribute`.
