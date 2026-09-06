/**
 * terminal/dispatcher.ts — turn a typed line into a capability invocation.
 *
 * The terminal owns no actions of its own: every cmdlet is a capability from
 * the registry, so a command run here fires exactly the same service calls,
 * audit events and lab-step validators as the equivalent console click. That
 * is the point — the learner can resolve a ticket by clicking or by typing,
 * and the lab validates either way.
 */
import { CAPABILITY_BY_CMDLET, CAPABILITIES, type CapabilityContext } from '@/services';
import { tokenize } from './tokenizer';
import { formatTable } from './format';
import { INTRINSIC_HELP, runIntrinsic } from './shellIntrinsics';

export interface DispatchResult {
  ok: boolean;
  output: string;
  /** Intrinsics the shell itself handles rather than a capability. */
  control?: 'clear' | 'exit';
  /** Set when a capability actually mutated state, so the caller can record
   *  evidence and refresh other windows. */
  ranCapabilityId?: string;
}

const ok = (output: string, extra: Partial<DispatchResult> = {}): DispatchResult => ({
  ok: true,
  output,
  ...extra,
});
const fail = (output: string): DispatchResult => ({ ok: false, output });

function helpForAll(): string {
  const rows = CAPABILITIES.map((c) => ({ Cmdlet: c.cmdlet, Synopsis: c.synopsis }));
  return [
    'IAM cmdlets:',
    '',
    formatTable(rows),
    '',
    'Shell commands:',
    '',
    formatTable(INTRINSIC_HELP.map(([Command, Description]) => ({ Command, Description }))),
    '',
    'Get-Help <cmdlet>   Show parameters for one IAM cmdlet',
  ].join('\n');
}

function helpForOne(cmdletName: string): DispatchResult {
  const cap = CAPABILITY_BY_CMDLET[cmdletName.toLowerCase()];
  if (!cap) return fail(`Get-Help: no command named '${cmdletName}'.`);

  const lines = [
    `NAME`,
    `    ${cap.cmdlet}`,
    ``,
    `SYNOPSIS`,
    `    ${cap.synopsis}`,
    ``,
    `PARAMETERS`,
  ];
  if (cap.params.length === 0) {
    lines.push('    (none)');
  } else {
    for (const p of cap.params) {
      const opts = p.options ? ` {${p.options.join(' | ')}}` : '';
      lines.push(`    -${p.name}${opts}${p.required ? '  (required)' : ''}`);
      lines.push(`        ${p.label}`);
    }
  }
  return ok(lines.join('\n'));
}

/** Shell state the caller owns, so `cd` persists between commands. */
export interface ShellState {
  cwd: { path: string };
}

export function createShellState(): ShellState {
  return { cwd: { path: 'C:\\Users\\iam.admin' } };
}

export function dispatch(
  line: string,
  ctx: CapabilityContext,
  shell: ShellState = createShellState(),
): DispatchResult {
  const { cmdlet, args, positional } = tokenize(line);
  if (!cmdlet) return ok('');

  const name = cmdlet.toLowerCase();

  // Windows/PowerShell built-ins are tried first: they are shell commands, not
  // IAM capabilities, and a terminal that rejects `dir` or `whoami` reads as
  // broken even though every cmdlet works. cls/exit live there too.
  const intrinsic = runIntrinsic(name, positional, ctx, shell.cwd);
  if (intrinsic) {
    return intrinsic.control
      ? ok(intrinsic.output, { control: intrinsic.control })
      : ok(intrinsic.output);
  }

  if (name === 'get-help' || name === 'help') {
    const target = positional[0] ?? args.Name;
    return target ? helpForOne(target) : ok(helpForAll());
  }

  const cap = CAPABILITY_BY_CMDLET[name];
  if (!cap) {
    return fail(
      `The term '${cmdlet}' is not recognized as the name of a cmdlet. ` +
        `Run Get-Help to list available commands.`,
    );
  }

  // Check required parameters before running, so the learner is told which one
  // is missing instead of getting a generic failure from inside the capability.
  const missing = cap.params.filter((p) => p.required && !args[p.name]?.trim());
  if (missing.length > 0) {
    return fail(
      `${cap.cmdlet}: missing required parameter -${missing[0]!.name} (${missing[0]!.label}).`,
    );
  }

  const res = cap.run(ctx, args);
  if (!res.ok) return fail(res.error);

  const table = res.rows && res.rows.length > 0 ? formatTable(res.rows) : '';
  const output = table ? `${table}\n\n${res.message}` : res.message;
  return ok(output, cap.readOnly ? {} : { ranCapabilityId: cap.id });
}
