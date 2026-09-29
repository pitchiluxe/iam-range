# Lab 3 — AD Troubleshooting Deep Dive

**Days 15–21 · Phase 1: AD Foundation · Repo:** `iam-ad-enterprise-lab` (folder `troubleshooting/`)

## Do this lab in the app

Reproduce and solve each ticket in the app's `omari.test` domain. Write each
one up as situation → evidence → root cause → fix → prevention.

**IAM-2034 · repeat lockout.** Sign out, pick `alex.rivera`, enter a wrong
password five times. Sign in as `admin`:

```powershell
Get-ADUser alex.rivera -Properties LockedOut
Get-IamAuditLog -Action account.lockout
Unlock-ADAccount -Identity alex.rivera
```

The audit entry says *who* locked and *when* — the in-app equivalent of event
4740's caller computer.

**IAM-2035 · password refused.** Tighten the policy, then read it back:

```powershell
Get-PasswordPolicy
Set-PasswordPolicy -MinimumLength 12 -ComplexityEnabled $true -MaximumAge 90
Get-PasswordPolicy
```

Now try `Set-ADAccountPassword -Identity maria.chen -NewPassword short1` —
it is refused. Explain which rule refused it, then set a compliant password.

**IAM-2036 · "created but doesn't exist over there".** The app has one domain
controller, but it has the same problem between AD and the cloud:

```powershell
Connect-Entra
Get-DirectorySyncStatus -Provider entra
Start-DirectorySync -Provider entra
Get-DirectorySyncStatus -Provider entra
```

**IAM-2037 · added to the group, still no access.**

```powershell
New-Share -Name SalesDocs -Path "C:\Shares\SalesDocs"
Grant-SharePermission -Name SalesDocs -Trustee Sales-Team -Access Modify
Get-EffectiveAccess -Name SalesDocs -Identity david.kim
Add-ADGroupMember -Identity Sales-Team -Members david.kim
Get-EffectiveAccess -Name SalesDocs -Identity david.kim
Get-UserSession -Identity david.kim
Revoke-UserSession -Identity david.kim
```

Revoking the session is the in-app version of "sign out and back in / `klist
purge`": the new group only reaches a *new* token. Use **Active Directory** to
screenshot David's *Member Of* tab before and after.

Write the diagnostics toolkit from the reference below in **PowerShell ISE**
and commit it — it is what you would run on a real domain controller.

## Career objective

Diagnose the four AD tickets that fill a junior IAM queue — lockouts, password
failures, "created but can't sign in", and "added to the group but still no
access" — with a repeatable method and a script for each.

## Quick review

1. Which attributes are *not* replicated between DCs, and why does that matter?
2. What does `pwdLastSet = 0` mean?
3. Where do cached credentials that cause repeat lockouts usually live?
4. When does a group change reach a user's access token?
5. What is the PDC emulator's role in password changes?

## Scenarios

| Ticket | Report |
|---|---|
| IAM-2034 | `alex.rivera` is locked out and says they typed the wrong password once. |
| IAM-2035 | `maria.chen` cannot change her password: "does not meet requirements". |
| IAM-2036 | A user created an hour ago "doesn't exist" on another DC. |
| IAM-2037 | `david.kim` was added to `Sales-Team` yesterday and still can't reach the share. |

## Concept — the method

**Reproduce → scope → collect → hypothesise → fix → verify → document.** Never
unlock and close: an account that relocks in ten minutes has a *source* (a
phone, a mapped drive, a scheduled task, a service) still sending the old
password.

## Hands-on lab

### Setup — reproduce the tickets

```powershell
# IAM-2034: on CLIENT01, map a drive with alex.rivera's saved credential,
# then change Alex's password on DC01. The stale saved credential now relocks Alex.
# (On CLIENT01, as another user:)
#   cmdkey /add:DC01 /user:CORP\alex.rivera /pass
#   net use S: \\DC01\NETLOGON /persistent:yes

# IAM-2035: make history bite
Set-ADDefaultDomainPasswordPolicy corp.technobiz.local -PasswordHistoryCount 5 -MinPasswordAge 1.00:00:00
```

### The toolkit (`troubleshooting/C90.Diagnostics.ps1`)

```powershell
#Requires -Modules ActiveDirectory
# Dot-source it:  . .\troubleshooting\C90.Diagnostics.ps1

function Get-C90LockoutReport {
    param([Parameter(Mandatory)][string]$SamAccountName, [int]$Days = 7)
    $pdc = (Get-ADDomain).PDCEmulator
    Write-Host "Lockout events on $pdc" -ForegroundColor Cyan
    Get-WinEvent -ComputerName $pdc -FilterHashtable @{
        LogName = 'Security'; Id = 4740; StartTime = (Get-Date).AddDays(-$Days)
    } -ErrorAction SilentlyContinue |
        Where-Object { $_.Properties[0].Value -eq $SamAccountName } |
        Select-Object TimeCreated, @{ n = 'CallerComputer'; e = { $_.Properties[1].Value } }

    # badPwdCount and lastLogon are per-DC and NOT replicated: ask every DC.
    Write-Host "Per-DC state" -ForegroundColor Cyan
    foreach ($dc in Get-ADDomainController -Filter *) {
        Get-ADUser $SamAccountName -Server $dc.HostName -Properties badPwdCount, badPasswordTime, lastLogon, LockedOut |
            Select-Object @{ n = 'DC'; e = { $dc.Name } }, LockedOut, badPwdCount,
                @{ n = 'LastBadPwd'; e = { [datetime]::FromFileTime($_.badPasswordTime) } },
                @{ n = 'LastLogon';  e = { [datetime]::FromFileTime($_.lastLogon) } }
    }
}

function Get-C90PasswordStatus {
    param([Parameter(Mandatory)][string]$SamAccountName)
    $p = Get-ADDefaultDomainPasswordPolicy
    $fg = Get-ADUserResultantPasswordPolicy $SamAccountName   # a fine-grained policy overrides the domain one
    $u = Get-ADUser $SamAccountName -Properties PasswordLastSet, PasswordExpired, PasswordNeverExpires, pwdLastSet, Enabled, LockedOut
    [pscustomobject]@{
        User = $SamAccountName; Enabled = $u.Enabled; LockedOut = $u.LockedOut
        MustChangeAtLogon = ($u.pwdLastSet -eq 0); PasswordLastSet = $u.PasswordLastSet
        Expired = $u.PasswordExpired; NeverExpires = $u.PasswordNeverExpires
        PolicySource = if ($fg) { "Fine-grained: $($fg.Name)" } else { 'Default domain policy' }
        MinLength = if ($fg) { $fg.MinPasswordLength } else { $p.MinPasswordLength }
        History   = if ($fg) { $fg.PasswordHistoryCount } else { $p.PasswordHistoryCount }
        MinAge    = if ($fg) { $fg.MinPasswordAge } else { $p.MinPasswordAge }
    }
}

function Test-C90ObjectOnAllDCs {
    param([Parameter(Mandatory)][string]$SamAccountName)
    foreach ($dc in Get-ADDomainController -Filter *) {
        $found = [bool](Get-ADUser -Filter "SamAccountName -eq '$SamAccountName'" -Server $dc.HostName)
        [pscustomobject]@{ DC = $dc.Name; Found = $found }
    }
    repadmin /replsummary
}

function Test-C90GroupAccess {
    param([Parameter(Mandatory)][string]$SamAccountName, [Parameter(Mandatory)][string]$GroupName)
    $direct = Get-ADGroupMember $GroupName | Where-Object SamAccountName -eq $SamAccountName
    # Recursive: is the user in the group through any nesting?
    $nested = Get-ADGroupMember $GroupName -Recursive | Where-Object SamAccountName -eq $SamAccountName
    [pscustomobject]@{
        User = $SamAccountName; Group = $GroupName
        DirectMember = [bool]$direct; EffectiveMember = [bool]$nested
        NextStep = if ($nested) { 'AD is correct: refresh the token (sign out/in or klist purge), then check share + NTFS ACLs' }
                   else { 'Not a member: fix membership first' }
    }
}
```

### Work the tickets

```powershell
. .\troubleshooting\C90.Diagnostics.ps1
Get-C90LockoutReport -SamAccountName alex.rivera   # CallerComputer = CLIENT01 → the saved credential
Get-C90PasswordStatus -SamAccountName maria.chen   # MinAge / History explain IAM-2035
Test-C90ObjectOnAllDCs -SamAccountName maria.chen  # single DC: explains what you'd look for with two
Test-C90GroupAccess -SamAccountName david.kim -GroupName Sales-Team
```

On CLIENT01 for IAM-2034: `cmdkey /list`, remove the stale entry, `net use S: /delete`.
For IAM-2037 on CLIENT01 as david.kim: `whoami /groups`, then `klist purge` and reconnect.

Your lab has one DC, so IAM-2036 can only be studied, not reproduced. Write
down what `repadmin /showrepl` and `repadmin /syncall /AdeP` would show with
two DCs. You can build a DC02 later as a stretch goal.

## Validation checklist

- IAM-2034: lockout found in the audit log (who and when), account unlocked
- IAM-2035: refusal explained from `Get-PasswordPolicy` values, compliant password set
- IAM-2036: user visible in the cloud after `Start-DirectorySync`
- IAM-2037: `Get-EffectiveAccess` before and after, session revoked
- Each ticket written up with situation, evidence, root cause, fix, prevention
- `C90.Diagnostics.ps1` written and committed to GitHub

## Challenge

IAM-2038: `david.kim` can sign in but gets "Access denied" on a SharePoint
site that grants `Sales-Team`. AD says he is a member. What is different about
cloud apps, and where does the group actually have to exist? (Hint: Lab 4.)

## Troubleshooting quick reference

| Problem | Command |
|---|---|
| Who is locked out | `Search-ADAccount -LockedOut` |
| Unlock | `Unlock-ADAccount alex.rivera` |
| Effective password policy | `Get-ADUserResultantPasswordPolicy alex.rivera` |
| Replication health | `repadmin /replsummary`, `repadmin /showrepl` |
| Token contents | `whoami /groups`, `klist` |
| Saved credentials | `cmdkey /list` |

## GitHub assignment

Commit `troubleshooting/C90.Diagnostics.ps1` and one markdown write-up per
ticket in `troubleshooting/tickets/IAM-203x.md`.

## Resume bullet

> Built a PowerShell diagnostics toolkit for AD lockouts, password-policy
> failures, replication checks and group-access issues; traced repeat lockouts
> to stale cached credentials using event 4740 and per-DC `badPwdCount`.

## Interview question

"A user keeps getting locked out every morning. Walk me through it." Expected:
4740 → caller computer → cached credentials / mapped drive / phone / service →
remove the source → verify it stays unlocked.

## Homework

- Read Microsoft Learn: *Troubleshooting account lockout*.
- Reset `PasswordHistoryCount` and `MinPasswordAge` to your baseline and note why.
