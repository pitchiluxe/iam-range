# Lab 11 — Access Request Ticketing

**Days 71–77 · Phase 3: Lifecycle & Governance · Repo:** `iam-access-governance` (folder `ticketing/`)

## Do this lab in the app

Two halves: the **ticket** lives in your PowerShell module, the **access
change** happens in the app's directory.

1. **PowerShell (this PC)**: save the module below as
   `Documents\c90\ticketing\C90.Tickets.psm1`. Its owner check reads
   `$Script:Owners`, so it runs without a domain controller. Then:

```powershell
# PowerShell (this PC)
cd $HOME\Documents\c90
Import-Module .\ticketing\C90.Tickets.psm1 -Force
$t = New-C90Ticket -Requester alex.rivera -Group Finance-Reports -Justification 'Q3 audit' -Hours 0.25
```

   Try a self-approval on its own — it must be refused:
   `Set-C90TicketState -Id $t.Id -To Approved -By alex.rivera`. Then the real one:

```powershell
# PowerShell (this PC)
Set-C90TicketState -Id $t.Id -To Approved -By sarah.johnson -Note 'Audit scope confirmed'
Complete-C90Ticket -Id $t.Id
```

   `Complete-C90Ticket` prints the exact command that fulfils the ticket in the app.
2. **Terminal**: run that command — for example:

```powershell
Enable-PimRole -Identity alex.rivera -Role role-finance-reports -Minutes 15 -Justification "REQ-0001 Q3 audit"
```

3. **PowerShell (this PC)**: close the ticket, then check SLAs:

```powershell
# PowerShell (this PC)
Set-C90TicketState -Id $t.Id -To Closed -By $env:USERNAME -Note 'User confirmed access'
Get-C90SlaReport | Format-Table
```

4. Open the app's **Ticket Queue**, click **Generate Work**, and work two access
   tickets there. Compare its lifecycle with yours.

## Career objective

Build the request side of governance the way ServiceNow models it: a ticket
with a strict lifecycle, an SLA clock, separation of duties, and fulfilment
that calls real automation — then compare it with the in-app Ticket Queue.

## Quick review

1. Why must a ticket's state only move along allowed transitions?
2. What is an SLA breach, and who gets alerted?
3. Name two separation-of-duties rules for access requests.
4. What's the difference between *approved* and *fulfilled*?
5. Why is a ticket number in the AD `Description` useful?

## Scenario

The help desk wants self-service access requests. Each request is a ticket:
`New → PendingApproval → Approved → Fulfilled → Closed`, or `Denied`. Approval
SLA is 8 business hours; fulfilment SLA is 4 hours after approval.

## Concept

```
New ─► PendingApproval ─► Approved ─► Fulfilled ─► Closed
              └─────────► Denied
```

Every transition records *who* and *when*. Anything else is refused. That
refusal list is what makes the data trustworthy for an auditor.

## Hands-on lab

### `ticketing/C90.Tickets.psm1`

```powershell
$Script:Db  = '.\ticketing\data\tickets.json'
$Script:Allowed = @{
    New = @('PendingApproval'); PendingApproval = @('Approved','Denied')
    Approved = @('Fulfilled'); Fulfilled = @('Closed'); Denied = @(); Closed = @()
}
$Script:SlaHours = @{ PendingApproval = 8; Approved = 4 }
# Resource owners — the only valid approvers. Mirrors ManagedBy on the groups.
$Script:Owners = @{ 'Finance-Reports' = 'sarah.johnson'; 'Sales-Team' = 'alex.rivera' }

function Get-C90Tickets {
    # ForEach-Object unrolls the array: PS 5.1's ConvertFrom-Json emits a JSON array as ONE object.
    if (Test-Path $Script:Db) { @(Get-Content $Script:Db -Raw | ConvertFrom-Json | ForEach-Object { $_ }) } else { @() }
}
function Save-C90Tickets($t) {
    New-Item -ItemType Directory -Force (Split-Path $Script:Db) | Out-Null
    ConvertTo-Json @($t) -Depth 6 | Set-Content $Script:Db
}

function New-C90Ticket {
    param([Parameter(Mandatory)][string]$Requester, [Parameter(Mandatory)][string]$Group,
          [Parameter(Mandatory)][string]$Justification, [double]$Hours = 4)
    $all = Get-C90Tickets
    $n = 1 + (($all | ForEach-Object { [int]($_.Id -replace 'REQ-') } | Measure-Object -Maximum).Maximum)
    $t = [pscustomobject]@{
        Id = 'REQ-{0:D4}' -f $n; Requester = $Requester; Group = $Group; Hours = $Hours
        Justification = $Justification; State = 'New'; History = @()
    }
    $t.History += [pscustomobject]@{ State = 'New'; By = $Requester; At = (Get-Date).ToString('o'); Note = '' }
    Save-C90Tickets (@($all) + $t)
    Set-C90TicketState -Id $t.Id -To PendingApproval -By 'system' -Note 'Routed to resource owner'
}

function Set-C90TicketState {
    param([Parameter(Mandatory)][string]$Id, [Parameter(Mandatory)][string]$To,
          [Parameter(Mandatory)][string]$By, [string]$Note = '')
    $all = Get-C90Tickets
    $t = $all | Where-Object Id -eq $Id
    if (-not $t) { throw "$Id not found" }
    if ($To -notin $Script:Allowed[$t.State]) { throw "$Id : $($t.State) -> $To is not an allowed transition" }
    if ($To -in 'Approved','Denied') {
        $owner = $Script:Owners[$t.Group]   # on a real domain: (Get-ADGroup $t.Group -Properties ManagedBy).ManagedBy
        if (-not $owner) { throw "$($t.Group) has no owner" }
        if ($By -ne $owner)       { throw "Only $owner can decide $Id" }
        if ($By -eq $t.Requester) { throw 'Requester cannot approve their own ticket' }
    }
    $t.State = $To
    $t.History += [pscustomobject]@{ State = $To; By = $By; At = (Get-Date).ToString('o'); Note = $Note }
    Save-C90Tickets $all
    $t
}

function Complete-C90Ticket {
    # Fulfilment: the access change itself happens in the directory. In IAM
    # Range that is the Terminal; on a real domain, Lab 10's Grant-C90JitAccess.
    param([Parameter(Mandatory)][string]$Id)
    $t = Get-C90Tickets | Where-Object Id -eq $Id
    if ($t.State -ne 'Approved') { throw "$Id is $($t.State), not Approved" }
    $minutes = [int]([double]$t.Hours * 60)
    Write-Host 'Run this in the IAM Range Terminal, then come back:' -ForegroundColor Cyan
    Write-Host "  Enable-PimRole -Identity $($t.Requester) -Role role-finance-reports -Minutes $minutes -Justification `"$Id $($t.Justification)`""
    Set-C90TicketState -Id $Id -To Fulfilled -By $env:USERNAME -Note "JIT $minutes min"
}

function Get-C90SlaReport {
    $now = Get-Date
    Get-C90Tickets | Where-Object { $Script:SlaHours.ContainsKey($_.State) } | ForEach-Object {
        $since = [datetime](($_.History | Where-Object State -eq $_.State | Select-Object -Last 1).At)
        $age = ($now - $since).TotalHours
        [pscustomobject]@{ Id = $_.Id; State = $_.State; AgeHours = [math]::Round($age, 1)
            SlaHours = $Script:SlaHours[$_.State]; Breached = $age -gt $Script:SlaHours[$_.State] }
    }
}

Export-ModuleMember -Function New-C90Ticket, Set-C90TicketState, Complete-C90Ticket, Get-C90Tickets, Get-C90SlaReport
```

### Walk a ticket through

```powershell
Import-Module .\ticketing\C90.Tickets.psm1 -Force
$t = New-C90Ticket -Requester alex.rivera -Group Finance-Reports -Justification 'Q3 audit' -Hours 0.5
Set-C90TicketState -Id $t.Id -To Fulfilled -By alex.rivera          # refused: skips approval
Set-C90TicketState -Id $t.Id -To Approved  -By alex.rivera          # refused: self-approval
Set-C90TicketState -Id $t.Id -To Approved  -By sarah.johnson -Note 'Audit scope confirmed'
Complete-C90Ticket -Id $t.Id
Set-C90TicketState -Id $t.Id -To Closed -By $env:USERNAME -Note 'User confirmed access'

New-C90Ticket -Requester david.kim -Group Finance-Reports -Justification 'curious' | Out-Null
Get-C90SlaReport | Format-Table
(Get-C90Tickets | Where-Object Id -eq $t.Id).History | Format-Table
```

To test a breach without waiting 8 hours, temporarily set
`$Script:SlaHours.PendingApproval = 0.01` in the module.

### Compare with the in-app Ticket Queue

Open **Ticket Queue** in IAM Range, work two access tickets, and note three
things it enforces that your module doesn't yet (and one your module does
that it doesn't).

## Validation checklist

- Illegal transitions and self-approval are refused with clear messages
- One ticket travelled New → Closed with five history entries
- Fulfilment ran `Enable-PimRole` in the app, and the activation later expired
- SLA report shows one breach (forced) and one healthy ticket
- Written comparison with the in-app Ticket Queue

## Challenge

IAM-10101: `REQ-0007` shows `Fulfilled` but the user has no access and there's
no JIT log line. What does that tell you about where the failure happened, and
how would you change `Complete-C90Ticket` so this state can't exist? (Hint:
only move to `Fulfilled` after the grant succeeds — the current order already
does; prove it by breaking the grant.)

## Troubleshooting

| Symptom | Cause |
|---|---|
| `ConvertFrom-Json` fails | `tickets.json` hand-edited and invalid — validate before saving |
| Owner can't approve | Group missing from `$Script:Owners` (or no `ManagedBy` on a real domain) |
| Duplicate IDs | Two sessions wrote at once — a real system needs a database with locking |

## GitHub assignment

`ticketing/` module, a sample `tickets.json` (lab data), `docs/lab11-ticketing.md`
with the state diagram and the Ticket Queue comparison.

## Resume bullet

> Built an access-request ticketing workflow with an enforced state machine,
> owner-only approval, separation-of-duties checks, SLA breach reporting and
> fulfilment wired to automated just-in-time AD access.

## Interview question

"An auditor asks you to prove a specific access grant was approved. What do
you show?" Ticket history (who/when), the approval by the owner, the change log
line with the same ticket ID, and the expiry.

## Homework

- Add a `Reopen` transition from `Fulfilled` back to `Approved` and justify it.
- Read ServiceNow's *Request Item (RITM)* model and map it to your states.
