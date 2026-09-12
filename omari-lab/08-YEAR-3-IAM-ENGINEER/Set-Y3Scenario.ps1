#Requires -RunAsAdministrator
#Requires -Version 5.1

<#
.SYNOPSIS
    Seed the OMARI domain with the Year 3 IAM Engineer scenario.

.DESCRIPTION
    Creates privileged role groups, a stale service account and a disabled
    break-glass account. Exports a membership CSV for the IGA/access-review
    case and an incident CSV for the PAM/incident case.

.PARAMETER Domain
    The DNS name of the OMARI domain. Defaults to omari.test.

.EXAMPLE
    .\Set-Y3Scenario.ps1 -WhatIf
    .\Set-Y3Scenario.ps1 -Domain omari.test
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
$itPath = "OU=IT,OU=Corp,$dn"
$servicePath = "OU=ServiceAccounts,OU=Corp,$dn"

# Ensure the IT and ServiceAccounts OUs exist.
$ous = @('IT', 'ServiceAccounts')
foreach ($name in $ous) {
    $ou = Get-ADOrganizationalUnit -Filter "Name -eq '$name'" -SearchBase "OU=Corp,$dn" -SearchScope OneLevel -Server $Domain -ErrorAction SilentlyContinue
    if (-not $ou -and $PSCmdlet.ShouldProcess("OU=$name,OU=Corp,$dn", 'New-ADOrganizationalUnit')) {
        New-ADOrganizationalUnit -Name $name -Path "OU=Corp,$dn" -Server $Domain | Out-Null
    }
}

$privGroups = @(
    @{ Name = 'role-iam-admins'; Path = $itPath },
    @{ Name = 'role-domain-admins'; Path = $itPath },
    @{ Name = 'role-server-admins'; Path = $itPath }
)

foreach ($g in $privGroups) {
    $existing = Get-ADGroup -Filter "Name -eq '$($g.Name)'" -SearchBase $dn -Server $Domain -ErrorAction SilentlyContinue
    if (-not $existing -and $PSCmdlet.ShouldProcess($g.Name, 'New-ADGroup')) {
        New-ADGroup -Name $g.Name -GroupScope Global -Path $g.Path -Server $Domain -Description 'Privileged role group for PIM simulation' | Out-Null
    }
}

$tempPassword = ConvertTo-SecureString -String 'TempPass!2026#' -AsPlainText -Force

# Stale service account.
$stale = Get-ADUser -Filter "SamAccountName -eq 'svc-stale'" -Server $Domain -ErrorAction SilentlyContinue
if (-not $stale -and $PSCmdlet.ShouldProcess('svc-stale', 'New-ADUser')) {
    New-ADUser `
        -SamAccountName 'svc-stale' `
        -Name 'svc-stale' `
        -DisplayName 'Stale service account' `
        -UserPrincipalName "svc-stale@$Domain" `
        -Path $servicePath `
        -AccountPassword $tempPassword `
        -PasswordNeverExpires $true `
        -Enabled $true `
        -Description 'Stale: last review 2024-01-15' `
        -Server $Domain | Out-Null
}

# Disabled break-glass account for the incident response case.
$bg = Get-ADUser -Filter "SamAccountName -eq 'bg-admin'" -Server $Domain -ErrorAction SilentlyContinue
if (-not $bg -and $PSCmdlet.ShouldProcess('bg-admin', 'New-ADUser')) {
    New-ADUser `
        -SamAccountName 'bg-admin' `
        -Name 'Break-glass Admin' `
        -DisplayName 'Break-glass Admin' `
        -UserPrincipalName "bg-admin@$Domain" `
        -Path $itPath `
        -AccountPassword $tempPassword `
        -Enabled $false `
        -Description 'Emergency access account' `
        -Server $Domain | Out-Null
}

# Export a membership CSV for the IGA case.
$outDir = 'C:\\OmariLab\\Y3'
$outFile = Join-Path $outDir 'membership-audit.csv'
if ($PSCmdlet.ShouldProcess($outFile, 'Export membership audit CSV')) {
    New-Item -ItemType Directory -Path $outDir -Force | Out-Null
    Get-ADGroup -Filter * -SearchBase $dn -Server $Domain |
        ForEach-Object {
            $group = $_
            Get-ADGroupMember -Identity $group -Recursive -ErrorAction SilentlyContinue |
                Select-Object @{N = 'Group'; E = { $group.Name } }, SamAccountName, Name, objectClass
        } |
        Export-Csv -Path $outFile -NoTypeInformation -Force
}

# Export an incident CSV with stale and high-risk objects for the incident case.
$incidentFile = Join-Path $outDir 'incident-objects.csv'
if ($PSCmdlet.ShouldProcess($incidentFile, 'Export incident objects CSV')) {
    Search-ADAccount -AccountInactive -TimeSpan (New-TimeSpan -Days 90) -UsersOnly -Server $Domain |
        Select-Object SamAccountName, Name, DistinguishedName, LastLogonDate |
        Export-Csv -Path $incidentFile -NoTypeInformation -Force
}

Write-Host "Year 3 IAM Engineer scenario prepared. Review C:\\OmariLab\\Y3 for the IGA and incident CSVs." -ForegroundColor Green
