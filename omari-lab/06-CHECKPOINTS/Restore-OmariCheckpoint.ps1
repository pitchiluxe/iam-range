#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Restore the most recent checkpoint for the OMARI lab VMs.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string[]]$VMs = @('OMARI-DC01', 'OMARI-HD01', 'OMARI-FS01')
)

foreach ($name in $VMs) {
    $vm = Get-VM -Name $name -ErrorAction SilentlyContinue
    if (-not $vm) {
        Write-Warning "VM '$name' not found."
        continue
    }
    $checkpoints = Get-VMSnapshot -VMName $name | Sort-Object CreationTime -Descending
    if (-not $checkpoints) {
        Write-Warning "No checkpoints found for '$name'."
        continue
    }
    $latest = $checkpoints[0]
    if ($PSCmdlet.ShouldProcess("$name : $($latest.Name)", 'Restore-VMSnapshot')) {
        Restore-VMSnapshot -VMName $name -Name $latest.Name -Confirm:$false
        Write-Output "Restored checkpoint '$($latest.Name)' on $name."
    }
}
