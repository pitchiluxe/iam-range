<#
.SYNOPSIS
    Read-only: collect the facts "Check My Work" needs from the real VMs.

.DESCRIPTION
    Runs a read-only collector inside DC01 and CLIENT01 through VirtualBox
    Guest Control and prints one JSON document. IAM Range turns it into the
    same lab state its validation engine and instructor already understand,
    so the real VMs are graded by exactly the checks the simulator uses.

    Nothing here changes either VM: every guest command is a Get-*, netsh
    show, gpresult or a registry read. The student still does all the work.

.PARAMETER Json
    Print compact JSON only (what the app reads). Without it, pretty JSON.
#>
[CmdletBinding()]
param([switch]$Json)

. (Join-Path $PSScriptRoot 'AdLab.Common.ps1')
$cfg = Get-AdLabConfig

# ---------------------------------------------------------------------------
# The collector that runs inside each guest. Read-only by construction.
# ---------------------------------------------------------------------------
$collector = @'
$ErrorActionPreference = 'SilentlyContinue'
$f = [ordered]@{}
$cs = Get-CimInstance Win32_ComputerSystem
$f.hostname = $env:COMPUTERNAME
$f.os = (Get-CimInstance Win32_OperatingSystem).Caption
$pending = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\ComputerName\ComputerName').ComputerName
$f.pendingHostname = if ($pending -and $pending -ne $env:COMPUTERNAME) { $pending } else { $null }
$f.domain = if ($cs.PartOfDomain) { $cs.Domain.ToLower() } else { $null }
$f.joinPending = (Test-Path 'HKLM:\SYSTEM\CurrentControlSet\Services\Netlogon\JoinDomain')

$f.nics = @(Get-NetAdapter | Sort-Object Name | ForEach-Object {
    $a = $_
    $ipif = Get-NetIPInterface -InterfaceIndex $a.ifIndex -AddressFamily IPv4
    $ip = Get-NetIPAddress -InterfaceIndex $a.ifIndex -AddressFamily IPv4 | Select-Object -First 1
    $gw = Get-NetRoute -InterfaceIndex $a.ifIndex -DestinationPrefix '0.0.0.0/0' | Select-Object -First 1
    $dns = (Get-DnsClientServerAddress -InterfaceIndex $a.ifIndex -AddressFamily IPv4).ServerAddresses
    $reg = Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\$($a.InterfaceGuid)"
    [ordered]@{
        alias = $a.Name; mac = $a.MacAddress
        dhcp = ($ipif.Dhcp -eq 'Enabled')
        ip = $ip.IPAddress; prefix = $ip.PrefixLength
        gateway = $gw.NextHop
        dns = @($dns); dnsStatic = [bool]$reg.NameServer
        leaseFrom = if ($reg.DhcpServer -and $reg.DhcpServer -ne '255.255.255.255') { $reg.DhcpServer } else { $null }
        suffix = $reg.DhcpDomain
    }
})

if ((Get-CimInstance Win32_OperatingSystem).ProductType -ne 1) {
    $f.features = @(Get-WindowsFeature AD-Domain-Services, DNS, DHCP, RemoteAccess, Routing | Where-Object Installed | ForEach-Object Name)
} else { $f.features = @() }
$f.services = [ordered]@{}
foreach ($s in Get-Service DNS, DHCPServer, NTDS, Netlogon, RemoteAccess, Kdc, ADWS, Dnscache, Dhcp) { $f.services[$s.Name] = "$($s.Status)" }

# Group Policy only matters once the computer is in a domain; gpresult is the slowest step.
$gp = if ($cs.PartOfDomain) { gpresult /scope computer /r 2>$null } else { @() }
$applied = @(); $in = $false
foreach ($line in $gp) {
    if ($line -match 'Applied Group Policy Objects') { $in = $true; continue }
    if ($in) {
        if ($line -match '^\s*-+\s*$') { continue }
        if ($line.Trim() -eq '') { if ($applied.Count) { break } else { continue } }
        $applied += $line.Trim()
    }
}
$f.appliedGpos = $applied

$hist = Join-Path $env:APPDATA 'Microsoft\Windows\PowerShell\PSReadLine\ConsoleHost_history.txt'
# [string] strips the PSPath/PSDrive/PSProvider notes Get-Content attaches in Windows
# PowerShell 5.1 — ConvertTo-Json would otherwise try to serialise the provider tree.
$f.history = @(if (Test-Path $hist) { Get-Content $hist -Tail 40 | ForEach-Object { [string]$_ } })

$f.events = @(
    Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = 4740 } -MaxEvents 5
    Get-WinEvent -FilterHashtable @{ LogName = 'System'; Id = 5719, 1129, 4097 } -MaxEvents 5
) | Where-Object { $_ } | ForEach-Object { [ordered]@{ log = $_.LogName; id = $_.Id; level = "$($_.LevelDisplayName)"; source = $_.ProviderName; message = ($_.Message -split "`n")[0] } }

if ($f.services['NTDS'] -eq 'Running') {
    Import-Module ActiveDirectory, GroupPolicy
    $d = Get-ADDomain
    $parent = { param($dn) $dn -replace '^(CN|OU)=.+?(?<!\\),', '' }
    $ad = [ordered]@{ forest = $d.DNSRoot.ToLower(); netbios = $d.NetBIOSName }
    $ad.ous = @((Get-ADOrganizationalUnit -Filter *).DistinguishedName)
    $ad.users = @(Get-ADUser -Filter * -Properties LockedOut, BadLogonCount, Department, pwdLastSet | ForEach-Object {
        [ordered]@{ sam = $_.SamAccountName; name = $_.Name; givenName = "$($_.GivenName)"; surname = "$($_.Surname)"
            parent = (& $parent $_.DistinguishedName); enabled = [bool]$_.Enabled; lockedOut = [bool]$_.LockedOut
            badPwdCount = [int]$_.BadLogonCount; passwordSet = ([bool]$_.Enabled -or $_.pwdLastSet -gt 0)
            changePasswordAtLogon = ($_.pwdLastSet -eq 0); department = $_.Department }
    })
    $ad.groups = @(Get-ADGroup -Filter * -Properties isCriticalSystemObject | ForEach-Object {
        $builtin = [bool]$_.isCriticalSystemObject
        [ordered]@{ name = $_.Name; parent = (& $parent $_.DistinguishedName); scope = "$($_.GroupScope)"; category = "$($_.GroupCategory)"
            builtin = $builtin; members = @(if (-not $builtin) { (Get-ADGroupMember $_).SamAccountName }) }
    })
    $ad.computers = @(Get-ADComputer -Filter * | ForEach-Object { [ordered]@{ name = $_.Name; parent = (& $parent $_.DistinguishedName) } })
    $links = @{}
    foreach ($t in @($d.DistinguishedName) + $ad.ous) {
        foreach ($l in (Get-GPInheritance -Target $t).GpoLinks) {
            if (-not $links[$l.DisplayName]) { $links[$l.DisplayName] = @() }
            $links[$l.DisplayName] += $t
        }
    }
    $ad.gpos = @(Get-GPO -All | ForEach-Object { [ordered]@{ name = $_.DisplayName; links = @($links[$_.DisplayName]) } })
    $pol = Get-ADDefaultDomainPasswordPolicy
    $ad.passwordPolicy = [ordered]@{ minPasswordLength = $pol.MinPasswordLength; lockoutThreshold = $pol.LockoutThreshold; complexityEnabled = [bool]$pol.ComplexityEnabled }
    $f.ad = $ad
}

if ($f.services['DNS'] -eq 'Running') {
    $zones = @(Get-DnsServerZone | Where-Object { -not $_.IsAutoCreated -and $_.ZoneName -ne 'TrustAnchors' -and -not $_.IsReverseLookupZone } | ForEach-Object { $_.ZoneName.ToLower() })
    $records = @()
    foreach ($z in $zones | Where-Object { $_ -notlike '_msdcs.*' }) {
        $records += Get-DnsServerResourceRecord -ZoneName $z -RRType A | ForEach-Object {
            [ordered]@{ zone = $z; name = $_.HostName.ToLower(); ip = $_.RecordData.IPv4Address.ToString() } }
    }
    $f.dns = [ordered]@{ zones = $zones; records = @($records) }
}

if ($f.features -contains 'DHCP') {
    $opt = { param($vals, $id) ($vals | Where-Object OptionId -eq $id).Value }
    $server = Get-DhcpServerv4OptionValue
    $f.dhcp = [ordered]@{
        authorized = [bool](Get-DhcpServerInDC)
        serverOptions = [ordered]@{ router = (& $opt $server 3 | Select-Object -First 1); dns = @(& $opt $server 6); dnsDomain = (& $opt $server 15 | Select-Object -First 1) }
        scopes = @(Get-DhcpServerv4Scope | ForEach-Object {
            $v = Get-DhcpServerv4OptionValue -ScopeId $_.ScopeId
            [ordered]@{ scopeId = "$($_.ScopeId)"; name = $_.Name; start = "$($_.StartRange)"; end = "$($_.EndRange)"; mask = "$($_.SubnetMask)"
                active = ("$($_.State)" -eq 'Active'); router = (& $opt $v 3 | Select-Object -First 1); dns = @(& $opt $v 6); dnsDomain = (& $opt $v 15 | Select-Object -First 1) }
        })
        leases = @(Get-DhcpServerv4Scope | ForEach-Object { Get-DhcpServerv4Lease -ScopeId $_.ScopeId } | ForEach-Object {
            [ordered]@{ ip = "$($_.IPAddress)"; hostname = "$($_.HostName)".Split('.')[0].ToLower(); mac = "$($_.ClientId)".ToUpper(); scopeId = "$($_.ScopeId)" } })
    }
}

if ($f.features -contains 'RemoteAccess') {
    $ra = Get-RemoteAccess
    $natText = netsh routing ip nat show interface 2>$null
    $nat = [ordered]@{}; $cur = $null
    foreach ($line in $natText) {
        if ($line -match '^NAT (.+) Configuration') { $cur = $Matches[1].Trim() }
        elseif ($cur -and $line -match 'Mode\s*:\s*(.+)') { $nat[$cur] = if ($Matches[1] -match 'Public') { 'public' } else { 'private' } }
    }
    $f.routing = [ordered]@{ configured = ("$($ra.RoutingStatus)" -eq 'Installed'); natInstalled = ($LASTEXITCODE -eq 0 -and "$natText" -notmatch 'not found'); natInterfaces = $nat }
}

$f.shares = @(Get-SmbShare | Where-Object { -not $_.Special -and $_.Name -notin 'NETLOGON', 'SYSVOL' } | ForEach-Object {
    $s = $_
    [ordered]@{ name = $s.Name; path = $s.Path
        access = @(Get-SmbShareAccess -Name $s.Name | Where-Object AccessControlType -eq 'Allow' | ForEach-Object { [ordered]@{ identity = $_.AccountName; rights = "$($_.AccessRight)" } })
        ntfs = @((Get-Acl $s.Path).Access | Where-Object AccessControlType -eq 'Allow' | ForEach-Object {
            $r = "$($_.FileSystemRights)"
            $code = if ($r -match 'FullControl') { 'F' } elseif ($r -match 'Modify') { 'M' } elseif ($r -match 'ReadAndExecute') { 'RX' } elseif ($r -match 'Write') { 'W' } else { 'R' }
            [ordered]@{ identity = $_.IdentityReference.Value; rights = $code; inherited = [bool]$_.IsInherited } })
    }
})

$f | ConvertTo-Json -Depth 8 -Compress
'@

$result = [ordered]@{ collectedAt = (Get-Date).ToString('o'); vms = [ordered]@{}; networks = [ordered]@{} }
foreach ($key in 'DC01', 'CLIENT01') {
    $spec = $cfg.vms.$key
    foreach ($nic in $spec.nics) { $result.networks[(Format-AdLabMac $nic.mac)] = $nic.network }
    $entry = [ordered]@{ vmName = $spec.vmName; exists = (Test-AdLabVmExists $spec.vmName); running = $false; state = $null; facts = $null; error = $null }
    if ($entry.exists) { $entry.state = Get-AdLabVmState $spec.vmName; $entry.running = ($entry.state -eq 'running') }
    if ($entry.running) {
        try {
            $raw = Invoke-AdLabGuest -Host_ $key -Script $collector -TimeoutSec 420
            $jsonLine = ($raw -split "`n" | Where-Object { $_.TrimStart().StartsWith('{') } | Select-Object -Last 1)
            $entry.facts = $jsonLine | ConvertFrom-Json
        } catch {
            $entry.error = $_.Exception.Message
        }
    }
    $result.vms[$key] = $entry
}

if ($Json) { $result | ConvertTo-Json -Depth 10 -Compress } else { $result | ConvertTo-Json -Depth 10 }
