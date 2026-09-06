/**
 * terminal/script.ts — run a multi-line PowerShell script against the IAM
 * capability registry.
 *
 * Supports the shape a real bulk-provisioning script has:
 *
 *   # Onboard the Q3 finance intake
 *   $names = @('ana.silva','ben.okafor')
 *   foreach ($n in $names) {
 *     New-ADUser -SamAccountName $n -Name $n -Department Finance
 *     Add-ADGroupMember -Identity $n -Group grp-finance-payroll
 *   }
 *
 * Deliberately a subset — string arrays, foreach, comments, `$var`
 * substitution. No expressions, pipelines, conditionals or functions. A
 * half-built language teaches worse than an honestly limited one, and this is
 * enough to automate the work the tickets actually ask for.
 *
 * Every expanded line goes through the same dispatcher a typed command does, so
 * a script fires the identical service calls, audit events and step validators
 * as doing the work by hand in the console.
 */
import type { CapabilityContext } from '@/services';
import { dispatch, createShellState, type DispatchResult } from './dispatcher';

/** `$name = @('a', "b", c)` — the whole literal on one line. */
const ARRAY_ASSIGN = /^\$([A-Za-z_]\w*)\s*=\s*@\((.*)\)\s*$/;
/** `$name = @(` — the literal continues on following lines, which is how a
 *  human actually writes a list of twenty names. */
const ARRAY_ASSIGN_OPEN = /^\$([A-Za-z_]\w*)\s*=\s*@\(\s*$/;
/** `foreach ($x in $list) {` */
const FOREACH_OPEN = /^foreach\s*\(\s*\$([A-Za-z_]\w*)\s+in\s+\$([A-Za-z_]\w*)\s*\)\s*\{?\s*$/i;

/** Split an @(...) body into entries, tolerating single, double or no quotes. */
function parseArrayBody(body: string): string[] {
  return (
    body
      .split(',')
      .map((s) =>
        s
          .trim()
          .replace(/^['"]|['"]$/g, '')
          .trim(),
      )
      // A trailing comma on the last line of a multi-line list yields an empty
      // entry — drop it rather than provisioning a user with a blank name.
      .filter((s) => s.length > 0)
  );
}

/**
 * Replace `$var` with its value.
 *
 * An unknown variable is left as written rather than replaced with nothing:
 * silently emptying it would turn a typo into a subtly wrong command that still
 * runs, which is the worst outcome for a learner.
 */
function substitute(line: string, vars: Map<string, string>): string {
  return line.replace(/\$([A-Za-z_]\w*)/g, (whole, name: string) => vars.get(name) ?? whole);
}

/**
 * Flatten a script into the cmdlet lines it will run.
 *
 * @throws if a foreach is unterminated or iterates an undeclared variable —
 *   better to refuse the whole script than to run half of a bulk operation.
 */
export function parseScript(source: string): string[] {
  const lines = source.split('\n').map((l) => l.trim());
  const arrays = new Map<string, string[]>();
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line === '' || line.startsWith('#')) continue;

    const assign = ARRAY_ASSIGN.exec(line);
    if (assign) {
      arrays.set(assign[1]!, parseArrayBody(assign[2]!));
      continue;
    }

    // Multi-line form: gather until the closing paren.
    const openAssign = ARRAY_ASSIGN_OPEN.exec(line);
    if (openAssign) {
      const parts: string[] = [];
      let j = i + 1;
      let closed = false;
      for (; j < lines.length; j++) {
        const entry = lines[j]!;
        if (entry.startsWith(')')) {
          closed = true;
          break;
        }
        if (entry !== '' && !entry.startsWith('#')) parts.push(entry);
      }
      if (!closed) {
        throw new Error(
          `$${openAssign[1]}: missing closing ")" on the list — the script was not run.`,
        );
      }
      arrays.set(openAssign[1]!, parseArrayBody(parts.join(',')));
      i = j;
      continue;
    }

    const loop = FOREACH_OPEN.exec(line);
    if (loop) {
      const [, itemVar, listVar] = loop as unknown as [string, string, string];
      const list = arrays.get(listVar);
      if (!list) {
        throw new Error(
          `foreach: '$${listVar}' is not defined. Declare it first, e.g. $${listVar} = @('a','b').`,
        );
      }

      // Collect the body up to the matching closing brace.
      const body: string[] = [];
      let depth = 1;
      let j = i + 1;
      for (; j < lines.length; j++) {
        const bodyLine = lines[j]!;
        if (bodyLine === '}') {
          depth--;
          if (depth === 0) break;
          continue;
        }
        if (bodyLine.endsWith('{')) depth++;
        if (bodyLine !== '' && !bodyLine.startsWith('#')) body.push(bodyLine);
      }
      if (depth !== 0) {
        throw new Error('foreach: missing closing "}" — the script was not run.');
      }

      for (const value of list) {
        const scope = new Map<string, string>([[itemVar, value]]);
        for (const bodyLine of body) out.push(substitute(bodyLine, scope));
      }
      i = j;
      continue;
    }

    // A plain cmdlet line. Only scalar substitution applies here; arrays have
    // no meaning outside a foreach.
    out.push(substitute(line, new Map()));
  }

  return out;
}

export interface ScriptRunResult {
  ok: boolean;
  /** Set when the script could not be parsed; nothing was run. */
  parseError?: string;
  results: Array<{ command: string; result: DispatchResult }>;
  succeeded: number;
  failed: number;
}

/**
 * Parse and run a script.
 *
 * A failing line does not stop the batch — a duplicate username halfway
 * through a 20-user intake must not abandon the remaining 10. The result
 * reports which lines failed so the learner can fix and re-run just those.
 */
export function runScript(source: string, ctx: CapabilityContext): ScriptRunResult {
  let commands: string[];
  try {
    commands = parseScript(source);
  } catch (e) {
    return {
      ok: false,
      parseError: e instanceof Error ? e.message : String(e),
      results: [],
      succeeded: 0,
      failed: 0,
    };
  }

  // One shell state for the whole run, so `cd` and friends persist across lines.
  const shell = createShellState();
  const results = commands.map((command) => ({ command, result: dispatch(command, ctx, shell) }));

  const failed = results.filter((r) => !r.result.ok).length;
  return {
    ok: failed === 0,
    results,
    succeeded: results.length - failed,
    failed,
  };
}
