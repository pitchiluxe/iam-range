<#
.SYNOPSIS
    Create DC01 and CLIENT01 in VirtualBox and start unattended Windows installs.

.DESCRIPTION
    Wires the network exactly like the lab diagram:

      DC01 NIC 1 "Internet"  -> VirtualBox NAT (plays the home router: DHCP, internet)
      DC01 NIC 2 "Internal"  -> internal network TechnoBiz-LAN
      CLIENT01 NIC "Ethernet"-> internal network TechnoBiz-LAN

    TechnoBiz-LAN has no DHCP server, exactly like the lab: until you build one
    on DC01 in Lab 04, anything on it self-assigns 169.254.x.x.

    DC01 is installed with a random-looking name (WIN-7Q2K9STBL4) because
    renaming it is part of Lab 01. Nothing else is configured for you.

    Installing Windows takes 20–40 minutes per VM. Run 02-Initialize-AdLabGuests.ps1
    afterwards; it waits for both.

    The answer file comes from VirtualBox's own template with two changes (see
    New-AdLabUnattendTemplate): the empty <Key></Key> is removed — Microsoft's
    evaluation media stop with "Windows cannot find the Microsoft Software
    License Terms" when given one — and Windows 11's TPM/Secure Boot checks are
    skipped with Microsoft's LabConfig switches, so CLIENT01 can boot plain
    BIOS. EFI + TPM under VirtualBox on a host where Hyper-V is active is slow
    enough to look hung.

.PARAMETER Only
    Build just one of the two VMs.
#>
[CmdletBinding()]
param([ValidateSet('DC01', 'CLIENT01')][string[]]$Only = @('DC01', 'CLIENT01'))

. (Join-Path $PSScriptRoot 'AdLab.Common.ps1')
$cfg = Get-AdLabConfig

if (-not (Test-Path $cfg.vboxManage)) { throw "VBoxManage not found at $($cfg.vboxManage). Install VirtualBox 7 first." }

function New-AdLabUnattendTemplate {
    $vboxDir = Split-Path $cfg.vboxManage
    $src = Join-Path $vboxDir 'UnattendedTemplates\win_nt6_unattended.xml'
    $xml = Get-Content -Raw -Path $src
    # 1. No product key element at all (evaluation media reject an empty one).
    $xml = [regex]::Replace($xml, '\s*<ProductKey>.*?</ProductKey>', '', 'Singleline')
    # 2. Windows 11 lab bypass, run in WinPE before Setup checks the hardware.
    $bypass = @'

            <RunSynchronous>
                <RunSynchronousCommand wcm:action="add"><Order>1</Order><Path>reg add HKLM\SYSTEM\Setup\LabConfig /v BypassTPMCheck /t REG_DWORD /d 1 /f</Path></RunSynchronousCommand>
                <RunSynchronousCommand wcm:action="add"><Order>2</Order><Path>reg add HKLM\SYSTEM\Setup\LabConfig /v BypassSecureBootCheck /t REG_DWORD /d 1 /f</Path></RunSynchronousCommand>
                <RunSynchronousCommand wcm:action="add"><Order>3</Order><Path>reg add HKLM\SYSTEM\Setup\LabConfig /v BypassRAMCheck /t REG_DWORD /d 1 /f</Path></RunSynchronousCommand>
            </RunSynchronous>
'@
    # 3. BIOS layout: VirtualBox creates the partition but never formats it. The
    #    old installer coped; Windows 11 26100+ refuses "an error selecting this
    #    partition". Format it, give it C: and mark it active.
    $biosCreate = '</CreatePartitions>' + "`r`n" + '@@VBOX_COND_END@@'
    $biosCreate2 = '</CreatePartitions>' + "`n" + '@@VBOX_COND_END@@'
    $modify = @'
</CreatePartitions>
                    <ModifyPartitions>
                        <ModifyPartition wcm:action="add">
                            <Order>1</Order>
                            <PartitionID>1</PartitionID>
                            <Label>Windows</Label>
                            <Letter>C</Letter>
                            <Format>NTFS</Format>
                            <Active>true</Active>
                        </ModifyPartition>
                    </ModifyPartitions>
@@VBOX_COND_END@@
'@
    if ($xml.Contains($biosCreate)) { $xml = $xml.Replace($biosCreate, $modify.TrimEnd()) }
    elseif ($xml.Contains($biosCreate2)) { $xml = $xml.Replace($biosCreate2, $modify.TrimEnd()) }
    else { throw "Unexpected VirtualBox template (BIOS partitions): $src" }
    $marker = '<DiskConfiguration>'
    $at = $xml.IndexOf($marker)
    if ($at -lt 0) { throw "Unexpected VirtualBox template: $src" }
    $xml = $xml.Insert($at, $bypass.TrimStart() + "`n            ")
    $out = Join-Path $env:TEMP 'adlab-autounattend.xml'
    Set-Content -Path $out -Value $xml -Encoding UTF8
    return $out
}
$template = New-AdLabUnattendTemplate

foreach ($key in $Only) {
    $spec = $cfg.vms.$key
    $iso = if ($key -eq 'DC01') { $cfg.isos.server } else { $cfg.isos.client }
    if (-not (Test-Path $iso)) { throw "ISO for $key not found: $iso" }
    if (Test-AdLabVmExists $spec.vmName) {
        Write-Warning "$($spec.vmName) already exists — skipped. Remove it with Remove-AdLabVMs.ps1 to rebuild."
        continue
    }

    Write-Host "`n=== Creating $($spec.vmName) ($key) ===" -ForegroundColor Cyan
    New-Item -ItemType Directory -Force -Path $cfg.vmFolder | Out-Null
    Invoke-VBox createvm --name $spec.vmName --ostype $spec.osType --groups $cfg.group --basefolder $cfg.vmFolder --register | Out-Null

    $modify = @(
        'modifyvm', $spec.vmName,
        '--memory', $spec.memoryMB, '--cpus', $spec.cpus,
        '--firmware', $spec.firmware,
        '--graphicscontroller', 'vboxsvga', '--vram', '128',
        '--clipboard-mode', 'bidirectional', '--drag-and-drop', 'disabled',
        '--ioapic', 'on', '--rtc-use-utc', 'on'
    )
    foreach ($nic in $spec.nics) {
        $s = $nic.slot
        $modify += @("--nic$s", $nic.mode, "--nic-type$s", '82540EM', "--mac-address$s", $nic.mac, "--cable-connected$s", 'on')
        if ($nic.mode -eq 'intnet') { $modify += @("--intnet$s", $cfg.internalNetwork) }
    }
    if ($spec.firmware -eq 'efi') { $modify += @('--tpm-type', '2.0') }
    Invoke-VBox @modify | Out-Null

    if ($spec.firmware -eq 'efi') {
        # Windows 11 insists on Secure Boot and a TPM.
        Invoke-VBox modifynvram $spec.vmName inituefivarstore | Out-Null
        Invoke-VBox modifynvram $spec.vmName enrollmssignatures | Out-Null
        Invoke-VBox modifynvram $spec.vmName enrollorclpk | Out-Null
        Invoke-VBox modifynvram $spec.vmName secureboot --enable | Out-Null
    }

    # VirtualBox nests grouped VMs under the group name; put the disk beside the .vbox.
    $cfgFile = ((Invoke-VBox showvminfo $spec.vmName --machinereadable) | Where-Object { $_ -like 'CfgFile=*' }) -replace '^CfgFile="(.*)"$', '$1'
    $vmDir = Split-Path ($cfgFile -replace '\\\\', '\')
    $disk = Join-Path $vmDir "$($spec.vmName).vdi"
    Invoke-VBox createmedium disk --filename $disk --size ($spec.diskGB * 1024) --format VDI | Out-Null
    # Host I/O cache on: without it, Windows 11 (26100+) Setup resets the AHCI
    # controller a minute in and waits forever when VirtualBox runs on Hyper-V.
    Invoke-VBox storagectl $spec.vmName --name SATA --add sata --controller IntelAhci --portcount 4 --bootable on --hostiocache on | Out-Null
    Invoke-VBox storageattach $spec.vmName --storagectl SATA --port 0 --device 0 --type hdd --medium $disk | Out-Null
    Invoke-VBox storageattach $spec.vmName --storagectl SATA --port 1 --device 0 --type dvddrive --medium emptydrive | Out-Null

    # The lab password goes through a file, not the command line, so it does
    # not sit in the host's process list while Setup runs.
    $pwFile = New-TemporaryFile
    try {
        Set-Content -Path $pwFile -Value $cfg.adminPassword -NoNewline -Encoding ascii
        Write-Host "Starting unattended install of $($spec.osType) (image $($spec.imageIndex))…"
        Invoke-VBox unattended install $spec.vmName `
            "--iso=$iso" `
            "--user=$($cfg.adminUser)" "--user-password-file=$pwFile" "--admin-password-file=$pwFile" `
            '--full-user-name=Lab Administrator' `
            '--install-additions' `
            '--locale=en_US' '--country=US' '--time-zone=UTC' `
            "--hostname=$($spec.setupHostname).lab.local" `
            "--image-index=$($spec.imageIndex)" `
            "--script-template=$template" `
            '--start-vm=gui' | Out-Null
    } finally {
        Remove-Item $pwFile -Force -ErrorAction SilentlyContinue
    }
    Write-Host "$($spec.vmName) is installing Windows in its own window. Leave it alone until it reaches the desktop." -ForegroundColor Green
}

Write-Host "`nNext: .\02-Initialize-AdLabGuests.ps1 (waits for both installs to finish)." -ForegroundColor Yellow
