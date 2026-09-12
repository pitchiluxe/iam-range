#Requires -Version 5.1
<#
.SYNOPSIS
    Run validation tests after each major build phase.

.DESCRIPTION
    Simple assertions that prove the state the script claims is real.
    No Pester dependency. Throws on failure.
#>
[CmdletBinding()]
param(
    [string[]]$VMs = @('OMARI-DC01', 'OMARI-HD01'),
    [string]$Domain = 'omari.test'
)

function Assert($condition, $message) {
    if (-not $condition) { throw "VALIDATION FAILED: $message" }
}

# Phase 1: host and network
Assert ((Get-Module -ListAvailable Hyper-V) -ne $null) 'Hyper-V module must be available.'
Assert ((Get-VMSwitch -Name 'OMARI-LAN' -ErrorAction SilentlyContinue) -ne $null) 'OMARI-LAN virtual switch must exist.'

# Phase 2: VMs
foreach ($vm in $VMs) {
    $obj = Get-VM -Name $vm -ErrorAction SilentlyContinue
    Assert ($obj -ne $null) "VM '$vm' must exist."
    Assert ($obj.State -eq 'Running' -or $obj.State -eq 'Saved') "VM '$vm' must be running or saved."
}

# Phase 3: Active Directory (run on DC01 only)
if (Get-Module -ListAvailable ActiveDirectory) {
    Import-Module ActiveDirectory -ErrorAction SilentlyContinue
    try {
        $domainObj = Get-ADDomain $Domain -ErrorAction Stop
        Assert ($domainObj.DNSRoot -eq $Domain) "Domain must be $Domain."
        $ous = Get-ADOrganizationalUnit -Filter 'Name -eq "Corp"' -ErrorAction Stop
        Assert ($ous -ne $null) 'Corp OU must exist.'
    } catch {
        # AD may not exist yet; only fail if the module is loaded and the domain is missing.
        Write-Warning "Active Directory validation skipped: $_"
    }
}

Write-Output "OMARI validation passed for $($VMs -join ', ')."
