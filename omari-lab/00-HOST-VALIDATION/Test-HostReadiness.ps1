#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Validate the host before building the OMARI Technologies Hyper-V lab.

.DESCRIPTION
    Read-only checks for OS, Hyper-V, RAM, disk and existing Hyper-V objects.
    Does not create or modify anything.
#>
[CmdletBinding()]
param(
    [string]$Subnet = '10.10.10.0/24'
)

$report = @{ Ready = $true; Warnings = @(); Errors = @() }

function Add-Finding($kind, $message) {
    $report[$kind] += $message
    if ($kind -eq 'Errors') { $report.Ready = $false }
}

# 1. Windows edition
$os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction SilentlyContinue
if (-not $os) { Add-Finding Errors 'Cannot read operating system information.' }
elseif ($os.Caption -notmatch 'Windows (10|11|Server).*') { Add-Finding Errors "OS '$($os.Caption)' may not support this lab workflow." }

# 2. Hyper-V
$hyperv = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All -ErrorAction SilentlyContinue
if (-not $hyperv -or $hyperv.State -ne 'Enabled') { Add-Finding Errors 'Hyper-V is not enabled. Enable it and reboot.' }

# 3. Hyper-V PowerShell module
try {
    $null = Get-Command Get-VMSwitch -ErrorAction Stop
} catch {
    Add-Finding Errors 'Hyper-V PowerShell module is not available.'
}

# 4. RAM
$totalRamGB = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
if ($totalRamGB -lt 16) { Add-Finding Errors "Only ${totalRamGB} GB RAM detected. 16 GB or more is required." }

# 5. Free disk space on C:
$disk = Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DeviceID='C:'" -ErrorAction SilentlyContinue
if ($disk) {
    $freeGB = [math]::Round($disk.FreeSpace / 1GB, 1)
    if ($freeGB -lt 150) { Add-Finding Errors "Only ${freeGB} GB free on C:. 150 GB or more is required." }
}

# 6. Existing OMARI objects (informational)
$existingSwitch = Get-VMSwitch -Name 'OMARI-LAN' -ErrorAction SilentlyContinue
if ($existingSwitch) { Add-Finding Warnings 'A virtual switch named OMARI-LAN already exists.' }
$existingDC = Get-VM -Name 'OMARI-DC01' -ErrorAction SilentlyContinue
if ($existingDC) { Add-Finding Warnings 'A VM named OMARI-DC01 already exists.' }
$existingHD = Get-VM -Name 'OMARI-HD01' -ErrorAction SilentlyContinue
if ($existingHD) { Add-Finding Warnings 'A VM named OMARI-HD01 already exists.' }

[PSCustomObject]$report
