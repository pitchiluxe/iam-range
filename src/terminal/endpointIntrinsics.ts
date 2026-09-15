/**
 * terminal/endpointIntrinsics.ts — the network and desk-side commands, run on
 * an end user's computer.
 *
 * When the shell is running inside a Remote Desktop session (ctx.host is set),
 * `ipconfig`, `ping`, `nslookup`, `net use`, `netsh wlan` and `cmdkey` answer
 * from that computer's real state, and their fixing switches — /renew,
 * /flushdns, /delete — change it. These are the commands a desk-side
 * technician types first, so they are the ones that have to be honest: an
 * APIPA address shows as 169.254, a stale cache answers with the old address.
 *
 * On the admin's own workstation this returns null and the ordinary
 * intrinsics describe that machine, as before.
 */
import type { CapabilityContext, Endpoint } from '@/services';
import { CORP_WIFI, GUEST_WIFI } from '@/services/mockEndpoints';
import { VM_HOST } from '@/config/vmHost';
import type { IntrinsicResult } from './shellIntrinsics';

const lower = (v: string | undefined): string => (v ?? '').toLowerCase();

function ipconfigText(e: Endpoint, all: boolean): string {
  const n = e.network;
  const header = ['Windows IP Configuration', ''];
  if (all) {
    header.push(
      `   Host Name . . . . . . . . . . . . : ${e.name}`,
      `   Primary Dns Suffix  . . . . . . . : ${VM_HOST.domain}`,
      '',
    );
  }
  if (!n.adapterEnabled) {
    // A disabled adapter is not listed at all, which is itself the clue.
    return [...header, 'No network adapters are enabled on this computer.'].join('\n');
  }
  if (!n.ssid) {
    return [
      ...header,
      `Wireless LAN adapter ${n.adapterName}:`,
      '',
      '   Media State . . . . . . . . . . . : Media disconnected',
    ].join('\n');
  }
  const apipa = n.ipv4.startsWith('169.254.');
  const lines = [
    ...header,
    `Wireless LAN adapter ${n.adapterName}:`,
    '',
    `   Connection-specific DNS Suffix  . : ${n.ssid === CORP_WIFI ? VM_HOST.domain : ''}`,
  ];
  if (all) {
    lines.push(
      `   Description . . . . . . . . . . . : Intel(R) Wi-Fi 6E AX211 160MHz`,
      `   Physical Address. . . . . . . . . : ${e.mac}`,
      `   DHCP Enabled. . . . . . . . . . . : Yes`,
    );
  }
  lines.push(
    apipa
      ? `   Autoconfiguration IPv4 Address. . : ${n.ipv4}(Preferred)`
      : `   IPv4 Address. . . . . . . . . . . : ${n.ipv4}`,
    `   Subnet Mask . . . . . . . . . . . : ${apipa ? '255.255.0.0' : '255.255.255.0'}`,
    `   Default Gateway . . . . . . . . . : ${n.gateway}`,
  );
  if (all) lines.push(`   DNS Servers . . . . . . . . . . . : ${apipa ? '' : n.dnsServer}`);
  return lines.join('\n');
}

export function runEndpointIntrinsic(
  name: string,
  args: string[],
  ctx: CapabilityContext | null,
): IntrinsicResult | null {
  if (!ctx?.host || !ctx.endpoints) return null;
  const eps = ctx.endpoints;
  const e = eps.get(ctx.host);
  if (!e) return null;
  const flags = args.map(lower);

  switch (name) {
    case 'hostname':
      return { output: e.name };

    case 'whoami':
      return { output: `${VM_HOST.netbiosDomain}\\${e.username}` };

    case 'ipconfig': {
      if (flags.includes('/release')) {
        const r = eps.releaseIp(e.name, ctx.actor);
        return r.ok ? { output: ipconfigText(e, false) } : { output: r.error, ok: false };
      }
      if (flags.includes('/renew')) {
        const r = eps.renewIp(e.name, ctx.actor);
        return r.ok ? { output: ipconfigText(e, false) } : { output: r.error, ok: false };
      }
      if (flags.includes('/flushdns')) {
        const r = eps.flushDns(e.name, ctx.actor);
        return {
          output: r.ok ? 'Windows IP Configuration\n\nSuccessfully flushed the DNS Resolver Cache.' : r.error,
          ok: r.ok,
        };
      }
      if (flags.includes('/displaydns')) {
        const entries = Object.entries(e.network.dnsCache);
        return {
          output: entries.length
            ? ['Windows IP Configuration', '', ...entries.map(([host, ip]) => `    ${host}\n    ----------------------------------------\n    A (Host) Record . . . : ${ip}\n`)].join('\n')
            : 'Windows IP Configuration\n\nThe DNS resolver cache is empty.',
        };
      }
      return { output: ipconfigText(e, flags.includes('/all')) };
    }

    case 'nslookup': {
      const target = args.find((a) => !a.startsWith('-'));
      if (!target) return { output: 'Usage: nslookup <host>', ok: false };
      const server = e.network.ssid === CORP_WIFI
        ? `${VM_HOST.domainController.toLowerCase()}.${VM_HOST.domain}`
        : 'UnKnown';
      const head = [`Server:  ${server}`, `Address:  ${e.network.dnsServer || '(none)'}`, ''];
      const r = eps.resolveName(e.name, target);
      if ('error' in r) return { output: [...head, r.error].join('\n'), ok: false };
      return {
        output: [
          ...head,
          r.fromCache ? 'Non-authoritative answer (from the local cache):' : 'Non-authoritative answer:',
          `Name:    ${target}`,
          `Address:  ${r.ip}`,
        ].join('\n'),
      };
    }

    case 'ping': {
      const target = args.find((a) => !a.startsWith('-'));
      if (!target) return { output: 'Usage: ping <host>', ok: false };
      const ip = /^\d+\.\d+\.\d+\.\d+$/.test(target) ? { ip: target } : eps.resolveName(e.name, target);
      if ('error' in ip) {
        return {
          output: `Ping request could not find host ${target}. Please check the name and try again.`,
          ok: false,
        };
      }
      const label = ip.ip === target ? target : `${target} [${ip.ip}]`;
      if (!eps.reachable(e.name, ip.ip)) {
        return {
          output: [
            `Pinging ${label} with 32 bytes of data:`,
            'Request timed out.',
            'Request timed out.',
            'Request timed out.',
            'Request timed out.',
            '',
            `Ping statistics for ${ip.ip}:`,
            '    Packets: Sent = 4, Received = 0, Lost = 4 (100% loss)',
          ].join('\n'),
          ok: false,
        };
      }
      return {
        output: [
          `Pinging ${label} with 32 bytes of data:`,
          ...Array.from({ length: 4 }, () => `Reply from ${ip.ip}: bytes=32 time=2ms TTL=127`),
          '',
          `Ping statistics for ${ip.ip}:`,
          '    Packets: Sent = 4, Received = 4, Lost = 0 (0% loss)',
        ].join('\n'),
      };
    }

    case 'net': {
      if (flags[0] !== 'use') return null; // `net user` is the directory lookup, unchanged.
      const letter = args[1];
      if (!letter) {
        if (e.drives.length === 0) return { output: 'New connections will be remembered.\n\nThere are no entries in the list.' };
        return {
          output: [
            'New connections will be remembered.',
            '',
            'Status       Local     Remote                    Network',
            '-------------------------------------------------------------------------------',
            ...e.drives.map((d) => `OK           ${d.letter.padEnd(9)} ${d.path.padEnd(25)} Microsoft Windows Network`),
            'The command completed successfully.',
          ].join('\n'),
        };
      }
      if (flags.includes('/delete') || flags.includes('/d')) {
        const r = eps.removeDrive(e.name, letter, ctx.actor);
        return { output: r.ok ? `${letter.toUpperCase()} was deleted successfully.` : r.error, ok: r.ok };
      }
      const path = args[2];
      if (!path) return { output: 'The syntax of this command is:\n\nNET USE [drive: [\\\\server\\share]] [/DELETE]', ok: false };
      const r = eps.mapDrive(e.name, letter, path, ctx.actor);
      return { output: r.ok ? 'The command completed successfully.' : r.error, ok: r.ok };
    }

    case 'netsh': {
      if (flags[0] !== 'wlan') return { output: 'Only "netsh wlan" is available on this computer.', ok: false };
      if (flags[1] === 'show' && (flags[2] === 'interfaces' || flags[2] === 'interface')) {
        const n = e.network;
        return {
          output: [
            'There is 1 interface on the system:',
            '',
            `    Name                   : ${n.adapterName}`,
            `    State                  : ${!n.adapterEnabled ? 'disabled' : n.ssid ? 'connected' : 'disconnected'}`,
            `    SSID                   : ${n.ssid ?? ''}`,
            `    Radio status           : Hardware On, Software ${n.adapterEnabled ? 'On' : 'Off'}`,
          ].join('\n'),
        };
      }
      if (flags[1] === 'show' && flags[2] === 'networks') {
        if (!e.network.adapterEnabled) return { output: 'The wireless local area network interface is powered down.', ok: false };
        return { output: ['Interface name : Wi-Fi', 'There are 2 networks currently visible.', '', `SSID 1 : ${CORP_WIFI}`, '    Authentication : WPA3-Enterprise', '', `SSID 2 : ${GUEST_WIFI}`, '    Authentication : WPA2-Personal'].join('\n') };
      }
      if (flags[1] === 'connect') {
        const nameArg = args.find((a) => lower(a).startsWith('name=') || lower(a).startsWith('ssid='));
        const ssid = nameArg?.split('=')[1];
        if (!ssid) return { output: 'Usage: netsh wlan connect name=<network>', ok: false };
        const r = eps.connectWifi(e.name, ssid, ctx.actor);
        return { output: r.ok ? 'Connection request was completed successfully.' : r.error, ok: r.ok };
      }
      return { output: 'Usage: netsh wlan show interfaces | show networks | connect name=<network>', ok: false };
    }

    case 'cmdkey': {
      const del = args.find((a) => lower(a).startsWith('/delete:'));
      if (del) {
        const target = del.slice('/delete:'.length);
        const r = eps.removeCredential(e.name, target, ctx.actor);
        return { output: r.ok ? '\nCredential deleted successfully.' : r.error, ok: r.ok };
      }
      if (flags.includes('/list') || flags.length === 0) {
        if (e.credentials.length === 0) return { output: '\nCurrently stored credentials:\n\n* NONE *' };
        return {
          output: [
            '',
            'Currently stored credentials:',
            '',
            ...e.credentials.flatMap((c) => [
              `    Target: ${c.target}`,
              '    Type: Generic',
              `    User: ${c.user}`,
              `    Saved: ${c.stale ? 'before the last password change' : 'current'}`,
              '',
            ]),
          ].join('\n'),
        };
      }
      return { output: 'Usage: cmdkey /list | /delete:<target>', ok: false };
    }

    case 'systeminfo':
      return {
        output: [
          `Host Name:                 ${e.name}`,
          `OS Name:                   ${VM_HOST.os}`,
          `Domain:                    ${VM_HOST.domain}`,
          `Registered Owner:          ${e.username}`,
          `Network Card(s):           1 NIC(s) Installed. [01]: ${e.network.adapterName} ${e.network.adapterEnabled ? e.network.ipv4 : '(disabled)'}`,
        ].join('\n'),
      };

    default:
      return null;
  }
}
