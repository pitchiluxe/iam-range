<#
.SYNOPSIS
    Prepare the real DC01 for the portfolio VM track, then save "Portfolio-Base".

.DESCRIPTION
    The portfolio projects need a working domain with the enterprise
    organization in place. Starting from DC01 after AD Lab 01 (named DC01,
    172.16.0.1, DNS 127.0.0.1) this:

      1. promotes DC01 to the forest corp.technobiz.local (NetBIOS CORP) if it
         is not a domain controller yet, and waits through the reboot;
      2. builds the enterprise baseline from the blueprint: Enterprise_Root,
         Tier0_Admins, Tier1_Systems, Tier2_Staff, Groups\Security_Groups,
         Groups\Distribution_Groups, Disabled_Accounts, the GS- groups, and the
         domain password policy (14 / 24 / 90 days / complexity / no reversible);
      3. creates C:\IAM (where the portfolio work lives) and C:\Shares;
      4. saves the offline snapshot "Portfolio-Base".

    Your AD Enterprise Lab progress is not lost: it is in its own snapshots
    (e.g. "Lab02-Start"). Restore those to continue that series.

    The DSRM password is generated inside the VM and never stored. If you ever
    need Directory Services Restore Mode, reset it on DC01 with
    ntdsutil "set dsrm password".

.PARAMETER Json
    Print one JSON line {ok, steps, error} (what IAM Range reads).
#>
[CmdletBinding()]
param([switch]$Json, [switch]$NoSnapshot)

. (Join-Path $PSScriptRoot 'PortfolioVm.Common.ps1')
$cfg = Get-AdLabConfig
$vm = $cfg.vms.DC01.vmName
$steps = New-Object System.Collections.Generic.List[string]
function Step([string]$m) { $steps.Add($m); if (-not $Json) { Write-Host $m } }

try {
    if (-not (Test-AdLabVmExists $vm)) { throw "$vm does not exist. Build it with omari-lab\10-AD-ENTERPRISE-VBOX first." }
    if (-not (Test-AdLabVmRunning $vm)) { Invoke-VBox startvm $vm --type gui | Out-Null; Step "Started $vm." }
    $name = Wait-AdLabGuestReady -Host_ DC01 -TimeoutMin 20
    Step "DC01 is up (hostname $name)."

    $role = (Invoke-PortfolioGuest -TimeoutSec 60 -Script '(Get-CimInstance Win32_ComputerSystem).DomainRole').Trim()
    if ([int]$role -lt 4) {
        $pre = (Invoke-PortfolioGuest -TimeoutSec 60 -Script @'
$ip = Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias Internal -ErrorAction SilentlyContinue
"$env:COMPUTERNAME|$($ip.IPAddress)|$($ip.PrefixOrigin)"
'@).Trim()
        $parts = $pre -split '\|'
        if ($parts[0] -ne 'DC01' -or $parts[1] -ne '172.16.0.1' -or $parts[2] -ne 'Manual') {
            throw "DC01 is not at the end of AD Lab 01 (found: $pre). Finish Lab 01 or restore snapshot Lab02-Start, then run this again."
        }
        Step 'Promoting DC01 to the forest corp.technobiz.local (about 5-10 minutes, then a reboot)...'
        Invoke-PortfolioGuest -TimeoutSec 1200 -Script @'
$ErrorActionPreference = 'Stop'
Install-WindowsFeature AD-Domain-Services -IncludeManagementTools | Out-Null
$b = New-Object byte[] 24; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
$dsrm = ConvertTo-SecureString (([Convert]::ToBase64String($b)) + 'aA7!') -AsPlainText -Force
Install-ADDSForest -DomainName corp.technobiz.local -DomainNetbiosName CORP -InstallDns -SafeModeAdministratorPassword $dsrm -NoRebootOnCompletion -Force | Out-Null
Start-Process shutdown.exe -ArgumentList '/r /t 5 /c "AD DS promotion"'
'promoted'
'@ | Out-Null
        Start-Sleep -Seconds 60
        $deadline = (Get-Date).AddMinutes(25)
        $ready = $false
        while ((Get-Date) -lt $deadline -and -not $ready) {
            try {
                $ready = (Invoke-PortfolioGuest -TimeoutSec 60 -Script "(Get-Service NTDS,ADWS | Where-Object Status -eq 'Running').Count").Trim() -eq '2'
            } catch { }
            if (-not $ready) { Start-Sleep -Seconds 20 }
        }
        if (-not $ready) { throw 'DC01 did not come back as a domain controller within 25 minutes.' }
        Step 'DC01 is now a domain controller for corp.technobiz.local.'
    } else {
        Step 'DC01 is already a domain controller.'
    }

    Step 'Building the enterprise baseline (Enterprise_Root, tiers, groups, password policy, C:\IAM)...'
    $out = Invoke-PortfolioGuest -TimeoutSec 600 -Script @'
$ErrorActionPreference = 'Stop'
Import-Module ActiveDirectory
$d = Get-ADDomain; $DN = $d.DistinguishedName
$deadline = (Get-Date).AddMinutes(5)
while ((Get-Date) -lt $deadline) { try { Get-ADDomain | Out-Null; break } catch { Start-Sleep 10 } }
function OU($n, $p) { if (-not (Get-ADOrganizationalUnit -Filter "Name -eq '$n'" -SearchBase $p -SearchScope OneLevel -ErrorAction SilentlyContinue)) { New-ADOrganizationalUnit -Name $n -Path $p } }
OU 'Enterprise_Root' $DN
$root = "OU=Enterprise_Root,$DN"
foreach ($o in 'Tier0_Admins', 'Tier1_Systems', 'Tier2_Staff', 'Groups', 'Disabled_Accounts') { OU $o $root }
foreach ($o in 'Security_Groups', 'Distribution_Groups') { OU $o "OU=Groups,$root" }
$sg = "OU=Security_Groups,OU=Groups,$root"
foreach ($g in 'GS-Finance-Accounting-RW', 'GS-Engineering-DevOps-Admin', 'GS-HR-Onboarding-RO') {
    if (-not (Get-ADGroup -Filter "Name -eq '$g'" -ErrorAction SilentlyContinue)) { New-ADGroup -Name $g -SamAccountName $g -GroupScope Global -GroupCategory Security -Path $sg }
}
Set-ADDefaultDomainPasswordPolicy -Identity $d.DNSRoot -MinPasswordLength 14 -PasswordHistoryCount 24 -MaxPasswordAge (New-TimeSpan -Days 90) -ComplexityEnabled $true -ReversibleEncryptionEnabled $false
foreach ($p in 'C:\IAM', 'C:\IAM\scenarios', 'C:\Shares') { New-Item -ItemType Directory -Path $p -Force | Out-Null }
# The learner's work lives in C:\IAM: administrators only.
icacls 'C:\IAM' /inheritance:r /grant:r 'BUILTIN\Administrators:(OI)(CI)F' 'NT AUTHORITY\SYSTEM:(OI)(CI)F' | Out-Null
'baseline ok'
'@
    if ($out -notmatch 'baseline ok') { throw "Baseline failed: $out" }
    Step 'Baseline in place.'

    if (-not $NoSnapshot) {
        Step 'Saving snapshot Portfolio-Base (clean shutdown, snapshot, restart)...'
        $r = & (Join-Path $PSScriptRoot '..\..\10-AD-ENTERPRISE-VBOX\AdLab-Snapshot.ps1') -Save 'Portfolio-Base' -Only DC01 -Json | ConvertFrom-Json
        if (-not $r.ok) { throw "Snapshot failed: $($r.error)" }
        Wait-AdLabGuestReady -Host_ DC01 -TimeoutMin 15 | Out-Null
        Step 'Snapshot Portfolio-Base saved; DC01 is running.'
    }
    if ($Json) { Write-JsonResult @{ ok = $true; steps = $steps.ToArray(); error = $null } }
} catch {
    if ($Json) { Write-JsonResult @{ ok = $false; steps = $steps.ToArray(); error = $_.Exception.Message } } else { throw }
}
