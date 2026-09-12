#Requires -Version 5.1

<#
.SYNOPSIS
    Generate a read-only IAM risk and governance report for the Year 4
    architect case.

.DESCRIPTION
    Collects evidence about dormant accounts, privileged groups, password
    policy and service accounts. Exports a CSV for the current-state
    architecture and a Markdown risk register.

.PARAMETER Domain
    The DNS name of the OMARI domain. Defaults to omari.test.

.PARAMETER OutputDir
    Where the report files are written. Defaults to C:\\OmariLab\\Y4.

.EXAMPLE
    .\Get-Y4RiskReport.ps1
    .\Get-Y4RiskReport.ps1 -Domain omari.test -OutputDir C:\\Reports
#>
[CmdletBinding()]
param (
    [string]$Domain = 'omari.test',
    [string]$OutputDir = 'C:\\OmariLab\\Y4'
)

$ErrorActionPreference = 'Stop'

try {
    Import-Module ActiveDirectory -ErrorAction Stop
} catch {
    Write-Error 'ActiveDirectory module is not available. Install RSAT or run this on OMARI-DC01.'
    return
}

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
$dn = (Get-ADDomain -Server $Domain).DistinguishedName

$policy = Get-ADDefaultDomainPasswordPolicy -Identity $Domain
$users = Get-ADUser -Filter * -Server $Domain -Properties LastLogonDate, PasswordLastSet, PasswordNeverExpires
$groups = Get-ADGroup -Filter * -Server $Domain | Where-Object { $_.Name -like 'role-*' -or $_.Name -like 'grp-*' }
$dormant = Search-ADAccount -AccountInactive -TimeSpan (New-TimeSpan -Days 90) -UsersOnly -Server $Domain
$stalePassword = $users | Where-Object { $_.PasswordLastSet -and ($_.PasswordLastSet -lt (Get-Date).AddDays(-90)) }
$neverExpires = $users | Where-Object { $_.PasswordNeverExpires -and $_.Enabled }
$serviceAccounts = $users | Where-Object { $_.SamAccountName -like 'svc-*' }

$summary = [PSCustomObject]@{
    TotalUsers = $users.Count
    Dormant90Days = $dormant.Count
    StalePasswords = $stalePassword.Count
    PasswordNeverExpires = $neverExpires.Count
    RoleGroups = ($groups | Where-Object { $_.Name -like 'role-*' }).Count
    ServiceAccounts = $serviceAccounts.Count
    MinPasswordLength = $policy.MinPasswordLength
    ComplexityEnabled = $policy.ComplexityEnabled
    MaxPasswordAgeDays = $policy.MaxPasswordAge.Days
    LockoutThreshold = $policy.LockoutThreshold
}

$csv = Join-Path $OutputDir 'current-state.csv'
$summary | Export-Csv -Path $csv -NoTypeInformation -Force

$md = Join-Path $OutputDir 'risk-register.md'
@"# OMARI IAM Risk Register

Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm')
Domain: $Domain

## Executive summary

| Metric | Value |
|--------|-------|
| Total accounts | $($summary.TotalUsers) |
| Dormant 90+ days | $($summary.Dormant90Days) |
| Passwords older than 90 days | $($summary.StalePasswords) |
| Passwords set to never expire | $($summary.PasswordNeverExpires) |
| Role groups | $($summary.RoleGroups) |
| Service accounts | $($summary.ServiceAccounts) |
| Minimum password length | $($summary.MinPasswordLength) |
| Complexity enabled | $($summary.ComplexityEnabled) |
| Max password age (days) | $($summary.MaxPasswordAgeDays) |
| Lockout threshold | $($summary.LockoutThreshold) |

## Recommendations

1. Review dormant accounts for deprovisioning.
2. Investigate service accounts and vaulted credentials.
3. Enforce MFA for privileged role members.
4. Document the break-glass procedure and test it quarterly.

## Next steps

Use the evidence in this report to write an architecture decision record and
an executive briefing in the IAM Range Writer.
"@ | Out-File -FilePath $md -Encoding utf8 -Force

Write-Host "Year 4 risk report written to $OutputDir" -ForegroundColor Green
