#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Build the OMARI-HD01 help-desk client VM.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$VMName = 'OMARI-HD01',
    [string]$SwitchName = 'OMARI-LAN',
    [string]$VhdPath = "C:\\OMARI-Lab\\$VMName.vhdx",
    [string]$IsoPath,
    [int]$RamMB = 4096,
    [int]$DiskGB = 60,
    [string]$IPAddress = '10.10.10.20'
)

if (-not (Get-VMSwitch -Name $SwitchName -ErrorAction SilentlyContinue)) {
    throw "Virtual switch '$SwitchName' not found. Run 01-NETWORK/New-OmariVSwitch.ps1 first."
}

$vm = Get-VM -Name $VMName -ErrorAction SilentlyContinue
if ($vm) {
    Write-Output "VM '$VMName' already exists."
    return
}

if ($PSCmdlet.ShouldProcess($VMName, 'Create Hyper-V VM')) {
    $parentDir = Split-Path -Path $VhdPath -Parent
    if (-not (Test-Path $parentDir)) { New-Item -ItemType Directory -Force -Path $parentDir | Out-Null }
    New-VHD -Path $VhdPath -SizeBytes ($DiskGB * 1GB) -Dynamic | Out-Null
    $vm = New-VM -Name $VMName -Generation 2 -MemoryStartupBytes ($RamMB * 1MB) -SwitchName $SwitchName -VHDPath $VhdPath
    Set-VM -Name $VMName -ProcessorCount 2 -CheckpointFileLocation $parentDir
    if ($IsoPath -and (Test-Path $IsoPath)) {
        Add-VMDvdDrive -VMName $VMName -Path $IsoPath
        $dvd = Get-VMDvdDrive -VMName $VMName
        Set-VMFirmware -VMName $VMName -FirstBootDevice $dvd
    } else {
        Write-Warning 'No ISO path supplied. Attach a Windows 11 ISO and boot the VM manually.'
    }
    Write-Output "Created $VMName. After installing Windows, join it to the OMARI domain at $IPAddress."
}
