#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Save checkpoints for the OMARI lab virtual machines.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string[]]$VMs = @('OMARI-DC01', 'OMARI-HD01', 'OMARI-FS01'),
    [string]$SnapshotName = "OMARI-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
)

foreach ($name in $VMs) {
    $vm = Get-VM -Name $name -ErrorAction SilentlyContinue
    if (-not $vm) {
        Write-Warning "VM '$name' not found."
        continue
    }
    if ($PSCmdlet.ShouldProcess("$name : $SnapshotName", 'Checkpoint-VM')) {
        Checkpoint-VM -Name $name -SnapshotName $SnapshotName -ErrorAction Stop
        Write-Output "Saved checkpoint '$SnapshotName' on $name."
    }
}
