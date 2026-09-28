<#
    Runs INSIDE DC01, sent by ..\Get-PortfolioFacts.ps1. READ-ONLY: every call
    is a Get-*, Get-Acl, Get-WinEvent or a file read. Prints one JSON line.

    Everything is converted to plain strings/numbers before ConvertTo-Json:
    Windows PowerShell 5.1 attaches provider notes to strings from Get-Content
    and would otherwise try to serialise the provider tree.
#>
$ErrorActionPreference = 'SilentlyContinue'
Import-Module ActiveDirectory

$f = [ordered]@{ collectedAt = (Get-Date).ToUniversalTime().ToString('o') }
$Domain = Get-ADDomain
$DN = $Domain.DistinguishedName
$f.domain = [string]$Domain.DNSRoot
$f.netbios = [string]$Domain.NetBIOSName

$cn = { param($dn) if ([string]$dn -match '^CN=((?:\\,|[^,])+)') { $Matches[1] -replace '\\,', ',' } else { [string]$dn } }
$parent = { param($dn) [string]$dn -replace '^(CN|OU)=(?:\\,|[^,])+,', '' }
$iso = { param($ft) if ($ft -and [long]$ft -gt 0) { [DateTime]::FromFileTimeUtc([long]$ft).ToString('o') } else { $null } }

# Scenarios the kit has set up
$f.scenarios = [ordered]@{}
foreach ($s in Get-ChildItem 'C:\IAM\scenarios\*.json') {
    $o = Get-Content -Raw $s.FullName | ConvertFrom-Json
    $f.scenarios[[string]$o.project] = [string]$o.seededAt
}

$pam = Get-ADOptionalFeature -Filter "Name -eq 'Privileged Access Management Feature'"
$f.pamEnabled = [bool]($pam.EnabledScopes)

$skip = @('Administrator', 'Guest', 'krbtgt', 'DefaultAccount')
$f.users = @(Get-ADUser -Filter * -Properties Department, EmployeeID, pwdLastSet, lastLogonTimestamp, Description, MemberOf, whenCreated |
    Where-Object { $skip -notcontains $_.SamAccountName } | ForEach-Object {
        [ordered]@{
            sam = [string]$_.SamAccountName; name = [string]$_.Name; enabled = [bool]$_.Enabled
            parent = (& $parent $_.DistinguishedName); department = [string]$_.Department; employeeId = [string]$_.EmployeeID
            pwdLastSet = (& $iso $_.pwdLastSet); mustChangePassword = ([long]$_.pwdLastSet -eq 0)
            lastLogon = (& $iso $_.lastLogonTimestamp); description = [string]$_.Description
            whenCreated = ([DateTime]$_.whenCreated).ToUniversalTime().ToString('o')
            memberOf = @($_.MemberOf | ForEach-Object { & $cn $_ })
        }
    })

# Users are named by sAMAccountName everywhere (a member DN's CN is the display name).
$samByDn = @{}
foreach ($u in Get-ADUser -Filter *) { $samByDn[[string]$u.DistinguishedName] = [string]$u.SamAccountName }
$principal = { param($dn) if ($samByDn.ContainsKey([string]$dn)) { $samByDn[[string]$dn] } else { & $cn $dn } }

$groupNames = @{}
$allGroups = @(Get-ADGroup -Filter * -Properties ManagedBy)
foreach ($g in $allGroups) { $groupNames[[string]$g.Name] = $true }
$f.groups = @($allGroups | ForEach-Object {
        $g = $_
        # -ShowMemberTimeToLive exposes "<TTL=seconds>,CN=..." for time-bound (PAM) members.
        $members = @((Get-ADGroup $g -Properties member -ShowMemberTimeToLive).member | ForEach-Object {
                $raw = [string]$_
                $ttl = $null
                if ($raw -match '^<TTL=(\d+)>,(.*)$') { $ttl = [int]$Matches[1]; $raw = $Matches[2] }
                $isUser = $samByDn.ContainsKey($raw)
                $name = & $principal $raw
                [ordered]@{ name = $name; type = $(if ($isUser) { 'user' } elseif ($groupNames.ContainsKey($name)) { 'group' } else { 'user' }); ttl = $ttl }
            })
        [ordered]@{
            name = [string]$g.Name; parent = (& $parent $g.DistinguishedName); scope = [string]$g.GroupScope
            category = [string]$g.GroupCategory; managedBy = $(if ($g.ManagedBy) { & $principal $g.ManagedBy } else { $null })
            members = $members
        }
    })

$f.acls = [ordered]@{}
foreach ($d in Get-ChildItem 'C:\Shares' -Directory) {
    $f.acls[$d.FullName.ToLower()] = @((Get-Acl $d.FullName).Access | Where-Object AccessControlType -eq 'Allow' | ForEach-Object {
            $r = [string]$_.FileSystemRights
            $code = if ($r -match 'FullControl') { 'F' } elseif ($r -match 'Modify') { 'M' } elseif ($r -match 'Write') { 'W' } elseif ($r -match 'ReadAndExecute') { 'RX' } else { 'R' }
            [ordered]@{ identity = [string]$_.IdentityReference.Value; rights = $code; inherited = [bool]$_.IsInherited }
        })
}

$textExt = @('.ps1', '.psm1', '.py', '.sh', '.csv', '.json', '.md', '.txt', '.kql', '.log', '.xml', '.yml', '.yaml', '.spl')
$f.files = @(Get-ChildItem 'C:\IAM' -Recurse -File | Where-Object { $_.FullName -notlike 'C:\IAM\scenarios\*' } | Select-Object -First 400 | ForEach-Object {
        $content = $null
        if ($textExt -contains $_.Extension.ToLower() -and $_.Length -le 65536) { $content = [string](Get-Content -Raw -LiteralPath $_.FullName) }
        [ordered]@{ path = $_.FullName.ToLower(); size = [long]$_.Length; modified = $_.LastWriteTimeUtc.ToString('o'); content = $content }
    })

# Identity events the projects are graded on.
$since = (Get-Date).AddDays(-2)
$interesting = @('siem.victim', 'siem.temp', 'dkim')
$f.events = @(Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = 1102, 4624, 4625, 4728, 4729, 4732, 4733, 4756, 4757; StartTime = $since } -MaxEvents 3000 |
    ForEach-Object {
        $x = [xml]$_.ToXml()
        $data = @{}
        foreach ($d in $x.Event.EventData.Data) { $data[[string]$d.Name] = [string]$d.'#text' }
        $member = $(if ($data['MemberName'] -and $data['MemberName'] -ne '-') { & $principal $data['MemberName'] } else { '' })
        $who = [string]$data['TargetUserName']
        if ($_.Id -eq 1102 -or $interesting -contains $who -or $interesting -contains $member) {
            [ordered]@{
                id = [int]$_.Id; time = $_.TimeCreated.ToUniversalTime().ToString('o')
                targetUser = $who; memberName = $member; subjectUser = [string]$data['SubjectUserName']
                logonType = [string]$data['LogonType']; group = $(if ($_.Id -in 4728, 4729, 4732, 4733, 4756, 4757) { $who } else { $null })
            }
        }
    })

$f | ConvertTo-Json -Depth 8 -Compress
