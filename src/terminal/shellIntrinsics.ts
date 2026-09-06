/**
 * terminal/shellIntrinsics.ts — the everyday Windows/PowerShell commands a
 * learner reflexively types, answered from the simulation's own state.
 *
 * These are not IAM capabilities, so they are not in the registry: they are
 * shell built-ins and OS utilities. They exist because a terminal that rejects
 * `dir`, `whoami` or `ipconfig` reads as broken, and because `whoami` /
 * `net user` are genuinely part of the identity-troubleshooting vocabulary.
 *
 * Output mirrors the real tools closely enough to be recognisable, against the
 * simulated Northwind host rather than the machine the app is running on —
 * this is a lab, and leaking the real host's details would be both wrong and
 * a privacy problem.
 */
import type { CapabilityContext } from '@/services';
import { formatTable } from './format';

import { VM_ACCOUNT, VM_HOST } from '@/config/vmHost';

/** The simulated workstation. Shared with the Settings app via config/vmHost.ts
 *  so the two cannot describe the same machine differently. */
const HOST = VM_HOST;

/** A fake but stable filesystem, so `dir` and `cd` behave consistently. */
const FILES: ReadonlyArray<{ name: string; kind: 'dir' | 'file'; size?: number }> = [
  { name: 'Evidence', kind: 'dir' },
  { name: 'Runbooks', kind: 'dir' },
  { name: 'Scripts', kind: 'dir' },
  { name: 'access-review-q3.csv', kind: 'file', size: 18244 },
  { name: 'offboarding-checklist.txt', kind: 'file', size: 2130 },
  { name: 'sso-troubleshooting.md', kind: 'file', size: 7418 },
];

export interface IntrinsicResult {
  output: string;
  control?: 'clear' | 'exit';
}

function dirListing(cwd: string): string {
  const stamp = new Date().toLocaleString();
  const lines = [
    ` Volume in drive C has no label.`,
    ``,
    ` Directory of ${cwd}`,
    ``,
    ...FILES.map((f) => {
      const kind = f.kind === 'dir' ? '<DIR>         ' : String(f.size ?? 0).padStart(14);
      return `${stamp}    ${kind} ${f.name}`;
    }),
    `${String(FILES.filter((f) => f.kind === 'file').length).padStart(16)} File(s)`,
    `${String(FILES.filter((f) => f.kind === 'dir').length).padStart(16)} Dir(s)`,
  ];
  return lines.join('\n');
}

function ipconfig(): string {
  return [
    'Windows IP Configuration',
    '',
    'Ethernet adapter Ethernet:',
    '',
    `   Connection-specific DNS Suffix  . : ${HOST.domain}`,
    `   IPv4 Address. . . . . . . . . . . : ${HOST.ip}`,
    '   Subnet Mask . . . . . . . . . . . : 255.255.255.0',
    `   Default Gateway . . . . . . . . . : ${HOST.gateway}`,
    `   DNS Servers . . . . . . . . . . . : ${HOST.dns}`,
    `   Physical Address. . . . . . . . . : ${HOST.mac}`,
  ].join('\n');
}

/**
 * Run a shell built-in. Returns null when `name` is not an intrinsic, so the
 * dispatcher can fall through to the capability registry.
 *
 * @param cwd Mutable current directory, owned by the caller so `cd` sticks.
 */
export function runIntrinsic(
  name: string,
  args: string[],
  ctx: CapabilityContext | null,
  cwd: { path: string },
): IntrinsicResult | null {
  switch (name) {
    case 'cls':
    case 'clear':
    case 'clear-host':
      return { output: '', control: 'clear' };

    case 'exit':
    case 'quit':
      return { output: '', control: 'exit' };

    case 'dir':
    case 'ls':
    case 'get-childitem':
      return { output: dirListing(cwd.path) };

    case 'cd':
    case 'chdir':
    case 'set-location': {
      const target = args[0];
      if (!target) return { output: cwd.path };
      if (target === '..') {
        cwd.path = cwd.path.replace(/\\[^\\]+\\?$/, '') || 'C:\\';
      } else if (/^[a-z]:\\/i.test(target)) {
        cwd.path = target;
      } else if (
        FILES.some((f) => f.kind === 'dir' && f.name.toLowerCase() === target.toLowerCase())
      ) {
        cwd.path = `${cwd.path.replace(/\\$/, '')}\\${target}`;
      } else {
        return {
          output: `cd : Cannot find path '${target}' because it does not exist.`,
        };
      }
      return { output: '' };
    }

    case 'pwd':
    case 'get-location':
      return { output: cwd.path };

    case 'whoami': {
      // Reflects the operator identity the console acts as, which is the point
      // of typing whoami during an identity investigation.
      return { output: VM_ACCOUNT };
    }

    case 'hostname':
      return { output: HOST.name };

    case 'ipconfig':
      return { output: ipconfig() };

    case 'ver':
      return { output: `\n${HOST.os} [Version ${HOST.osVersion}]\n` };

    case 'systeminfo':
      return {
        output: [
          `Host Name:                 ${HOST.name}`,
          `OS Name:                   ${HOST.os}`,
          `OS Version:                ${HOST.osVersion}`,
          `Domain:                    ${HOST.domain}`,
          `Logon Server:              \\\\NW-DC01`,
        ].join('\n'),
      };

    case 'date':
      return { output: new Date().toDateString() };

    case 'time':
      return { output: new Date().toLocaleTimeString() };

    case 'echo':
    case 'write-output':
      return { output: args.join(' ') };

    case 'net': {
      // `net user` is the classic quick account check.
      if ((args[0] ?? '').toLowerCase() !== 'user') {
        return { output: `The syntax of this command is:\n\nNET USER [username]` };
      }
      if (!ctx) return { output: 'No active lab session.' };
      const who = args[1];
      if (!who) {
        const names = ctx.dir.listUsers().map((u) => u.username);
        return { output: [`User accounts for \\\\${HOST.name}`, '', ...names].join('\n') };
      }
      const u = ctx.dir.getUserByUsername(who);
      if (!u) return { output: `The user name could not be found.` };
      return {
        output: formatTable([
          {
            'User name': u.username,
            'Full Name': u.displayName,
            'Account active': u.status === 'active' ? 'Yes' : 'No',
            'Locked out': u.status === 'locked' ? 'Yes' : 'No',
            MFA: u.mfa,
          },
        ]),
      };
    }

    case 'nslookup': {
      const target = args[0] ?? HOST.domain;
      return {
        output: [
          `Server:  ${HOST.domainController.toLowerCase()}.${HOST.domain}`,
          `Address:  ${HOST.dns}`,
          '',
          `Name:    ${target}`,
          `Address:  ${HOST.ip}`,
        ].join('\n'),
      };
    }

    case 'ping': {
      const target = args[0];
      if (!target) return { output: 'Usage: ping <host>' };
      const lines = [`Pinging ${target} [${HOST.ip}] with 32 bytes of data:`];
      for (let i = 0; i < 4; i++) {
        lines.push(`Reply from ${HOST.ip}: bytes=32 time<1ms TTL=128`);
      }
      lines.push(
        '',
        `Ping statistics for ${HOST.ip}:`,
        '    Packets: Sent = 4, Received = 4, Lost = 0 (0% loss)',
      );
      return { output: lines.join('\n') };
    }

    default:
      return null;
  }
}

/** Names the help screen should advertise alongside the cmdlets. */
export const INTRINSIC_HELP: ReadonlyArray<[string, string]> = [
  ['dir / ls', 'List the current directory'],
  ['cd <path>', 'Change directory'],
  ['pwd', 'Print the current directory'],
  ['whoami', 'Show the signed-in operator'],
  ['hostname', 'Show the workstation name'],
  ['ipconfig', 'Show network configuration'],
  ['systeminfo', 'Show host and domain details'],
  ['net user [name]', 'List accounts, or show one'],
  ['nslookup <host>', 'Resolve a name against the domain DNS'],
  ['ping <host>', 'Test reachability'],
  ['ver / date / time', 'Version and clock'],
  ['echo <text>', 'Print text'],
  ['cls', 'Clear the screen'],
  ['exit', 'Close the terminal'],
];
