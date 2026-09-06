/**
 * terminal/tokenizer.ts — split a PowerShell-style command line into a cmdlet
 * and its named parameters.
 *
 * Deliberately small: cmdlet plus `-Param value` pairs, quoted values, and bare
 * switches. No pipelines, variables, or expressions — the terminal teaches AD
 * cmdlet vocabulary, not PowerShell as a language, and a half-implemented
 * language is worse than an honestly limited one.
 */

export interface ParsedCommand {
  /** As typed — the dispatcher lowercases for lookup. */
  cmdlet: string;
  /** Parameter name (as typed, without the dash) → value. Switches map to 'true'. */
  args: Record<string, string>;
  /** Values given before any -Param, e.g. `Get-Help Set-ADAccountPassword`. */
  positional: string[];
}

/** Split on whitespace, keeping "double" and 'single' quoted runs intact. */
function splitRespectingQuotes(line: string): string[] {
  const out: string[] = [];
  let buf = '';
  let quote: '"' | "'" | null = null;

  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null;
      else buf += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (buf) out.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf) out.push(buf);
  return out;
}

const isParamName = (t: string): boolean => /^-[A-Za-z]/.test(t);

export function tokenize(line: string): ParsedCommand {
  const parts = splitRespectingQuotes(line.trim());
  if (parts.length === 0) return { cmdlet: '', args: {}, positional: [] };

  const cmdlet = parts[0]!;
  const args: Record<string, string> = {};
  const positional: string[] = [];

  for (let i = 1; i < parts.length; i++) {
    const t = parts[i]!;
    if (!isParamName(t)) {
      positional.push(t);
      continue;
    }
    const name = t.slice(1);
    const next = parts[i + 1];
    // A parameter with no value, or followed by another parameter, is a
    // switch — `-ChangePasswordAtLogon` means true.
    if (next === undefined || isParamName(next)) {
      args[name] = 'true';
    } else {
      args[name] = next;
      i++;
    }
  }

  return { cmdlet, args, positional };
}
