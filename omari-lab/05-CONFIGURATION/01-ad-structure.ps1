#Requires -Version 5.1
<#
.SYNOPSIS
    Create the OMARI Technologies AD structure, groups and service accounts.

.DESCRIPTION
    Run this from the domain controller after dcpromo and DNS are complete.
    Prompts for domain admin credentials.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$Domain = 'omari.test'
)

if (-not (Get-Module -ListAvailable ActiveDirectory)) {
    throw 'ActiveDirectory module not found. Run this on the OMARI-DC01 domain controller.'
}

Import-Module ActiveDirectory -ErrorAction Stop

$top = "OU=Corp,DC=omari,DC=test"

# Top-level OUs
foreach ($name in @('Users', 'Groups', 'ServiceAccounts', 'Workstations', 'Servers')) {
    $path = "OU=$name,$top"
    if (-not (Get-ADOrganizationalUnit -Filter "Name -eq '$name'" -SearchBase $top -ErrorAction SilentlyContinue)) {
        if ($PSCmdlet.ShouldProcess($path, 'Create OU')) {
            New-ADOrganizationalUnit -Name $name -Path $top -ProtectedFromAccidentalDeletion $true
        }
    }
}

# Department OUs
foreach ($dept in @('HR', 'Finance', 'IT', 'Engineering', 'Sales', 'Security')) {
    $path = "OU=$dept,OU=Users,$top"
    if (-not (Get-ADOrganizationalUnit -Filter "Name -eq '$dept'" -SearchBase "OU=Users,$top" -ErrorAction SilentlyContinue)) {
        if ($PSCmdlet.ShouldProcess($path, 'Create OU')) {
            New-ADOrganizationalUnit -Name $dept -Path "OU=Users,$top" -ProtectedFromAccidentalDeletion $true
        }
    }
}

# Role groups
$groups = @(
    @{ Name = 'grp-hr-readers'; Description = 'HR read access' },
    @{ Name = 'grp-hr-managers'; Description = 'HR managers with write' },
    @{ Name = 'grp-finance-payroll'; Description = 'Finance payroll' },
    @{ Name = 'grp-it-admins'; Description = 'IT administrators' },
    @{ Name = 'grp-helpdesk-tier1'; Description = 'Help desk tier 1' },
    @{ Name = 'grp-sec-ops'; Description = 'Security operations' },
    @{ Name = 'grp-domain-admins'; Description = 'Domain administrators' },
    @{ Name = 'grp-server-admins'; Description = 'Server administrators' }
)

foreach ($g in $groups) {
    if (-not (Get-ADGroup -Filter "Name -eq '$($g.Name)'" -SearchBase "OU=Groups,$top" -ErrorAction SilentlyContinue)) {
        if ($PSCmdlet.ShouldProcess($g.Name, 'Create group')) {
            New-ADGroup -Name $g.Name -GroupScope Global -Path "OU=Groups,$top" -Description $g.Description
        }
    }
}

Write-Output "OMARI AD structure and groups are in place."
