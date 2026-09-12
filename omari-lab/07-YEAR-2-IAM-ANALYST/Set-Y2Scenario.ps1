#Requires -RunAsAdministrator
#Requires -Version 5.1

<#
.SYNOPSIS
    Seed the OMARI domain with the Year 2 IAM Analyst scenario.

.DESCRIPTION
    Creates department OUs, role groups and staff users for the Year 2
    curriculum. Intentionally plants privilege-creep and access-request
    cases for the student to investigate and fix.

.PARAMETER Domain
    The DNS name of the OMARI domain. Defaults to omari.test.

.PARAMETER WhatIf
    Shows what would be changed without making any modifications.

.EXAMPLE
    .\Set-Y2Scenario.ps1 -WhatIf
    .\Set-Y2Scenario.ps1 -Domain omari.test
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param (
    [string]$Domain = 'omari.test'
)

$ErrorActionPreference = 'Stop'

try {
    Import-Module ActiveDirectory -ErrorAction Stop
} catch {
    Write-Error 'ActiveDirectory module is not available. Install RSAT or run this on OMARI-DC01.'
    return
}

$dn = (Get-ADDomain -Server $Domain).DistinguishedName
$corpOu = Get-ADOrganizationalUnit -Filter "Name -eq 'Corp'" -SearchBase $dn -SearchScope OneLevel -Server $Domain -ErrorAction SilentlyContinue
if (-not $corpOu) {
    if ($PSCmdlet.ShouldProcess("OU=Corp,$dn", 'New-ADOrganizationalUnit')) {
        $corpOu = New-ADOrganizationalUnit -Name 'Corp' -Path $dn -Server $Domain -PassThru
    } else {
        $corpOu = [PSCustomObject]@{ DistinguishedName = "OU=Corp,$dn" }
    }
}

$departments = @('HR', 'IT', 'Finance', 'Engineering', 'HelpDesk')
foreach ($dept in $departments) {
    $ou = Get-ADOrganizationalUnit -Filter "Name -eq '$dept'" -SearchBase $corpOu.DistinguishedName -SearchScope OneLevel -Server $Domain -ErrorAction SilentlyContinue
    if (-not $ou) {
        if ($PSCmdlet.ShouldProcess("OU=$dept,$($corpOu.DistinguishedName)", 'New-ADOrganizationalUnit')) {
            New-ADOrganizationalUnit -Name $dept -Path $corpOu.DistinguishedName -Server $Domain | Out-Null
        }
    }
}

$roleGroups = @(
    @{ Name = 'grp-hr-readers'; Path = "OU=HR,$($corpOu.DistinguishedName)" },
    @{ Name = 'grp-hr-managers'; Path = "OU=HR,$($corpOu.DistinguishedName)" },
    @{ Name = 'grp-it-admins'; Path = "OU=IT,$($corpOu.DistinguishedName)" },
    @{ Name = 'grp-engineering-dev'; Path = "OU=Engineering,$($corpOu.DistinguishedName)" },
    @{ Name = 'grp-finance-analysts'; Path = "OU=Finance,$($corpOu.DistinguishedName)" },
    @{ Name = 'grp-helpdesk-tier1'; Path = "OU=HelpDesk,$($corpOu.DistinguishedName)" }
)

foreach ($g in $roleGroups) {
    $existing = Get-ADGroup -Filter "Name -eq '$($g.Name)'" -SearchBase $dn -Server $Domain -ErrorAction SilentlyContinue
    if (-not $existing) {
        if ($PSCmdlet.ShouldProcess($g.Name, 'New-ADGroup')) {
            New-ADGroup -Name $g.Name -GroupScope Global -Path $g.Path -Server $Domain | Out-Null
        }
    }
}

$users = @(
    @{ Sam = 'cara.reid'; Name = 'Cara Reid'; Dept = 'HR'; Groups = @('grp-hr-readers', 'grp-engineering-dev') },
    @{ Sam = 'ben.okafor'; Name = 'Ben Okafor'; Dept = 'IT'; Groups = @('grp-it-admins', 'grp-hr-managers') },
    @{ Sam = 'greta.olsen'; Name = 'Greta Olsen'; Dept = 'HR'; Groups = @() },
    @{ Sam = 'may.ali'; Name = 'May Ali'; Dept = 'Finance'; Groups = @('grp-finance-analysts') },
    @{ Sam = 'david.nguyen'; Name = 'David Nguyen'; Dept = 'Engineering'; Groups = @('grp-engineering-dev') },
    @{ Sam = 'susan.kim'; Name = 'Susan Kim'; Dept = 'HelpDesk'; Groups = @('grp-helpdesk-tier1') },
    @{ Sam = 'contractor.lee'; Name = 'Contractor Lee'; Dept = 'IT'; Groups = @('grp-it-admins') }
)

$tempPassword = ConvertTo-SecureString -String 'TempPass!2026#' -AsPlainText -Force

foreach ($u in $users) {
    $path = "OU=$($u.Dept),$($corpOu.DistinguishedName)"
    $existing = Get-ADUser -Filter "SamAccountName -eq '$($u.Sam)'" -Server $Domain -ErrorAction SilentlyContinue
    if (-not $existing) {
        if ($PSCmdlet.ShouldProcess($u.Sam, 'New-ADUser')) {
            New-ADUser `
                -SamAccountName $u.Sam `
                -Name $u.Name `
                -DisplayName $u.Name `
                -UserPrincipalName "$($u.Sam)@$Domain" `
                -Department $u.Dept `
                -Path $path `
                -AccountPassword $tempPassword `
                -Enabled $true `
                -ChangePasswordAtLogon $true `
                -Server $Domain | Out-Null
        }
    }

    foreach ($groupName in $u.Groups) {
        $group = Get-ADGroup -Filter "Name -eq '$groupName'" -Server $Domain -ErrorAction SilentlyContinue
        if ($group -and $PSCmdlet.ShouldProcess("$($u.Sam) -> $groupName", 'Add-ADGroupMember')) {
            Add-ADGroupMember -Identity $group -Members $u.Sam -Server $Domain -ErrorAction SilentlyContinue
        }
    }
}

# Apply the OMARI password and lockout policy to the domain.
$policyTarget = "Default Domain Policy for $Domain"
if ($PSCmdlet.ShouldProcess($policyTarget, 'Set-ADDefaultDomainPasswordPolicy')) {
    Set-ADDefaultDomainPasswordPolicy `
        -Identity $Domain `
        -MinPasswordLength 14 `
        -ComplexityEnabled $true `
        -MaxPasswordAge (New-TimeSpan -Days 90) `
        -LockoutThreshold 5 `
        -LockoutDuration (New-TimeSpan -Minutes 30) `
        -LockoutObservationWindow (New-TimeSpan -Minutes 30) `
        -Server $Domain
}

Write-Host "Year 2 IAM Analyst scenario prepared. Review the group memberships for privilege-creep cases." -ForegroundColor Green
