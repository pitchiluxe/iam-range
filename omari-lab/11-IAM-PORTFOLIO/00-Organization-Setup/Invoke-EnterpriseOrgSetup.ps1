<#
.SYNOPSIS
    Blueprint Part 1 / Directory 1: build the Active Directory organization on DC01.

.DESCRIPTION
    Run on DC01 (corp.local, from the Vagrantfile) as a Domain Admin. Idempotent
    and supports -WhatIf. Creates:

      Enterprise_Root/
        Tier0_Admins        domain admins and break-glass accounts
        Tier1_Systems       service accounts and application servers
        Tier2_Staff         general employee accounts
        Groups/Security_Groups, Groups/Distribution_Groups
        Disabled_Accounts   tombstone OU for leavers

    Global security groups (Groups/Security_Groups):
        GS-Finance-Accounting-RW, GS-Engineering-DevOps-Admin, GS-HR-Onboarding-RO

    Password policy 14 / 24 / 90 days / complexity on / reversible off, applied
    at the DOMAIN level, plus the GPO "Default_Enterprise_Password_Policy"
    linked to Enterprise_Root as the blueprint names it.

    WHY THE DOMAIN LEVEL: Windows applies password and lockout settings for
    domain accounts only from policy linked at the domain root (normally the
    Default Domain Policy). The same settings in a GPO linked to an OU only
    change LOCAL accounts on computers in that OU. For different rules per
    group, use a Fine-Grained Password Policy (New-ADFineGrainedPasswordPolicy).
    This is a classic interview and audit question; the GPO is still created and
    linked so the structure matches the blueprint, with that caveat written into
    its description.

.EXAMPLE
    .\Invoke-EnterpriseOrgSetup.ps1 -WhatIf
    .\Invoke-EnterpriseOrgSetup.ps1
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    # Keep "Protect from accidental deletion" on (blueprint default). Use
    # -Unprotected only while scripting against the tree, then re-run without it.
    [switch]$Unprotected
)

$ErrorActionPreference = 'Stop'
Import-Module ActiveDirectory
Import-Module GroupPolicy

$domain = Get-ADDomain
$dn = $domain.DistinguishedName
$root = "OU=Enterprise_Root,$dn"
$protect = -not $Unprotected

function Ensure-OU([string]$Name, [string]$Path) {
    $target = "OU=$Name,$Path"
    if (Get-ADOrganizationalUnit -LDAPFilter '(objectClass=organizationalUnit)' -SearchBase $Path -SearchScope OneLevel |
        Where-Object DistinguishedName -eq $target) {
        Write-Host "  exists  $target"
        return
    }
    if ($PSCmdlet.ShouldProcess($target, 'Create OU')) {
        New-ADOrganizationalUnit -Name $Name -Path $Path -ProtectedFromAccidentalDeletion $protect
        Write-Host "  created $target"
    }
}

function Ensure-Group([string]$Name, [string]$Path, [string]$Description) {
    if (Get-ADGroup -Filter "Name -eq '$Name'" -ErrorAction SilentlyContinue) { Write-Host "  exists  $Name"; return }
    if ($PSCmdlet.ShouldProcess($Name, 'Create global security group')) {
        New-ADGroup -Name $Name -SamAccountName $Name -GroupScope Global -GroupCategory Security -Path $Path -Description $Description
        Write-Host "  created $Name"
    }
}

Write-Host "Organizational units under $dn"
Ensure-OU 'Enterprise_Root' $dn
foreach ($ou in 'Tier0_Admins', 'Tier1_Systems', 'Tier2_Staff', 'Groups', 'Disabled_Accounts') { Ensure-OU $ou $root }
foreach ($ou in 'Security_Groups', 'Distribution_Groups') { Ensure-OU $ou "OU=Groups,$root" }

Write-Host 'Security groups'
$sg = "OU=Security_Groups,OU=Groups,$root"
Ensure-Group 'GS-Finance-Accounting-RW'    $sg 'Finance accounting read/write. Owner: Finance Director.'
Ensure-Group 'GS-Engineering-DevOps-Admin' $sg 'DevOps administrative access. Owner: Head of Engineering. Tier 1.'
Ensure-Group 'GS-HR-Onboarding-RO'         $sg 'HR onboarding read-only. Owner: HR Manager.'

Write-Host 'Domain password policy (applies to all domain accounts)'
if ($PSCmdlet.ShouldProcess($domain.DNSRoot, 'Set default domain password policy 14/24/90d/complex/no reversible')) {
    Set-ADDefaultDomainPasswordPolicy -Identity $domain.DNSRoot `
        -MinPasswordLength 14 -PasswordHistoryCount 24 -MaxPasswordAge (New-TimeSpan -Days 90) `
        -ComplexityEnabled $true -ReversibleEncryptionEnabled $false
    Get-ADDefaultDomainPasswordPolicy | Format-List MinPasswordLength, PasswordHistoryCount, MaxPasswordAge, ComplexityEnabled, ReversibleEncryptionEnabled
}

Write-Host 'GPO Default_Enterprise_Password_Policy'
$gpoName = 'Default_Enterprise_Password_Policy'
$gpo = Get-GPO -Name $gpoName -ErrorAction SilentlyContinue
if (-not $gpo -and $PSCmdlet.ShouldProcess($gpoName, 'Create GPO')) {
    $gpo = New-GPO -Name $gpoName -Comment ('Blueprint structure. NOTE: password settings in an OU-linked GPO affect only ' +
        'local accounts; domain account password policy is set at the domain level (see Invoke-EnterpriseOrgSetup.ps1).')
    Write-Host "  created $gpoName"
}
if ($gpo -and -not ((Get-GPInheritance -Target $root).GpoLinks | Where-Object DisplayName -eq $gpoName)) {
    if ($PSCmdlet.ShouldProcess($root, "Link $gpoName")) { New-GPLink -Name $gpoName -Target $root | Out-Null; Write-Host "  linked to $root" }
}

Write-Host "`nDone. Evidence to keep: the output above, plus:"
Write-Host '  Get-ADOrganizationalUnit -SearchBase "OU=Enterprise_Root,<domain DN>" -Filter * | Select DistinguishedName'
Write-Host '  Get-ADDefaultDomainPasswordPolicy'
