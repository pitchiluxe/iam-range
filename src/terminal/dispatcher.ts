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
import { FS, INTRINSIC_HELP, runIntrinsic } from './shellIntrinsics';

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
  // Read from the filesystem rather than repeated here: this said
  // C:\Users\iam.admin long after that account stopped existing, so every new
  // shell opened in a directory that was not on the disk.
  return { cwd: { path: FS.getCwd() } };
}

/**
 * Filters a pipeline can end in.
 *
 * Not a general pipeline — objects do not flow, text does. That is an honest
 * subset: `dir | findstr evidence` is what people actually type, and
 * implementing enough of the object pipeline to be convincing but not enough
 * to be correct would be worse than saying plainly that this filters text.
 */
function applyFilter(text: string, filter: string): string {
  const { cmdlet, positional, args } = tokenize(filter);
  const name = cmdlet.toLowerCase();
  const needle = (positional[0] ?? args['Pattern'] ?? args['pattern'] ?? '').toLowerCase();
  const lines = text.split('\n');

  switch (name) {
    case 'findstr':
    case 'find':
    case 'select-string':
    case 'where-object':
      if (!needle) return text;
      return lines.filter((l) => l.toLowerCase().includes(needle)).join('\n');

    case 'sort':
    case 'sort-object':
      return [...lines].sort((a, b) => a.localeCompare(b)).join('\n');

    case 'more':
      return lines.slice(0, 40).join('\n') + (lines.length > 40 ? '\n-- More --' : '');

    case 'measure-object':
    case 'count':
      return `Lines: ${lines.length}`;

    case 'select-object':
    case 'select': {
      const first = Number(args['First'] ?? args['first'] ?? positional[0] ?? 10);
      return lines.slice(0, Number.isFinite(first) ? first : 10).join('\n');
    }

    default:
      return `${text}\n\nThe pipeline does not support '${cmdlet}'. Try findstr, sort, select or more.`;
  }
}

/** Split a line on `|` that is not inside quotes. */
function splitPipeline(line: string): string[] {
  const parts: string[] = [];
  let buf = '';
  let quote: string | null = null;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null;
      buf += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === '|') {
      parts.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  parts.push(buf);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/**
 * Split on `;` and `&&`, keeping the separator so `&&` can stop on failure.
 *
 * cmd and PowerShell both take several commands on a line, and somebody
 * building a domain types `mkdir a; cd a` without thinking about it.
 */
function splitStatements(line: string): { text: string; stopOnFailure: boolean }[] {
  const out: { text: string; stopOnFailure: boolean }[] = [];
  let buf = '';
  let quote: string | null = null;
  let stopOnFailure = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      buf += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === ';') {
      out.push({ text: buf.trim(), stopOnFailure });
      buf = '';
      stopOnFailure = false;
      continue;
    }
    if (ch === '&' && line[i + 1] === '&') {
      out.push({ text: buf.trim(), stopOnFailure });
      buf = '';
      stopOnFailure = true;
      i += 1;
      continue;
    }
    buf += ch;
  }
  out.push({ text: buf.trim(), stopOnFailure });
  return out.filter((s) => s.text.length > 0);
}

/**
 * Run a whole command line: several statements, each possibly a pipeline.
 *
 * `dispatchOne` below is the single-command path everything eventually reaches.
 */
export function dispatch(
  line: string,
  ctx: CapabilityContext,
  shell: ShellState = createShellState(),
): DispatchResult {
  const statements = splitStatements(line);
  if (statements.length === 0) return ok('');

  const outputs: string[] = [];
  let lastOk = true;
  let control: DispatchResult['control'];
  // The caller refreshes other windows when a capability mutated state, so a
  // chained line has to report that it did — dropping it here would leave the
  // directory changed and Active Directory showing the old picture.
  let ranCapabilityId: string | undefined;

  for (const statement of statements) {
    // `a && b` runs b only if a succeeded, as it does in every shell.
    if (statement.stopOnFailure && !lastOk) break;

    const stages = splitPipeline(statement.text);
    const head = stages.shift();
    if (!head) continue;

    const result = dispatchOne(head, ctx, shell);
    lastOk = result.ok;
    if (result.control) control = result.control;
    if (result.ranCapabilityId) ranCapabilityId = result.ranCapabilityId;

    let text = result.output;
    for (const stage of stages) text = applyFilter(text, stage);
    if (text) outputs.push(text);
  }

  return {
    ok: lastOk,
    output: outputs.join('\n'),
    ...(control ? { control } : {}),
    ...(ranCapabilityId ? { ranCapabilityId } : {}),
  };
}

function dispatchOne(
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
  const intrinsic = runIntrinsic(name, positional, ctx, shell.cwd, args);
  if (intrinsic) {
    // A built-in that failed has to say so, or `&&` has nothing to test.
    if (intrinsic.ok === false) return fail(intrinsic.output);
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
