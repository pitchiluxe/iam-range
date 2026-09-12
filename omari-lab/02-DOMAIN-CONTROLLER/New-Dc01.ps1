#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Build the OMARI-DC01 virtual machine.

.DESCRIPTION
    This is a skeleton that creates the VM and attaches a blank VHD.
    You must provide the Windows Server ISO and run the OS install manually,
    or use an automated deployment tool.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$VMName = 'OMARI-DC01',
    [string]$SwitchName = 'OMARI-LAN',
    [string]$VhdPath = "C:\\OMARI-Lab\\$VMName.vhdx",
    [string]$IsoPath,
    [int]$RamMB = 4096,
    [int]$DiskGB = 80,
    [string]$IPAddress = '10.10.10.10'
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
        Write-Warning 'No ISO path supplied. Attach a Windows Server ISO and boot the VM manually.'
    }
    Write-Output "Created $VMName. Start it with: Start-VM -Name '$VMName'"
}
