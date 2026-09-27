/**
 * tests/portfolio.test.ts — the IAM Portfolio: shared config, deterministic
 * checker, instructor prompt, clear chat, and Lab 12 (enterprise organization).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PORTFOLIO, SYSTEM_PROMPT, projectById } from '@/vm/portfolio/config';
import { lintSubmission } from '@/vm/portfolio/lint';
import {
  askPortfolioInstructor,
  buildPortfolioMessages,
  clearProjectConversation,
  newProjectSession,
  portfolioStatus,
} from '@/vm/portfolio/instructor';
import { clearConversation, newSession } from '@/vm/adlab/instructor';
import { labById, startingState, applySolution } from '@/vm/adlab/labs';
import { runCommand } from '@/vm/adlab/commands';
import { validate } from '@/vm/adlab/validation';

const offlineFetch = (async () => {
  throw new Error('ECONNREFUSED');
}) as unknown as typeof fetch;

describe('portfolio configuration', () => {
  it('has the ten projects in three phases with the required folders', () => {
    expect(PORTFOLIO.projects.map((p) => p.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(PORTFOLIO.projects.map((p) => p.folder)).toEqual([
      '01-JML-Pipeline', '02-RBAC-Matrix', '03-Access-Reviews', '04-Stale-Accounts', '05-Enterprise-SSO',
      '06-Conditional-Access', '07-OIDC-AuthPortal', '08-JIT-Privilege-Escalation', '09-Cross-Account-AWS', '10-SIEM-LogAuditing',
    ]);
    expect(new Set(PORTFOLIO.projects.map((p) => p.phase))).toEqual(new Set(['iga', 'am', 'pam']));
  });

  it('the system prompt demands least privilege, SOX/SOC 2 auditing and hints before answers', () => {
    expect(SYSTEM_PROMPT).toMatch(/Principle of Least Privilege/);
    expect(SYSTEM_PROMPT).toMatch(/SOX and SOC 2/);
    expect(SYSTEM_PROMPT).toMatch(/Never give the direct answer/);
    expect(SYSTEM_PROMPT).toMatch(/Never mark a project complete/);
  });

  it('the verification message is exactly the one required', () => {
    expect(PORTFOLIO.verification.successMessage).toBe('OLLAMA LOCAL INSTANCE VERIFIED: Training Instructor Integrated.');
  });

  it('the workspace scripts build every project folder from the same config', () => {
    const sh = readFileSync(join('omari-lab', '11-IAM-PORTFOLIO', 'new-iam-portfolio-workspace.sh'), 'utf8');
    for (const p of PORTFOLIO.projects) expect(sh).toContain(p.folder);
    expect(sh).toContain('00-Organization-Setup');
    expect(sh).toContain('.ollama-instructor');
  });
});

describe('deterministic least-privilege checker', () => {
  const rules = (text: string) => lintSubmission(text).map((f) => f.rule);

  it('flags wildcard IAM actions, resources and principals', () => {
    const policy = '{\n "Effect": "Allow",\n "Action": "s3:*",\n "Resource": "*",\n "Principal": { "AWS": "*" }\n}';
    expect(rules(policy)).toEqual(expect.arrayContaining(['iam-wildcard-action', 'iam-wildcard-resource', 'iam-wildcard-principal']));
  });

  it('requires ExternalId and MFA on a cross-account trust (project 9)', () => {
    const trust = '{"Effect":"Allow","Principal":{"AWS":"arn:aws:iam::111122223333:user/dev"},"Action":"sts:AssumeRole"}';
    expect(rules(trust)).toEqual(expect.arrayContaining(['assume-no-externalid', 'assume-no-mfa']));
    const good = trust.replace('"Action":"sts:AssumeRole"', '"Action":"sts:AssumeRole","Condition":{"StringEquals":{"sts:ExternalId":"x"},"Bool":{"aws:MultiFactorAuthPresent":"true"}}');
    expect(rules(good)).not.toContain('assume-no-externalid');
    expect(rules(good)).not.toContain('assume-no-mfa');
  });

  it('flags secrets in code but not values read from the environment', () => {
    expect(rules('$pw = ConvertTo-SecureString "Summer2026!" -AsPlainText -Force')).toContain('secret-plaintext-securestring');
    expect(rules('api_key = "sk_live_abcdef123456"')).toContain('secret-literal');
    expect(rules('api_key = os.environ["API_KEY"]')).not.toContain('secret-literal');
    expect(rules('aws_access_key_id = AKIAABCDEFGHIJKLMNOP')).toContain('aws-access-key');
  });

  it('flags destructive identity scripts without dry-run or logging (project 4)', () => {
    const script = 'Get-ADUser -Filter * | ForEach-Object {\n  Disable-ADAccount $_\n}';
    expect(rules(script)).toEqual(expect.arrayContaining(['no-dry-run', 'no-audit-log']));
    const better = '[CmdletBinding(SupportsShouldProcess)] param()\nStart-Transcript log.txt\nDisable-ADAccount $u';
    expect(rules(better)).not.toContain('no-dry-run');
    expect(rules(better)).not.toContain('no-audit-log');
  });

  it('flags JWTs accepted without verification (project 7)', () => {
    expect(rules('claims = jwt.decode(token, options={"verify_signature": False})')).toContain('jwt-no-verify');
  });

  it('flags standing privileged group membership and long PIM activations (project 8)', () => {
    expect(rules('Add-ADGroupMember -Identity "Domain Admins" -Members jdoe')).toContain('privileged-group-add');
    expect(rules('"maximumDuration": "PT8H"')).toContain('pim-long-activation');
    expect(rules('"maximumDuration": "PT2H"')).not.toContain('pim-long-activation');
  });

  it('flags a weak random source only when generating passwords', () => {
    expect(rules('$pwd = -join (1..32 | % { [char](Get-Random -Min 33 -Max 126) })')).toContain('weak-random');
    expect(rules('$delay = Get-Random -Minimum 1 -Maximum 5')).not.toContain('weak-random');
  });

  it('is deterministic and quotes the offending line', () => {
    const text = 'x\n"Action": "*"';
    const a = lintSubmission(text);
    expect(lintSubmission(text)).toEqual(a);
    expect(a[0]!.line).toBe(2);
    expect(a[0]!.evidence).toBe('"Action": "*"');
  });
});

describe('portfolio instructor', () => {
  const p9 = projectById('p09')!;

  it('sends the exact system prompt and the checker findings as facts', () => {
    const s = newProjectSession('p09');
    s.submission = '{"Action":"sts:AssumeRole","Principal":{"AWS":"*"}}';
    s.findings = lintSubmission(s.submission);
    const msgs = buildPortfolioMessages({ kind: 'review' }, p9, s);
    expect(msgs[0]).toEqual({ role: 'system', content: SYSTEM_PROMPT });
    expect(msgs[1]!.content).toContain('DETERMINISTIC CHECKER FINDINGS (facts');
    expect(msgs[1]!.content).toContain('Trust policy allows any principal');
    expect(msgs[msgs.length - 1]!.content).toMatch(/Hints, not fixes/);
  });

  it('works offline from the checker and never invents a pass', async () => {
    const s = newProjectSession('p04');
    s.submission = 'Disable-ADAccount $u';
    s.findings = lintSubmission(s.submission);
    const r = await askPortfolioInstructor({ kind: 'review' }, projectById('p04')!, s, { fetchImpl: offlineFetch });
    expect(r.source).toBe('offline');
    expect(r.text).toContain('Identity changes are not logged');
    expect(await portfolioStatus(offlineFetch)).toMatchObject({ online: false, message: PORTFOLIO.verification.failureMessage });
  });

  it('prefers llama3 from the config when it is installed', async () => {
    const tags = (async () => ({ ok: true, json: async () => ({ models: [{ name: 'phi3:mini' }, { name: 'llama3:latest' }] }) })) as unknown as typeof fetch;
    expect(await portfolioStatus(tags)).toEqual({ online: true, model: 'llama3:latest', message: PORTFOLIO.verification.successMessage });
  });

  it('clear chat removes only the conversation', async () => {
    const s = newProjectSession('p01');
    s.submission = 'x';
    s.done = [0, 1];
    s.hintLevel = 2;
    await askPortfolioInstructor({ kind: 'ask', question: 'why?' }, projectById('p01')!, s, { fetchImpl: offlineFetch });
    expect(s.transcript.length).toBe(2);
    clearProjectConversation(s);
    expect(s.transcript).toEqual([]);
    expect(s).toMatchObject({ submission: 'x', done: [0, 1], hintLevel: 2 });
  });
});

describe('AD lab: clear chat', () => {
  it('clears the conversation but keeps hints and check history', () => {
    const s = newSession('adl-01', 'coach');
    s.transcript.push({ role: 'student', text: 'hi' }, { role: 'instructor', text: 'hello' });
    s.hintLevels['dc-hostname'] = 2;
    s.failCounts['dc-hostname'] = 1;
    s.interviewAsked = [0];
    clearConversation(s);
    expect(s.transcript).toEqual([]);
    expect(s.interviewAsked).toEqual([]);
    expect(s.hintLevels['dc-hostname']).toBe(2);
    expect(s.failCounts['dc-hostname']).toBe(1);
  });
});

describe('Lab 12: enterprise organization', () => {
  const lab = labById('adl-12')!;

  it('an OU-linked GPO alone does not satisfy the domain password policy', () => {
    const s = startingState('adl-12');
    runCommand(s, 'DC01', 'New-ADOrganizationalUnit -Name Enterprise_Root');
    runCommand(s, 'DC01', 'New-GPO -Name Default_Enterprise_Password_Policy');
    runCommand(s, 'DC01', 'New-GPLink -Name Default_Enterprise_Password_Policy -Target "OU=Enterprise_Root,DC=corp,DC=technobiz,DC=local"');
    const r = validate(lab.id, lab.checks, { state: s });
    expect(r.results.find((x) => x.id === 'org-gpo-linked')!.pass).toBe(true);
    const pol = r.results.find((x) => x.id === 'org-pwd-policy')!;
    expect(pol.pass).toBe(false);
    expect(pol.observed).toContain('MinPasswordLength 12');
  });

  it('accepts MaxPasswordAge as a timespan string or New-TimeSpan', () => {
    const s = startingState('adl-12');
    runCommand(s, 'DC01', 'Set-ADDefaultDomainPasswordPolicy -Identity corp.technobiz.local -MaxPasswordAge (New-TimeSpan -Days 90)');
    expect(s.ad.passwordPolicy.maxAgeDays).toBe(90);
    applySolution(s, 'adl-12');
    expect(validate(lab.id, lab.checks, { state: s }).passed).toBe(true);
  });
});

describe('streaming replies', () => {
  const ndjson = (chunks: string[]) =>
    (async () => ({
      ok: true,
      body: new ReadableStream({
        start(c) {
          for (const ch of chunks) c.enqueue(new TextEncoder().encode(ch));
          c.close();
        },
      }),
    })) as unknown as typeof fetch;

  it('assembles /api/chat chunks (even split mid-line) and reports progress', async () => {
    const { ollamaStream } = await import('@/config/ollama');
    const seen: string[] = [];
    const text = await ollamaStream('http://x/api/chat', { model: 'm' }, (t) => seen.push(t), {
      fetchImpl: ndjson(['{"message":{"content":"### Find"}}\n{"message":{"con', 'tent":"ings"}}\n{"done":true}\n']),
    });
    expect(text).toBe('### Findings');
    expect(seen).toEqual(['### Find', '### Findings']);
  });

  it('the portfolio instructor streams and records the reply', async () => {
    const s = newProjectSession('p01');
    const seen: string[] = [];
    const r = await askPortfolioInstructor({ kind: 'intro' }, projectById('p01')!, s, {
      model: 'llama3:latest',
      fetchImpl: ndjson(['{"message":{"content":"Hello "}}\n', '{"message":{"content":"learner"}}\n']),
      onText: (t) => seen.push(t),
    });
    expect(r).toEqual({ text: 'Hello learner', source: 'ollama' });
    expect(seen.at(-1)).toBe('Hello learner');
    expect(s.transcript.at(-1)).toEqual({ role: 'assistant', text: 'Hello learner' });
  });

  it('falls back to the offline reply when the stream fails', async () => {
    const s = newProjectSession('p01');
    const r = await askPortfolioInstructor({ kind: 'intro' }, projectById('p01')!, s, { model: 'm', fetchImpl: offlineFetch, onText: () => {} });
    expect(r.source).toBe('offline');
    expect(r.text).toMatch(/^### Project 1/);
  });
});
