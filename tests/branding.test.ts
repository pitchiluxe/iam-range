/**
 * tests/branding.test.ts — one company, one domain.
 *
 * The workstation was renamed to IAM Lab and six strings in the UI kept saying
 * Northwind: the terminal banner, the app portal title, the Control Panel's
 * network and printer names, and the Settings footer. A workstation that calls
 * itself two different companies undermines what the whole app is for — the
 * learner is meant to trust that what is on screen is the estate they are
 * administering.
 *
 * The names live in config. This makes putting them back in a source file a
 * test failure rather than something noticed months later.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { COMPANY } from '@/config';
import { VM_HOST } from '@/config/vmHost';

/**
 * Names this project has moved on from.
 *
 * "Apex Identity" is deliberately absent. It is the *software vendor* — the
 * publisher in Control Panel, the folder under Program Files, the Start menu
 * header — not the company the learner works for, and it is used consistently
 * everywhere it appears. A product name and an employer name are different
 * things, and only the employer was renamed.
 */
const RETIRED_NAMES = ['Northwind', 'Erick Omari', 'ERICKOMARI', 'erickomari'];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('branding', () => {
  it('no source file names a company this project has retired', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles('src')) {
      const text = readFileSync(file, 'utf8');
      for (const name of RETIRED_NAMES) {
        if (text.includes(name)) offenders.push(`${file}: ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the host, the domain and the company agree', () => {
    // IAMLAB-WS01 in iamlab.com, NetBIOS IAMLAB. A workstation named for one
    // domain sitting in another is the kind of detail a learner will notice
    // and rightly distrust.
    const short = COMPANY.domain.split('.')[0]!;
    expect(VM_HOST.domain).toBe(COMPANY.domain);
    expect(VM_HOST.netbiosDomain.toLowerCase()).toBe(short);
    expect(VM_HOST.name.toLowerCase()).toContain(short);
    expect(VM_HOST.domainController.toLowerCase()).toContain(short);
  });

  it('the built-in administrator is generic, not a person', () => {
    // This ships to other people. The creator is credited on the website, not
    // baked into the account they sign in as.
    expect(VM_HOST.user).toBe('admin');
    expect(VM_HOST.email).toBe(`admin@${COMPANY.domain}`);
  });
});
