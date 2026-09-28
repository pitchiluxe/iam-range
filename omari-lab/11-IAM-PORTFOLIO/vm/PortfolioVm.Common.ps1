<#
    Shared helpers for the portfolio VM track. Reuses the AD Enterprise Lab
    VirtualBox kit (VM names, credentials, Guest Control) so there is one
    definition of DC01.
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\..\10-AD-ENTERPRISE-VBOX\AdLab.Common.ps1')

$script:PortfolioVmProjects = @('p01', 'p02', 'p03', 'p04', 'p08', 'p10')

function Invoke-PortfolioGuest([string]$Script, [int]$TimeoutSec = 600) {
    # Scripts over 1.5 KB travel as a file (Guest Control's argument buffer is small).
    return Invoke-AdLabGuest -Host_ DC01 -Script $Script -TimeoutSec $TimeoutSec
}

function Wait-PortfolioDc {
    <#
        Make sure DC01 is running and answering before the portfolio talks to it.
        Right after a snapshot restore or a boot, Guest Control refuses logons for a
        minute or two, and AD Web Services starts after that; neither means
        "not prepared". Throws only when DC01 truly is not a prepared DC.
    #>
    param([int]$TimeoutMin = 10)
    $vm = (Get-AdLabConfig).vms.DC01.vmName
    if (-not (Test-AdLabVmExists $vm)) { throw 'DC01 does not exist. Build the AD lab VMs first (10-AD-ENTERPRISE-VBOX).' }
    if ((Get-AdLabVmState $vm) -eq 'paused') { throw 'DC01 is paused in VirtualBox. Resume it and try again.' }
    Wait-AdLabGuestReady -Host_ DC01 -TimeoutMin $TimeoutMin | Out-Null   # also starts a powered-off DC01
    $deadline = (Get-Date).AddMinutes(5)
    $probe = "if ((Get-CimInstance Win32_ComputerSystem).DomainRole -lt 4 -or -not (Test-Path 'C:\IAM')) { 'no' } elseif ((Get-Service NTDS, ADWS | Where-Object Status -ne 'Running')) { 'starting' } else { try { Get-ADDomain | Out-Null; 'yes' } catch { 'starting' } }"
    while ($true) {
        $r = (Invoke-PortfolioGuest -TimeoutSec 60 -Script $probe).Trim()
        if ($r -eq 'yes') { return }
        if ($r -eq 'no') { throw 'DC01 is not prepared for the portfolio yet. Run Initialize-PortfolioDC.ps1 (IAM Portfolio: "Prepare DC01") first.' }
        if ((Get-Date) -gt $deadline) { throw 'DC01 is up, but Active Directory did not finish starting within 5 minutes. Wait a minute and try again.' }
        Start-Sleep -Seconds 10
    }
}

function Write-JsonResult([hashtable]$Result) {
    $Result | ConvertTo-Json -Depth 6 -Compress
}
