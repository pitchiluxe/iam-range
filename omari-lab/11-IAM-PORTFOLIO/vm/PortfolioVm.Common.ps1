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

function Test-PortfolioDomainReady {
    try {
        $r = Invoke-PortfolioGuest -TimeoutSec 60 -Script "(Get-CimInstance Win32_ComputerSystem).DomainRole -ge 4 -and (Get-Service NTDS).Status -eq 'Running' -and (Test-Path 'C:\IAM')"
        return ($r.Trim() -eq 'True')
    } catch { return $false }
}

function Write-JsonResult([hashtable]$Result) {
    $Result | ConvertTo-Json -Depth 6 -Compress
}
