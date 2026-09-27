/**
 * vm/portfolio/lint.ts — the deterministic least-privilege checker.
 *
 * Same split as the AD series: rules decide what is objectively wrong, the
 * model explains. A local model reviewing an IAM policy will sometimes miss a
 * wildcard or invent one; these rules never do either. Their findings are handed
 * to the instructor as facts it must not contradict.
 *
 * The rules are deliberately conservative — each one matches something an
 * auditor would write up — and every finding quotes its line.
 */

export type Severity = 'Critical' | 'High' | 'Medium' | 'Low';

export interface Finding {
  rule: string;
  severity: Severity;
  /** SOC 2 / SOX control the finding maps to. */
  control: string;
  title: string;
  /** 1-based line number, 0 for whole-file findings. */
  line: number;
  evidence: string;
  /** A hint — never the fix. */
  hint: string;
}

interface LineRule {
  rule: string;
  severity: Severity;
  control: string;
  title: string;
  pattern: RegExp;
  hint: string;
  /** Skip lines that match this (e.g. values read from the environment). */
  unless?: RegExp;
  /** Only apply when the whole file matches this (context for noisy patterns). */
  fileMustMatch?: RegExp;
}

const ENV_REF = /\$env:|process\.env|os\.environ|getenv|\$\{\{?\s*secrets|Get-Secret|Read-Host|KeyVault|SecretManager|\$[A-Z_]{3,}\b(?!\s*=)/i;

const LINE_RULES: LineRule[] = [
  {
    rule: 'secret-plaintext-securestring', severity: 'High', control: 'SOC 2 CC6.1',
    title: 'Password written in plain text into a SecureString',
    pattern: /ConvertTo-SecureString\s+(-String\s+)?["'][^"'$]{4,}["']\s+-AsPlainText/i,
    hint: 'Where does this value live after the script is committed or logged? Look up how the script could receive it at run time instead.',
  },
  {
    rule: 'secret-literal', severity: 'High', control: 'SOC 2 CC6.1',
    title: 'Credential or token assigned as a literal',
    pattern: /\b(password|passwd|pwd|secret|client_?secret|api[_-]?key|access[_-]?key|token|ssws)\b\s*[:=]\s*["'][^"'\s$]{6,}["']/i,
    unless: ENV_REF,
    hint: 'A secret in source is a finding even in a lab. What would an auditor ask about who can read this repository?',
  },
  {
    rule: 'aws-access-key', severity: 'Critical', control: 'SOC 2 CC6.1',
    title: 'AWS access key ID in the file',
    pattern: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/,
    hint: 'Treat it as compromised. What is the rotation procedure, and what would CloudTrail show about its use?',
  },
  {
    rule: 'iam-wildcard-action', severity: 'High', control: 'SOC 2 CC6.3 / least privilege',
    title: 'Wildcard action in an IAM policy',
    pattern: /"Action"\s*:\s*(\[\s*)?"(\*|[a-z0-9-]+:\*)"/i,
    hint: 'List the exact API calls the task needs. Which of them does a read-only role actually require?',
  },
  {
    rule: 'iam-wildcard-resource', severity: 'Medium', control: 'SOC 2 CC6.3 / least privilege',
    title: 'Wildcard resource in an IAM policy',
    pattern: /"Resource"\s*:\s*(\[\s*)?"\*"/,
    hint: 'Can this be scoped to specific ARNs? Check which actions genuinely do not support resource-level permissions.',
  },
  {
    rule: 'iam-wildcard-principal', severity: 'Critical', control: 'SOC 2 CC6.1',
    title: 'Trust policy allows any principal',
    pattern: /"(AWS|Principal)"\s*:\s*"\*"/,
    hint: 'Who exactly should be able to assume this role? Name that principal, not the world.',
  },
  {
    rule: 'privileged-group-add', severity: 'High', control: 'SOX ITGC access / SOC 2 CC6.2',
    title: 'Adds members to a privileged group',
    pattern: /Add-(AD)?GroupMember[^\n]*(Domain Admins|Enterprise Admins|Schema Admins|Administrators|Account Operators)/i,
    hint: 'Is this standing access? Which project in this portfolio replaces standing admin membership, and what approval evidence exists?',
  },
  {
    rule: 'jwt-no-verify', severity: 'Critical', control: 'SOC 2 CC6.1',
    title: 'JWT accepted without signature verification',
    pattern: /verify_signature["']?\s*:\s*False|algorithms\s*=\s*\[\s*["']none["']|alg["']?\s*:\s*["']none["']|jwt\.decode\([^)]*verify\s*=\s*False/i,
    hint: 'What stops someone forging this token? Re-read which claims your library validates by default and which it skips here.',
  },
  {
    rule: 'jwt-decode-only', severity: 'Medium', control: 'SOC 2 CC6.1',
    title: 'Token decoded, not verified',
    pattern: /\bjwt\.decode\(|jwt_decode\(/,
    unless: /verify|jwks|getSigningKey/i,
    hint: 'Decoding reads a token; verifying proves it. Which function checks signature, issuer, audience and expiry?',
  },
  {
    rule: 'tls-validation-disabled', severity: 'High', control: 'SOC 2 CC6.7',
    title: 'Certificate validation disabled',
    pattern: /verify\s*=\s*False|rejectUnauthorized\s*:\s*false|-SkipCertificateCheck|ServerCertificateValidationCallback\s*=\s*\{\s*\$true|InsecureSkipVerify\s*:\s*true|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0/i,
    hint: 'What attack does certificate validation prevent? Find out why validation failed instead of switching it off.',
  },
  {
    rule: 'everyone-full', severity: 'High', control: 'SOC 2 CC6.3',
    title: 'Everyone / broad group granted full or change access',
    pattern: /(Everyone|Authenticated Users|Domain Users|BUILTIN\\Users)[^\n]*(FullControl|Full\b|Modify|Change|:\(F\)|:F\b)/i,
    hint: 'Who is inside that group? Grant to the role group that owns the data.',
  },
  {
    rule: 'weak-random', severity: 'Medium', control: 'SOC 2 CC6.1',
    title: 'Password generated with a non-cryptographic random source',
    pattern: /(Get-Random|random\.(choice|choices|randint|random)|Math\.random)/,
    fileMustMatch: /password|passwd|pwd|passphrase/i,
    hint: 'Is this generator suitable for secrets? Look up the cryptographically secure option in your language.',
  },
  {
    rule: 'pim-long-activation', severity: 'Medium', control: 'SOC 2 CC6.2 / zero standing privilege',
    title: 'Privileged activation longer than 2 hours',
    pattern: /"?(maximumDuration|maximumActivationDuration|duration)"?\s*[:=]\s*"?PT([3-9]|\d{2,})H/i,
    hint: 'The project caps activation at 2 hours. What is the risk of each extra hour of standing privilege?',
  },
  {
    rule: 'pim-no-expiry', severity: 'High', control: 'SOC 2 CC6.2 / zero standing privilege',
    title: 'Privileged assignment without expiration',
    pattern: /"?isExpirationRequired"?\s*[:=]\s*false|noExpiration|"type"\s*:\s*"noExpiration"/i,
    hint: 'Zero standing privileges means every assignment ends. Which setting forces an end date?',
  },
  {
    rule: 'execution-policy', severity: 'Low', control: 'SOC 2 CC7.1',
    title: 'Machine-wide execution policy weakened',
    pattern: /Set-ExecutionPolicy\s+(Unrestricted|Bypass)(?![^\n]*-Scope\s+Process)/i,
    hint: 'Does this need to be machine-wide and permanent? Consider the narrowest scope.',
  },
];

/** Whole-file checks that need more than one line. */
function fileRules(text: string): Finding[] {
  const out: Finding[] = [];
  const lower = text.toLowerCase();

  if (/sts:assumerole/.test(lower)) {
    if (!/sts:externalid/.test(lower)) {
      out.push({ rule: 'assume-no-externalid', severity: 'High', control: 'SOC 2 CC6.1', title: 'Cross-account trust without an ExternalId condition',
        line: 0, evidence: 'sts:AssumeRole with no sts:ExternalId condition', hint: 'What problem does ExternalId solve for cross-account roles? Which condition key checks it?' });
    }
    if (!/aws:multifactorauthpresent/.test(lower)) {
      out.push({ rule: 'assume-no-mfa', severity: 'High', control: 'SOC 2 CC6.1', title: 'Role assumption does not require MFA',
        line: 0, evidence: 'sts:AssumeRole with no aws:MultiFactorAuthPresent condition', hint: 'Which global condition key proves the caller used MFA, and which operator should test it?' });
    }
  }

  const destructive = /\b(Disable-ADAccount|Remove-ADGroupMember|Set-ADAccountPassword|Remove-ADUser|Move-ADObject|Revoke-MgUserSignInSession|Remove-MgGroupMemberByRef)\b/;
  if (destructive.test(text)) {
    if (!/SupportsShouldProcess|-WhatIf|dry.?run|\$DryRun|--dry-run/i.test(text)) {
      out.push({ rule: 'no-dry-run', severity: 'Medium', control: 'SOX ITGC change management', title: 'Destructive identity changes with no dry-run or -WhatIf',
        line: 0, evidence: 'Account changes without SupportsShouldProcess / -WhatIf / dry-run switch', hint: 'How would you show a reviewer exactly what will change before it changes?' });
    }
    if (!/Start-Transcript|Out-File|Add-Content|Export-Csv|Write-EventLog|logging\.|logger\.|Write-Log|console\.log|\blog\(/i.test(text)) {
      out.push({ rule: 'no-audit-log', severity: 'High', control: 'SOC 2 CC7.2 / SOX evidence', title: 'Identity changes are not logged',
        line: 0, evidence: 'No log/transcript/CSV output around account changes', hint: 'After this runs, what evidence would you hand an auditor? Where is who/what/when recorded?' });
    }
  }
  return out;
}

/** Run every rule. Deterministic: same input, same findings. */
export function lintSubmission(text: string): Finding[] {
  const findings: Finding[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const r of LINE_RULES) {
      if (!r.pattern.test(line)) continue;
      if (r.unless?.test(line)) continue;
      if (r.fileMustMatch && !r.fileMustMatch.test(text)) continue;
      findings.push({
        rule: r.rule, severity: r.severity, control: r.control, title: r.title,
        line: i + 1, evidence: line.trim().slice(0, 160), hint: r.hint,
      });
    }
  });
  findings.push(...fileRules(text));
  const order: Record<Severity, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity] || a.line - b.line);
}
