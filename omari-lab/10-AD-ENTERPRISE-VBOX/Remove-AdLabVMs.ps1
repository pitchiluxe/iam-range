<#
.SYNOPSIS
    Delete ADLab-DC01 and ADLab-CLIENT01 and their disks. Asks first.

.DESCRIPTION
    Only the two VMs named in adlab.vbox.json are touched — never any other
    VirtualBox VM on this machine.
#>
[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param([ValidateSet('DC01', 'CLIENT01')][string[]]$Only = @('DC01', 'CLIENT01'))

. (Join-Path $PSScriptRoot 'AdLab.Common.ps1')
$cfg = Get-AdLabConfig

foreach ($key in $Only) {
    $vm = $cfg.vms.$key.vmName
    if (-not (Test-AdLabVmExists $vm)) { Write-Host "$vm does not exist."; continue }
    if ($PSCmdlet.ShouldProcess($vm, 'Power off and delete the VM and its disks')) {
        if (Test-AdLabVmRunning $vm) { Invoke-VBox controlvm $vm poweroff | Out-Null; Start-Sleep 3 }
        Invoke-VBox unregistervm $vm --delete | Out-Null
        Write-Host "$vm deleted."
    }
}
