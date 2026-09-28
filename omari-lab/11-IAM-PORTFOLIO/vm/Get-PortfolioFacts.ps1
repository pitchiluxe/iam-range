<#
.SYNOPSIS
    Read-only: collect what the portfolio VM checks grade, from the real DC01.

.DESCRIPTION
    Prints one JSON line {ok, facts, error}. IAM Range's IAM Portfolio app
    grades it with deterministic checks (src/vm/portfolio/vmChecks.ts); the
    Ollama instructor then explains the result. Nothing in DC01 is changed.
#>
[CmdletBinding()]
param([switch]$Json)

. (Join-Path $PSScriptRoot 'PortfolioVm.Common.ps1')
try {
    Wait-PortfolioDc
    $raw = Invoke-PortfolioGuest -TimeoutSec 420 -Script (Get-Content -Raw (Join-Path $PSScriptRoot 'guest\Portfolio.Collector.ps1'))
    $line = $raw -split "`n" | Where-Object { $_.TrimStart().StartsWith('{') } | Select-Object -Last 1
    if (-not $line) { throw "The collector returned no data: $($raw.Substring(0, [Math]::Min(300, $raw.Length)))" }
    if ($Json) { '{"ok":true,"error":null,"facts":' + $line.Trim() + '}' } else { $line | ConvertFrom-Json | ConvertTo-Json -Depth 8 }
} catch {
    if ($Json) { Write-JsonResult @{ ok = $false; facts = $null; error = $_.Exception.Message } } else { throw }
}
