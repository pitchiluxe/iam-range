<#
.SYNOPSIS
    Shared helpers for the AD Enterprise Lab VirtualBox kit. Dot-source it.

.DESCRIPTION
    One place that reads adlab.vbox.json, finds VBoxManage and runs
    PowerShell inside a guest through VirtualBox Guest Control. Every other
    script in this folder uses these, so the VM names, MAC addresses and the
    lab credential are written down exactly once.
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Expand-AdLabPath([string]$Path) {
    return [Environment]::ExpandEnvironmentVariables($Path)
}

function Get-AdLabConfig {
    $path = Join-Path $PSScriptRoot 'adlab.vbox.json'
    $cfg = Get-Content -Raw -Path $path | ConvertFrom-Json
    $cfg.vboxManage = Expand-AdLabPath $cfg.vboxManage
    $cfg.vmFolder = Expand-AdLabPath $cfg.vmFolder
    $cfg.isos.server = Expand-AdLabPath $cfg.isos.server
    $cfg.isos.client = Expand-AdLabPath $cfg.isos.client
    # The Greenfield Build lab reads the learner's hand-built VMs instead.
    # A calling script opts in with $script:AdLabVmSet = 'Build'.
    $set = Get-Variable -Name AdLabVmSet -Scope Script -ValueOnly -ErrorAction SilentlyContinue
    if ($set -eq 'Build' -and $cfg.PSObject.Properties['build']) {
        $cfg.vms = $cfg.build.vms
        $cfg.group = $cfg.build.group
    }
    return $cfg
}

function Invoke-VBoxManage {
    <#
        Run VBoxManage and return everything it printed, as text.
        VBoxManage writes progress bars ("0%...10%...") to stderr. Windows
        PowerShell 5.1 (powershell.exe, which the desktop app uses) turns redirected
        stderr into an error record, and under $ErrorActionPreference = 'Stop' that
        aborts the script mid-operation. Callers check $LASTEXITCODE instead.
    #>
    $cfg = Get-AdLabConfig
    $ErrorActionPreference = 'Continue'
    & $cfg.vboxManage @args 2>&1 | ForEach-Object { "$_" }
}

function Invoke-VBox {
    <# Run VBoxManage; throw with its own error text when it fails. #>
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
    $cfg = Get-AdLabConfig
    $out = Invoke-VBoxManage @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "VBoxManage $($Arguments -join ' ') failed:`n$($out -join "`n")"
    }
    return $out
}

function Test-AdLabVmExists([string]$VmName) {
    $cfg = Get-AdLabConfig
    $list = Invoke-VBoxManage list vms
    return [bool]($list | Where-Object { $_ -match "^`"$([regex]::Escape($VmName))`" " })
}

function Get-AdLabVmState([string]$VmName) {
    <# 'running', 'paused', 'poweroff', 'saved', 'aborted'… — from VirtualBox itself. #>
    $cfg = Get-AdLabConfig
    $line = Invoke-VBoxManage showvminfo $VmName --machinereadable | Where-Object { $_ -like 'VMState=*' }
    return ($line -replace '^VMState="(.*)"$', '$1')
}

function Test-AdLabVmRunning([string]$VmName) {
    # "list runningvms" also lists paused VMs; a paused VM cannot answer anything.
    return (Get-AdLabVmState $VmName) -eq 'running'
}

function Invoke-AdLabGuest {
    <#
    .SYNOPSIS
        Run a PowerShell script block inside a guest and return its stdout.
    .NOTES
        Uses Guest Control (needs Guest Additions, installed by the build).
        The script is sent -EncodedCommand so no quoting survives the trip.
    #>
    param(
        [Parameter(Mandatory)][ValidateSet('DC01', 'CLIENT01')][string]$Host_,
        [Parameter(Mandatory)][string]$Script,
        [int]$TimeoutSec = 300
    )
    $cfg = Get-AdLabConfig
    $vm = $cfg.vms.$Host_.vmName
    $ps = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
    if ($Script.Length -le 1500) {
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Script))
        $out = Invoke-VBoxManage guestcontrol $vm run --exe $ps `
            --username $cfg.adminUser --password $cfg.adminPassword `
            --timeout ($TimeoutSec * 1000) --wait-stdout --wait-stderr `
            '--' powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand $encoded
    } else {
        # Long scripts go in as a file. Passed on the command line they exceed
        # Guest Control's argument buffer (VERR_BUFFER_OVERFLOW) and the guest
        # session hangs until it times out.
        $name = "adlab-$([guid]::NewGuid().ToString('N')).ps1"
        $local = Join-Path $env:TEMP $name
        Set-Content -Path $local -Value $Script -Encoding UTF8
        try {
            $copy = Invoke-VBoxManage guestcontrol $vm copyto `
                --username $cfg.adminUser --password $cfg.adminPassword `
                --target-directory 'C:\Windows\Temp\' $local
            if ($LASTEXITCODE -ne 0) { throw "Copying the script into $Host_ failed:`n$($copy -join "`n")" }
            $out = Invoke-VBoxManage guestcontrol $vm run --exe $ps `
                --username $cfg.adminUser --password $cfg.adminPassword `
                --timeout ($TimeoutSec * 1000) --wait-stdout --wait-stderr `
                '--' powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "C:\Windows\Temp\$name"
        } finally {
            Remove-Item $local -Force -ErrorAction SilentlyContinue
        }
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Guest command on $Host_ failed (exit $LASTEXITCODE):`n$($out -join "`n")"
    }
    return ($out -join "`n")
}

function Wait-AdLabGuestReady {
    <# Wait until Guest Control answers on a VM — i.e. Windows is installed and signed in. #>
    param([Parameter(Mandatory)][ValidateSet('DC01', 'CLIENT01')][string]$Host_, [int]$TimeoutMin = 90)
    $deadline = (Get-Date).AddMinutes($TimeoutMin)
    $cfg = Get-AdLabConfig
    $vm = $cfg.vms.$Host_.vmName
    while ((Get-Date) -lt $deadline) {
        # VirtualBox's Windows post-install step can end with a shutdown rather
        # than a restart; an installed-but-off VM would otherwise be waited on forever.
        if ((Get-AdLabVmState $vm) -in @('poweroff', 'aborted')) {
            Write-Host "  $Host_ powered itself off after setup; starting it again"
            Invoke-VBoxManage startvm $vm --type gui | Out-Null
        }
        try {
            $name = Invoke-AdLabGuest -Host_ $Host_ -Script 'hostname' -TimeoutSec 30
            if ($name) { return $name.Trim() }
        } catch { }
        Start-Sleep -Seconds 30
        Write-Host "  … waiting for $Host_ ($(Get-Date -Format HH:mm))"
    }
    throw "$Host_ did not become ready within $TimeoutMin minutes."
}

function Format-AdLabMac([string]$Mac) {
    # 080027AD0101 -> 08-00-27-AD-01-01, the form Windows' Get-NetAdapter prints.
    return (($Mac -split '(..)' | Where-Object { $_ }) -join '-').ToUpper()
}
