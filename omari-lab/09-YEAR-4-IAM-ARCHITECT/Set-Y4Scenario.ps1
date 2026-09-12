#Requires -RunAsAdministrator
#Requires -Version 5.1

<#
.SYNOPSIS
    Ensure the Year 4 resilience case has a break-glass account to review.

.DESCRIPTION
    Creates the break-glass account if it is missing. This is the only
    write operation in the Year 4 package; the rest is read-only evidence
    collection.

.PARAMETER Domain
    The DNS name of the OMARI domain. Defaults to omari.test.

.EXAMPLE
    .\Set-Y4Scenario.ps1 -WhatIf
    .\Set-Y4Scenario.ps1 -Domain omari.test
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

$bg = Get-ADUser -Filter "SamAccountName -eq 'bg-admin'" -Server $Domain -ErrorAction SilentlyContinue
if (-not $bg -and $PSCmdlet.ShouldProcess('bg-admin', 'New-ADUser')) {
    $tempPassword = ConvertTo-SecureString -String 'TempPass!2026#' -AsPlainText -Force
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
    Write-Host 'Break-glass account bg-admin created. Remember to document the offline recovery procedure.' -ForegroundColor Green
} else {
    Write-Host 'Break-glass account already exists or not in scope.' -ForegroundColor Yellow
}
