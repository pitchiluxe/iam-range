<#
    Runs INSIDE DC01 (corp.technobiz.local), sent by ..\Set-PortfolioScenario.ps1,
    which prepends:   $Project = 'p01'   (p01 p02 p03 p04 p08 p10)

    Each scenario (re)creates exactly the starting point its project describes —
    running it again restarts that project. It never deletes files the learner
    wrote in C:\IAM; the checker only counts output written AFTER the scenario's
    seededAt time (C:\IAM\scenarios\<project>.json).

    No password is stored anywhere: seeded accounts get random ones generated
    here with a CSPRNG and never written out.
#>
$ErrorActionPreference = 'Stop'
Import-Module ActiveDirectory

$Domain = Get-ADDomain
$DN = $Domain.DistinguishedName
$NB = $Domain.NetBIOSName
$Root = "OU=Enterprise_Root,$DN"
$Staff = "OU=Tier2_Staff,$Root"
$SecGroups = "OU=Security_Groups,OU=Groups,$Root"

function New-RandomPassword([int]$Length = 24) {
    $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!#%*-_+='
    $bytes = New-Object byte[] $Length
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    (-join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })) + 'aA7!'
}

function Ensure-OU([string]$Name, [string]$Path) {
    if (-not (Get-ADOrganizationalUnit -Filter "Name -eq '$Name'" -SearchBase $Path -SearchScope OneLevel -ErrorAction SilentlyContinue)) {
        New-ADOrganizationalUnit -Name $Name -Path $Path -ProtectedFromAccidentalDeletion $false
    }
}

function Ensure-Group([string]$Name, [string]$Description = '') {
    $g = Get-ADGroup -Filter "Name -eq '$Name'" -ErrorAction SilentlyContinue
    if (-not $g) { New-ADGroup -Name $Name -SamAccountName $Name -GroupScope Global -GroupCategory Security -Path $SecGroups -Description $Description }
}

function Remove-GroupIfExists([string]$Name) {
    Get-ADGroup -Filter "Name -eq '$Name'" -ErrorAction SilentlyContinue | ForEach-Object {
        Set-ADObject $_ -ProtectedFromAccidentalDeletion $false
        Remove-ADGroup $_ -Confirm:$false
    }
}

function Remove-UserIfExists([string]$Sam) {
    Get-ADUser -Filter "SamAccountName -eq '$Sam'" -ErrorAction SilentlyContinue | Remove-ADUser -Confirm:$false
}

function Reset-LabUser {
    param([string]$Sam, [string]$Given, [string]$Surname, [string]$Path, [string]$Department = '', [string[]]$Groups = @(), [string]$Description = '', [string]$Password)
    Remove-UserIfExists $Sam
    if (-not $Password) { $Password = New-RandomPassword }
    $p = @{
        Name = "$Given $Surname"; GivenName = $Given; Surname = $Surname; SamAccountName = $Sam
        UserPrincipalName = "$Sam@$($Domain.DNSRoot)"; Path = $Path; Enabled = $true
        AccountPassword = (ConvertTo-SecureString $Password -AsPlainText -Force)
    }
    if ($Department) { $p.Department = $Department }
    if ($Description) { $p.Description = $Description }
    New-ADUser @p
    foreach ($g in $Groups) { Add-ADGroupMember -Identity $g -Members $Sam }
}

function Reset-Folder([string]$Path) {
    if (Test-Path $Path) { Remove-Item $Path -Recurse -Force }
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
}

function Ensure-Dir([string]$Path) { New-Item -ItemType Directory -Path $Path -Force | Out-Null }

function Write-Scenario([string]$Id, [hashtable]$Extra = @{}) {
    Ensure-Dir 'C:\IAM\scenarios'
    $o = [ordered]@{ project = $Id; seededAt = (Get-Date).ToUniversalTime().ToString('o') }
    foreach ($k in $Extra.Keys) { $o[$k] = $Extra[$k] }
    $o | ConvertTo-Json | Set-Content "C:\IAM\scenarios\$Id.json" -Encoding UTF8
}

# net.exe writes failures to stderr. Under $ErrorActionPreference = 'Stop', Windows
# PowerShell 5.1 turns that into a terminating error, and some sign-ins here are
# meant to fail (the SIEM brute-force events), so run it with 'Continue'.
function Invoke-Net {
    $ErrorActionPreference = 'Continue'
    & net.exe @args 2>&1 | Out-Null
}

function Invoke-NetworkLogon([string]$Sam, [string]$Password) {
    if (-not ('Lab.Auth' -as [type])) {
        Add-Type -Namespace Lab -Name Auth -MemberDefinition @"
[DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
public static extern bool LogonUser(string user, string domain, string password, int logonType, int provider, out IntPtr token);
[DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
"@
    }
    $token = [IntPtr]::Zero
    $ok = [Lab.Auth]::LogonUser($Sam, $NB, $Password, 3, 0, [ref]$token)   # 3 = LOGON32_LOGON_NETWORK
    if ($ok) { [Lab.Auth]::CloseHandle($token) | Out-Null }
    $ok
}

function Ensure-Departments {
    Ensure-OU 'Tier2_Staff' $Root
    foreach ($d in 'Engineering', 'Sales', 'Finance', 'HR') { Ensure-OU $d $Staff; Ensure-Group "GG-$d" "$d department members" }
}

switch ($Project) {
    'p01' {
        Ensure-Departments
        Ensure-OU 'Terminated Users' $Root
        Remove-UserIfExists 'pnair'
        Reset-LabUser -Sam mchen -Given Michael -Surname Chen -Path "OU=Sales,$Staff" -Department Sales -Groups GG-Sales
        Reset-LabUser -Sam tbrooks -Given Taylor -Surname Brooks -Path "OU=HR,$Staff" -Department HR -Groups GG-HR, GS-HR-Onboarding-RO
        Ensure-Dir 'C:\IAM\HR'; Ensure-Dir 'C:\IAM\JML'
        @'
EmployeeId,FirstName,LastName,Username,Department,Title,Status,Manager
1001,Priya,Nair,pnair,Engineering,Software Engineer,Active,
1002,Michael,Chen,mchen,Finance,Financial Analyst,Active,
1003,Taylor,Brooks,tbrooks,HR,HR Specialist,Terminated,
'@ | Set-Content 'C:\IAM\HR\hr_feed.csv' -Encoding UTF8
        Write-Scenario 'p01'
        'JML scenario ready: C:\IAM\HR\hr_feed.csv has a joiner (pnair), a mover (mchen) and a leaver (tbrooks).'
    }
    'p02' {
        Ensure-Departments
        foreach ($g in Get-ADGroup -Filter "Name -like 'Role-*' -or Name -like 'Res-*' -or Name -eq 'App-FinanceLedger-Users'") { Remove-GroupIfExists $g.Name }
        Reset-LabUser -Sam flead -Given Farah -Surname Lead -Path "OU=Finance,$Staff" -Department Finance
        Reset-LabUser -Sam fanalyst -Given Felix -Surname Analyst -Path "OU=Finance,$Staff" -Department Finance
        Reset-LabUser -Sam edev -Given Elena -Surname Dev -Path "OU=Engineering,$Staff" -Department Engineering
        Reset-LabUser -Sam hspec -Given Hana -Surname Spec -Path "OU=HR,$Staff" -Department HR
        foreach ($f in 'Finance', 'Engineering', 'HR') { Reset-Folder "C:\Shares\$f" }
        Ensure-Dir 'C:\IAM\RBAC'
        Write-Scenario 'p02'
        'RBAC scenario ready: users flead, fanalyst, edev, hspec; folders C:\Shares\Finance, Engineering, HR (no grants yet).'
    }
    'p03' {
        Ensure-Departments
        Reset-LabUser -Sam mgr.engineering -Given Morgan -Surname Engineering -Path "OU=Engineering,$Staff" -Department Engineering -Description 'Engineering manager (access reviewer)'
        Reset-LabUser -Sam aeng -Given Aiden -Surname Eng -Path "OU=Engineering,$Staff" -Department Engineering
        Reset-LabUser -Sam bdev -Given Bianca -Surname Dev -Path "OU=Engineering,$Staff" -Department Engineering
        Reset-LabUser -Sam rlopez -Given Rosa -Surname Lopez -Path "OU=Sales,$Staff" -Department Sales -Groups GG-Sales
        Remove-GroupIfExists 'GG-Engineering-Restricted'
        Ensure-Group 'GG-Engineering-Restricted' 'HIGH RISK: restricted Engineering source and designs'
        Set-ADGroup 'GG-Engineering-Restricted' -ManagedBy 'mgr.engineering'
        Add-ADGroupMember 'GG-Engineering-Restricted' -Members aeng, bdev
        Reset-Folder 'C:\Shares\Engineering'
        icacls 'C:\Shares\Engineering' /grant "$NB\GG-Engineering-Restricted:(OI)(CI)M" | Out-Null
        # The injected flaw: a Sales user with restricted Engineering access, twice over.
        Add-ADGroupMember 'GG-Engineering-Restricted' -Members rlopez
        icacls 'C:\Shares\Engineering' /grant "$NB\rlopez:(OI)(CI)M" | Out-Null
        Ensure-Dir 'C:\IAM\UAR\requests'
        Write-Scenario 'p03'
        'Access review scenario ready: flaw injected (rlopez, Sales, in GG-Engineering-Restricted and on C:\Shares\Engineering). Reviewer: mgr.engineering.'
    }
    'p04' {
        Ensure-Departments
        Ensure-OU 'Tier0_Admins' $Root; Ensure-OU 'Tier1_Systems' $Root
        Reset-LabUser -Sam old.contractor1 -Given Old -Surname Contractor1 -Path "OU=Sales,$Staff" -Department Sales -Groups GG-Sales
        Reset-LabUser -Sam old.contractor2 -Given Old -Surname Contractor2 -Path "OU=Finance,$Staff" -Department Finance -Groups GG-Finance, GS-Finance-Accounting-RW
        Reset-LabUser -Sam legacy.intern -Given Legacy -Surname Intern -Path "OU=HR,$Staff" -Department HR -Groups GG-HR
        Reset-LabUser -Sam svc-backup -Given Svc -Surname Backup -Path "OU=Tier1_Systems,$Root" -Description 'Service account - backup agent (exclude from stale remediation)'
        Reset-LabUser -Sam bg-admin01 -Given BreakGlass -Surname Admin01 -Path "OU=Tier0_Admins,$Root" -Description 'Break-glass emergency account (exclude; monitor instead)'
        $activePw = New-RandomPassword
        Reset-LabUser -Sam active.user -Given Active -Surname User -Path "OU=Engineering,$Staff" -Department Engineering -Groups GG-Engineering -Password $activePw
        # A real network sign-in, so active.user has a lastLogonTimestamp.
        Invoke-Net use "\\$env:COMPUTERNAME\NETLOGON" /user:"$NB\active.user" $activePw
        Invoke-Net use "\\$env:COMPUTERNAME\NETLOGON" /delete /y
        Ensure-Dir 'C:\IAM\Stale'; Ensure-Dir 'C:\IAM\Queue'
        Write-Scenario 'p04'
        'Stale-account scenario ready: dormant old.contractor1, old.contractor2, legacy.intern; active active.user; exclusions svc-backup, bg-admin01.'
    }
    'p08' {
        Ensure-Departments
        $feature = Get-ADOptionalFeature -Filter "Name -eq 'Privileged Access Management Feature'"
        if (-not $feature.EnabledScopes) {
            Enable-ADOptionalFeature 'Privileged Access Management Feature' -Scope ForestOrConfigurationSet -Target $Domain.Forest -Confirm:$false
        }
        Ensure-Group 'GG-SecurityLeads' 'Security leads who approve privileged elevation'
        Reset-LabUser -Sam dkim -Given Daniel -Surname Kim -Path "OU=Engineering,$Staff" -Department Engineering -Groups GG-Engineering
        Reset-LabUser -Sam sec.lead -Given Sasha -Surname Lead -Path "OU=Tier0_Admins,$Root" -Department Security -Groups GG-SecurityLeads
        Ensure-Dir 'C:\IAM\PAM'
        Write-Scenario 'p08'
        'JIT scenario ready: PAM feature enabled; dkim (engineer, no admin rights), sec.lead (approver, GG-SecurityLeads).'
    }
    'p10' {
        Reset-LabUser -Sam siem.temp -Given Siem -Surname Temp -Path "CN=Users,$DN"
        $victimPw = New-RandomPassword
        Reset-LabUser -Sam siem.victim -Given Siem -Surname Victim -Path "CN=Users,$DN" -Password $victimPw
        auditpol /set /subcategory:"Logon" /success:enable /failure:enable | Out-Null
        auditpol /set /subcategory:"Security Group Management" /success:enable | Out-Null
        Ensure-Dir 'C:\IAM\SIEM\queries'
        Write-Scenario 'p10'
        Start-Sleep -Seconds 2
        wevtutil cl Security                                      # -> 1102 audit log cleared
        # Network sign-ins (logon type 3) through LogonUser. A failed "net use" to the
        # DC itself only logs 4776, not the 4625 a SIEM correlates on.
        foreach ($i in 1..4) { Invoke-NetworkLogon 'siem.victim' "Wrong-Password-$i!" | Out-Null }   # -> 4625 x4 (below lockout)
        Invoke-NetworkLogon 'siem.victim' $victimPw | Out-Null                                        # -> 4624
        Add-ADGroupMember 'Domain Admins' -Members siem.temp       # -> 4728
        Remove-ADGroupMember 'Domain Admins' -Members siem.temp -Confirm:$false   # -> 4729
        'SIEM scenario ready: Security log cleared (1102), 4 failed logons then a success for siem.victim, siem.temp added to and removed from Domain Admins.'
    }
    default { throw "Unknown portfolio project '$Project' (VM track: p01 p02 p03 p04 p08 p10)." }
}
