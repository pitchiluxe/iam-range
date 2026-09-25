<#
.SYNOPSIS
    Save, list or restore save points for both lab VMs together. This is how
    a real lab is reset.

.DESCRIPTION
    Names follow the series: "Lab01-Start" is two fresh machines; "LabNN-Start"
    is the moment Lab NN began. IAM Range's "Start over" menu calls this same
    script, so the app and the command line behave identically.

    Save points are OFFLINE snapshots: Windows is shut down cleanly, the
    snapshot is taken, the VM is started again. Live snapshots (taken while
    running) crashed VirtualBox's service on this kind of host and left the
    guest frozen; a clean shutdown costs a minute and always works.

.EXAMPLE
    .\AdLab-Snapshot.ps1 -Save Lab04-Start
    .\AdLab-Snapshot.ps1 -List
    .\AdLab-Snapshot.ps1 -Restore Lab01-Start      # start the whole series over
#>
[CmdletBinding(DefaultParameterSetName = 'List')]
param(
    [Parameter(ParameterSetName = 'Save', Mandatory)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9 _.-]{0,39}$')][string]$Save,
    [Parameter(ParameterSetName = 'Restore', Mandatory)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9 _.-]{0,39}$')][string]$Restore,
    [Parameter(ParameterSetName = 'List')][switch]$List,
    [ValidateSet('DC01', 'CLIENT01')][string[]]$Only = @('DC01', 'CLIENT01'),
    # One JSON line on stdout (what IAM Range reads) instead of progress text.
    [switch]$Json
)

. (Join-Path $PSScriptRoot 'AdLab.Common.ps1')
$cfg = Get-AdLabConfig

function Say([string]$m) { if (-not $Json) { Write-Host $m } }

function Get-SnapshotNames([string]$vm) {
    $out = & $cfg.vboxManage snapshot $vm list --machinereadable 2>$null
    return @($out | Where-Object { $_ -match '^SnapshotName[^=]*="(.*)"$' } | ForEach-Object { $Matches[1] })
}

function Wait-VmState([string]$vm, [string[]]$states, [int]$seconds) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        $info = & $cfg.vboxManage showvminfo $vm --machinereadable 2>$null
        # "$(...)" turns "no such line" (an empty array) into '' so the tests below work.
        $state = "$(($info | Where-Object { $_ -like 'VMState=*' }) -replace '^VMState="(.*)"$', '$1')"
        $session = "$(($info | Where-Object { $_ -like 'SessionState=*' }) -replace '^SessionState="(.*)"$', '$1')"
        # A powered-off VM can still be locked for a moment while its process exits.
        if ($states -contains $state -and ($session -eq '' -or $session -eq 'Unlocked')) { return $true }
        Start-Sleep -Seconds 2
    }
    return $false
}

function Wait-VmReleased([string]$vm) {
    # After a power-off the VM process takes a few seconds to exit and release
    # its lock; restoring or starting before that fails with "locked by a session".
    $deadline = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $deadline) {
        $running = & $cfg.vboxManage list runningvms 2>$null
        $proc = Get-CimInstance Win32_Process -Filter "Name='VirtualBoxVM.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -match [regex]::Escape($vm) }
        if (-not ($running -match "^`"$([regex]::Escape($vm))`" ") -and -not $proc) { Start-Sleep 2; return }
        Start-Sleep 2
    }
}

function Start-VmRetry([string]$vm) {
    for ($i = 1; $i -le 10; $i++) {
        & $cfg.vboxManage startvm $vm --type gui 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { return }
        Start-Sleep 3
    }
    throw "$vm could not be started (still locked by VirtualBox)."
}

function Stop-VmCleanly([string]$key) {
    $vm = $cfg.vms.$key.vmName
    if ((Get-AdLabVmState $vm) -ne 'running') { return }
    Say "  shutting down $key cleanly…"
    # Ask again every minute: a Windows still finishing first sign-in or an
    # update can drop the first request. Windows Server can take several
    # minutes to shut down cleanly.
    $asked = $false
    for ($i = 0; $i -lt 5 -and -not $asked; $i++) {
        try { Invoke-AdLabGuest -Host_ $key -Script 'Stop-Computer -Force' -TimeoutSec 30 | Out-Null } catch { }
        $asked = Wait-VmState $vm @('poweroff') 60
    }
    if (-not $asked) {
        & $cfg.vboxManage controlvm $vm acpipowerbutton 2>$null | Out-Null
        if (-not (Wait-VmState $vm @('poweroff') 300)) { throw "$key did not shut down within 10 minutes." }
    }
}

$result = [ordered]@{ ok = $true; saved = @(); restored = @(); missing = @(); error = $null }

try {
    switch ($PSCmdlet.ParameterSetName) {
        'Save' {
            foreach ($key in $Only) {
                $vm = $cfg.vms.$key.vmName
                if (-not (Test-AdLabVmExists $vm)) { $result.missing += $key; continue }
                $state = Get-AdLabVmState $vm
                if ($state -notin @('running', 'poweroff', 'aborted')) { $result.missing += $key; continue }
                $wasRunning = ($state -eq 'running')
                Stop-VmCleanly $key
                Wait-VmReleased $vm
                # One save point per name. VirtualBox refuses to delete a
                # snapshot that later ones branch from; then the old one is
                # renamed out of the way instead, never lost.
                if ((Get-SnapshotNames $vm) -contains $Save) {
                    & $cfg.vboxManage snapshot $vm delete $Save 2>&1 | Out-Null
                    if ($LASTEXITCODE -ne 0) {
                        Invoke-VBox snapshot $vm edit $Save --name "$Save (replaced $(Get-Date -Format 'yyyy-MM-dd HHmm'))" | Out-Null
                    }
                }
                Invoke-VBox snapshot $vm take $Save --description "Save point from IAM Range ($(Get-Date -Format 'yyyy-MM-dd HH:mm'))" | Out-Null
                if ($wasRunning) { Start-VmRetry $vm }
                $result.saved += $key
                Say "$vm -> save point '$Save'$(if ($wasRunning) { ' (restarted)' })"
            }
            if (-not $result.saved.Count) { throw 'No lab VM could be saved.' }
        }
        'Restore' {
            foreach ($key in $Only) {
                $vm = $cfg.vms.$key.vmName
                if (-not (Test-AdLabVmExists $vm) -or (Get-SnapshotNames $vm) -notcontains $Restore) { $result.missing += $key; continue }
                if ((Get-AdLabVmState $vm) -notin @('poweroff', 'aborted', 'saved')) {
                    & $cfg.vboxManage controlvm $vm poweroff 2>$null | Out-Null
                }
                if (-not (Wait-VmState $vm @('poweroff', 'aborted', 'saved') 90)) { throw "$key did not power off." }
                Wait-VmReleased $vm
                $done = $false
                for ($try = 1; $try -le 3 -and -not $done; $try++) {
                    & $cfg.vboxManage snapshot $vm restore $Restore 2>&1 | Out-Null
                    if ($LASTEXITCODE -eq 0) { $done = $true } else { Start-Sleep -Seconds 5 }
                }
                if (-not $done) { throw "$key could not be restored to '$Restore'." }
                Wait-VmReleased $vm
                Start-VmRetry $vm
                $result.restored += $key
                Say "$vm restored to '$Restore' and started"
            }
            if (-not $result.restored.Count) { throw "No lab VM has a save point named '$Restore'." }
        }
        default {
            foreach ($key in $Only) {
                $vm = $cfg.vms.$key.vmName
                Say "== $vm"
                foreach ($n in Get-SnapshotNames $vm) { Say "   $n" }
            }
        }
    }
} catch {
    $result.ok = $false
    $result.error = $_.Exception.Message
    if (-not $Json) { throw }
}

if ($Json) { $result | ConvertTo-Json -Compress }
