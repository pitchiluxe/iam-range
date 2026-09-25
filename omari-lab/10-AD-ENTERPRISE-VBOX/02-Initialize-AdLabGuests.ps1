<#
.SYNOPSIS
    Finish the build: wait for Windows, name the adapters, snapshot "Lab01-Start".

.DESCRIPTION
    Only does what the lab takes for granted — not what the lab teaches:

      * waits until Setup has finished and Guest Additions answer
      * renames each adapter by MAC so the names match the lab
        (DC01: "Internet" and "Internal"; CLIENT01: "Ethernet")
      * allows ICMP echo so ping behaves like the lab diagnostics expect
        (Windows blocks it on an unidentified network by default)
      * saves the snapshot "Lab01-Start" (clean shutdown, offline snapshot, restart)

    It does NOT rename DC01, set any address, or install any role. That is Lab 01.
#>
[CmdletBinding()]
param([switch]$NoSnapshot, [ValidateSet('DC01', 'CLIENT01')][string[]]$Only = @('DC01', 'CLIENT01'))

. (Join-Path $PSScriptRoot 'AdLab.Common.ps1')
$cfg = Get-AdLabConfig

foreach ($key in $Only) {
    $spec = $cfg.vms.$key
    if (-not (Test-AdLabVmExists $spec.vmName)) { throw "$($spec.vmName) does not exist. Run 01-New-AdLabVMs.ps1 first." }
    Write-Host "`n=== $key ($($spec.vmName)) ===" -ForegroundColor Cyan
    if (-not (Test-AdLabVmRunning $spec.vmName)) { Invoke-VBox startvm $spec.vmName --type gui | Out-Null }

    $name = Wait-AdLabGuestReady -Host_ $key
    Write-Host "  Windows is up; hostname $name"

    $renames = ($spec.nics | ForEach-Object {
        "Get-NetAdapter | Where-Object MacAddress -eq '$(Format-AdLabMac $_.mac)' | Where-Object Name -ne '$($_.alias)' | Rename-NetAdapter -NewName '$($_.alias)'"
    }) -join "`n"
    Invoke-AdLabGuest -Host_ $key -Script @"
$renames
Get-NetFirewallRule -Name 'FPS-ICMP4-ERQ-In*' -ErrorAction SilentlyContinue | Enable-NetFirewallRule
Get-NetAdapter | Sort-Object Name | ForEach-Object { "  adapter `$(`$_.Name)  `$(`$_.MacAddress)  `$(`$_.Status)" }
"@ | Write-Host
}

if (-not $NoSnapshot) {
    # Same save logic as IAM Range's "Start over" menu: clean shutdown, offline
    # snapshot, start again. (Live snapshots proved unreliable.)
    $r = & (Join-Path $PSScriptRoot 'AdLab-Snapshot.ps1') -Save 'Lab01-Start' -Only $Only -Json | ConvertFrom-Json
    if (-not $r.ok) { throw "Could not save Lab01-Start: $($r.error)" }
    Write-Host "  snapshot Lab01-Start saved for $($r.saved -join ', ')" -ForegroundColor Green
}

Write-Host "`nReady. Open IAM Range -> AD Enterprise Lab -> 'Real VMs' and start Lab 01 inside DC01." -ForegroundColor Yellow
