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
 * simulated corporate host rather than the machine the app is running on —
 * this is a lab, and leaking the real host's details would be both wrong and
 * a privacy problem.
 */
import { CAPABILITIES, type CapabilityContext } from '@/services';
import { formatTable } from './format';
import { MockFileSystem } from '@/services';

import { VM_ACCOUNT, VM_HOST } from '@/config/vmHost';

/** The simulated workstation. Shared with the Settings app via config/vmHost.ts
 *  so the two cannot describe the same machine differently. */
const HOST = VM_HOST;

/**
 * What `where` can find.
 *
 * Built from the help table and the capability registry rather than listed
 * again here, so a cmdlet added to the registry is findable without anyone
 * remembering to update a second list.
 */
function knownCommands(): string[] {
  const shell = INTRINSIC_HELP.map(([command]) => command.split(' ')[0]!.split(' / ')[0]!);
  const cmdlets = CAPABILITIES.map((c) => c.cmdlet);
  return [...new Set([...shell, ...cmdlets])].sort();
}

/** `pushd` / `popd`, which people use to go somewhere and come back. */
const dirStack: string[] = [];

/** What `tasklist` reports. Plausible for a managed workstation, and fixed so
 *  the same command twice does not invent different numbers. */
const PROCESSES: ReadonlyArray<{ name: string; pid: number; mem: number }> = [
  { name: 'System', pid: 4, mem: 148 },
  { name: 'lsass.exe', pid: 812, mem: 14892 },
  { name: 'services.exe', pid: 796, mem: 9204 },
  { name: 'explorer.exe', pid: 3244, mem: 62140 },
  { name: 'powershell.exe', pid: 5108, mem: 78320 },
  { name: 'mmc.exe', pid: 6420, mem: 54188 },
];

/**
 * The workstation's disk.
 *
 * A module singleton because the shell and File Explorer must be looking at
 * the same tree — they used to keep separate fictions and disagree about which
 * folders existed.
 */
export const FS = new MockFileSystem();

export interface IntrinsicResult {
  output: string;
  control?: 'clear' | 'exit';
  /**
   * Whether the command succeeded. Absent means yes.
   *
   * Everything used to return text alone and the dispatcher called all of it
   * success, so `cd nowhere && mkdir x` still created x — the `&&` had nothing
   * to test.
   */
  ok?: boolean;
}

/** `dir` output, laid out the way cmd.exe lays it out. */
function dirListing(path: string): string {
  const entries = FS.list(path);
  if (!entries) return `Cannot find path '${path}' because it does not exist.`;

  const lines = [` Directory of ${path}`, ''];
  let files = 0;
  let dirs = 0;
  let bytes = 0;

  for (const entry of entries) {
    const stamp = new Date(entry.modified).toLocaleString();
    if (entry.kind === 'dir') {
      dirs += 1;
      lines.push(`${stamp}    <DIR>          ${entry.name}`);
    } else {
      const size = (entry.content ?? '').length;
      files += 1;
      bytes += size;
      lines.push(`${stamp}    ${String(size).padStart(12)} ${entry.name}`);
    }
  }

  if (entries.length === 0) lines.push('File Not Found');
  lines.push('', `${String(files).padStart(15)} File(s) ${bytes} bytes`);
  lines.push(`${String(dirs).padStart(15)} Dir(s)`);
  return lines.join('\n');
}

/** `tree`, drawn with box characters as the real one is. */
function treeListing(path: string, prefix = '', depth = 0): string {
  if (depth > 4) return '';
  const entries = FS.list(path);
  if (!entries) return '';
  const lines: string[] = [];
  entries.forEach((entry, i) => {
    const last = i === entries.length - 1;
    lines.push(`${prefix}${last ? '\u2514\u2500\u2500' : '\u251c\u2500\u2500'} ${entry.name}`);
    if (entry.kind === 'dir') {
      const child = treeListing(
        `${path.replace(/\\$/, '')}\\${entry.name}`,
        `${prefix}${last ? '    ' : '\u2502   '}`,
        depth + 1,
      );
      if (child) lines.push(child);
    }
  });
  return lines.join('\n');
}

/** Strip the quotes people put around paths with spaces in them. */
function unquote(value: string): string {
  return value.replace(/^["']|["']$/g, '');
}

/** Join the remaining tokens, so `mkdir My Reports` works unquoted too. */
function pathArg(args: string[]): string {
  return unquote(args.filter((a) => !a.startsWith('-')).join(' ')).trim();
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
 * @param switches Named arguments the tokenizer pulled out of the line, so a
 *   built-in can read `-Recurse`. Without them `rm -Recurse` reached the
 *   filesystem with recurse false and refused forever.
 */
export function runIntrinsic(
  name: string,
  args: string[],
  ctx: CapabilityContext | null,
  cwd: { path: string },
  switches: Record<string, string> = {},
): IntrinsicResult | null {
  /** Whether a switch was given, under any of its usual spellings. */
  const flag = (...names: string[]): boolean =>
    names.some((n) =>
      Object.keys(switches).some((key) => key.toLowerCase() === n.toLowerCase()),
    ) || args.some((a) => names.some((n) => a.toLowerCase() === `-${n.toLowerCase()}`));

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
    case 'get-childitem': {
      const target = pathArg(args);
      return { output: dirListing(target ? FS.resolvePath(target) : FS.getCwd()) };
    }

    case 'tree': {
      const path = pathArg(args) ? FS.resolvePath(pathArg(args)) : FS.getCwd();
      const body = treeListing(path);
      return { output: [path, body || '  (empty)'].join('\n') };
    }

    case 'mkdir':
    case 'md':
    case 'new-item': {
      const target = pathArg(args);
      if (!target) return { output: 'mkdir: a directory name is required.', ok: false };
      // mkdir always makes a directory. New-Item makes whichever -ItemType
      // says, defaulting to a directory here because that is what it is
      // reached for in this lab.
      const wantsFile =
        name === 'new-item' &&
        (args.some((a) => /^file$/i.test(a)) ||
          (switches['ItemType'] ?? switches['itemtype'] ?? '').toLowerCase() === 'file');
      const res = wantsFile ? FS.writeFile(target, '') : FS.makeDir(target);
      return { output: res.ok ? (res.message ?? '') : res.error, ok: res.ok };
    }

    case 'rmdir':
    case 'rd':
    case 'del':
    case 'erase':
    case 'rm':
    case 'remove-item': {
      const target = pathArg(args);
      if (!target) return { output: 'A path is required.', ok: false };
      const recurse = flag('recurse', 'r', 's', 'force');
      const res = FS.remove(target, recurse);
      return { output: res.ok ? (res.message ?? '') : res.error, ok: res.ok };
    }

    case 'type':
    case 'cat':
    case 'get-content': {
      const target = pathArg(args);
      if (!target) return { output: 'A file name is required.', ok: false };
      const content = FS.readFile(target);
      if (content === null) {
        return { output: `Cannot find the file '${target}'.`, ok: false };
      }
      return { output: content };
    }

    case 'copy':
    case 'cp':
    case 'copy-item': {
      const paths = args.filter((a) => !a.startsWith('-')).map(unquote);
      if (paths.length < 2) return { output: 'Usage: copy <source> <destination>', ok: false };
      const res = FS.copy(paths[0]!, paths[1]!);
      return { output: res.ok ? (res.message ?? '') : res.error, ok: res.ok };
    }

    case 'move':
    case 'mv':
    case 'move-item':
    case 'ren':
    case 'rename':
    case 'rename-item': {
      const paths = args.filter((a) => !a.startsWith('-')).map(unquote);
      if (paths.length < 2) return { output: 'Usage: move <source> <destination>', ok: false };
      const res = FS.move(paths[0]!, paths[1]!);
      return { output: res.ok ? (res.message ?? '') : res.error, ok: res.ok };
    }

    case 'cd':
    case 'chdir':
    case 'set-location': {
      const target = pathArg(args);
      if (!target) return { output: FS.getCwd() };
      const res = FS.setCwd(target);
      if (!res.ok) return { output: `cd : ${res.error}`, ok: false };
      // The caller owns the prompt string, so keep it in step.
      cwd.path = FS.getCwd();
      return { output: '' };
    }

    case 'pushd': {
      const target = pathArg(args);
      dirStack.push(FS.getCwd());
      if (!target) return { output: FS.getCwd() };
      const res = FS.setCwd(target);
      if (!res.ok) {
        dirStack.pop();
        return { output: `pushd : ${res.error}`, ok: false };
      }
      cwd.path = FS.getCwd();
      return { output: '' };
    }

    case 'popd': {
      const previous = dirStack.pop();
      if (!previous) return { output: 'popd : the directory stack is empty.', ok: false };
      FS.setCwd(previous);
      cwd.path = FS.getCwd();
      return { output: '' };
    }

    case 'where':
    case 'which':
    case 'get-command': {
      const needle = pathArg(args).toLowerCase();
      if (!needle) return { output: 'Usage: where <command>' };
      const known = knownCommands().filter((c) => c.toLowerCase().includes(needle));
      return {
        output:
          known.length === 0
            ? `INFO: Could not find files for the given pattern(s).`
            : known.join('\n'),
      };
    }

    case 'set':
    case 'get-childitem-env': {
      // The environment a domain-joined session actually carries. Values come
      // from config, so they cannot disagree with the rest of the workstation.
      return {
        output: [
          `COMPUTERNAME=${HOST.name}`,
          `USERDOMAIN=${HOST.netbiosDomain}`,
          `USERNAME=${HOST.user}`,
          `USERDNSDOMAIN=${HOST.domain.toUpperCase()}`,
          `LOGONSERVER=\\\\${HOST.domainController}`,
          `HOMEDRIVE=C:`,
          `HOMEPATH=\\Users\\${HOST.user}`,
          `OS=Windows_NT`,
          `PROCESSOR_ARCHITECTURE=AMD64`,
        ].join('\n'),
      };
    }

    case 'tasklist':
    case 'get-process':
      return {
        output: formatTable(
          PROCESSES.map((p) => ({
            'Image Name': p.name,
            PID: String(p.pid),
            'Session Name': 'Console',
            'Mem Usage': `${p.mem.toLocaleString()} K`,
          })),
        ),
      };

    case 'taskkill':
    case 'stop-process': {
      const target = pathArg(args) || args.join(' ');
      // Refused rather than faked: nothing here has a process to end, and a
      // command that reports success without doing anything is the exact
      // dishonesty this project keeps removing.
      return {
        output: target
          ? `taskkill : access denied. Processes on this workstation are managed by the system.`
          : 'Usage: taskkill /IM <image name>',
        ok: false,
      };
    }

    case 'title':
      return { output: '' };

    case 'attrib': {
      const target = pathArg(args);
      const node = target ? FS.node(FS.resolvePath(target)) : undefined;
      if (target && !node) return { output: `File not found - ${target}`, ok: false };
      const entries = target ? [node!] : (FS.list() ?? []);
      return {
        output: entries
          .map((e) => `${e.readonly ? 'R' : ' '}  ${e.kind === 'dir' ? 'D' : ' '}    ${e.name}`)
          .join('\n'),
      };
    }

    case 'history':
    case 'get-history':
      // The window owns the scrollback and the history list; the intrinsic
      // cannot see them, so it says so rather than printing an empty list.
      return { output: 'Use the up and down arrow keys to walk back through this session.' };

    case 'pwd':
    case 'get-location':
      return { output: FS.getCwd() };

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
    case 'write-output': {
      // `echo text > file` writes; without the redirect it just prints.
      const redirect = args.findIndex((a) => a === '>' || a === '>>');
      if (redirect !== -1) {
        const target = unquote(args.slice(redirect + 1).join(' ')).trim();
        const text = unquote(args.slice(0, redirect).join(' '));
        if (!target) return { output: 'A file name is required after >.', ok: false };
        const existing = args[redirect] === '>>' ? (FS.readFile(target) ?? '') : '';
        const body = existing ? `${existing}\n${text}` : text;
        const res = FS.writeFile(target, body);
        return { output: res.ok ? '' : res.error, ok: res.ok };
      }
      return { output: unquote(args.join(' ')) };
    }

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
  ['dir / ls', 'List a directory'],
  ['cd <path>', 'Change directory — accepts .., relative and C:\\ paths'],
  ['pwd', 'Print the current directory'],
  ['tree', 'Show the directory tree'],
  ['mkdir <name>', 'Create a directory'],
  ['del / rm <path>', 'Delete a file, or a directory with -Recurse'],
  ['type <file>', 'Print a file'],
  ['copy <a> <b>', 'Copy a file or directory'],
  ['move / ren <a> <b>', 'Move or rename'],
  ['echo <text> > <file>', 'Write a file (>> appends)'],
  ['pushd / popd', 'Go somewhere and come back'],
  ['where <name>', 'Find a command'],
  ['set', 'Show the session environment'],
  ['tasklist', 'List running processes'],
  ['attrib [path]', 'Show file attributes'],
  ['a ; b   a && b', 'Run several commands on one line'],
  ['<cmd> | findstr <text>', 'Filter output — also sort, select, more'],
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
