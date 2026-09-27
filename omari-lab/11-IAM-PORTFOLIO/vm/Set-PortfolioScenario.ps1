<#
.SYNOPSIS
    Set up (or restart) one portfolio project's scenario inside the real DC01.

.EXAMPLE
    .\Set-PortfolioScenario.ps1 -Project p04
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('p01', 'p02', 'p03', 'p04', 'p08', 'p10')][string]$Project,
    [switch]$Json
)

. (Join-Path $PSScriptRoot 'PortfolioVm.Common.ps1')
try {
    if (-not (Test-AdLabVmRunning $(Get-AdLabConfig).vms.DC01.vmName)) { throw 'DC01 is not running. Start it and try again.' }
    if (-not (Test-PortfolioDomainReady)) { throw 'DC01 is not prepared for the portfolio yet. Run Initialize-PortfolioDC.ps1 (IAM Portfolio: "Prepare DC01") first.' }
    $body = Get-Content -Raw (Join-Path $PSScriptRoot 'guest\Portfolio.Scenarios.ps1')
    $out = Invoke-PortfolioGuest -TimeoutSec 600 -Script ("`$Project = '$Project'`n" + $body)
    $message = ($out -split "`n" | Where-Object { $_.Trim() } | Select-Object -Last 1).Trim()
    if ($Json) { Write-JsonResult @{ ok = $true; project = $Project; message = $message; error = $null } } else { Write-Host $message }
} catch {
    if ($Json) { Write-JsonResult @{ ok = $false; project = $Project; message = $null; error = $_.Exception.Message } } else { throw }
}
