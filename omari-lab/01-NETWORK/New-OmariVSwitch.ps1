#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Create the private Hyper-V virtual switch for the OMARI lab.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$Name = 'OMARI-LAN',
    [string]$Subnet = '10.10.10.0/24'
)

$existing = Get-VMSwitch -Name $Name -ErrorAction SilentlyContinue
if ($existing) {
    Write-Output "Virtual switch '$Name' already exists."
    return
}

if ($PSCmdlet.ShouldProcess($Name, 'Create Hyper-V internal virtual switch')) {
    New-VMSwitch -Name $Name -SwitchType Internal -Notes "OMARI Technologies private lab network ($Subnet)" | Out-Null
    $adapter = Get-NetAdapter | Where-Object { $_.InterfaceDescription -like "*Hyper-V Virtual Ethernet*" -and $_.Name -eq "vEthernet ($Name)" }
    if ($adapter) {
        # The adapter exists; the user must configure the IP manually or with DHCP.
        Write-Output "Created switch '$Name'. Configure the vEthernet adapter with an IP in $Subnet if you want the host to talk to the VMs."
    } else {
        Write-Output "Created switch '$Name'. Review vEthernet ($Name) and assign an IP in $Subnet."
    }
}
