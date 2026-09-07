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
 * The same guard covers the machine's own identity. config/vmHost.ts was
 * written to end exactly this drift once already — Settings called the host
 * APEX-OPS-01 while the terminal called it something else — and it came back
 * in the Control Panel, the Settings account card and the Start menu, where
 * the signed-in account read admin@northwind.local on a workstation the login
 * screen had just called iamlab.com.
 *
 * The names live in config. This makes putting them back in a source file a
 * test failure rather than something noticed months later.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { COMPANY } from '@/config';
import { VM_HOST } from '@/config/vmHost';
import { PRODUCT } from '@/config/product';

/**
 * Names this project has moved on from.
 *
 * "Apex Identity" is deliberately absent. It is the *software vendor* — the
 * publisher in Control Panel, the folder under Program Files, the Start menu
 * header — not the company the learner works for, and it is used consistently
 * everywhere it appears. A product name and an employer name are different
 * things, and only the employer was renamed.
 */
const RETIRED_NAMES = [
  'northwind',
  // The maintainer's old logon name, which the built-in account used to use.
  // His *name* is allowed and expected — he publishes this — but no simulated
  // account should be him. The vmHost test below is what enforces that.
  'erickomari',
  'apex-ops',
  // The product's own placeholder names, before it was called IAM Range.
  'apex identity',
  'apex os',
  'identity operations workstation',
];

/** Where the publisher's name legitimately appears: he publishes this. */
const PUBLISHER_FILES = ['product.ts'];

/**
 * Files allowed to name a retired identity.
 *
 * vmHost.ts is the definition that ended the drift, and its header records
 * what it replaced. Deleting that sentence to satisfy a lint rule would throw
 * away the reason the file exists.
 */
const HISTORY_FILES = ['vmHost.ts', 'product.ts'];

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
      if (HISTORY_FILES.some((f) => file.endsWith(f))) continue;
      const text = readFileSync(file, 'utf8');
      // Case-insensitive: the first version of this guard missed
      // "northwind.local" in the Control Panel because it only looked for the
      // capitalised form.
      const lower = text.toLowerCase();
      for (const name of RETIRED_NAMES) {
        if (lower.includes(name)) offenders.push(`${file}: ${name}`);
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

  it('the surfaces outside TypeScript agree with the product definition', () => {
    // The Electron main process is CommonJS and the landing page is static
    // HTML; neither can import config/product.ts. Their copies are checked
    // here rather than trusted, because a rename that reaches half the
    // surfaces is worse than no rename — which is what "Northwind" was.
    const main = readFileSync(join('electron', 'main.cjs'), 'utf8');
    expect(main).toContain(PRODUCT.windowTitle);

    const site = readFileSync(join('site', 'index.html'), 'utf8');
    expect(site).toContain(PRODUCT.name);
    expect(site).toContain(`https://github.com/${PRODUCT.repo}`);

    const html = readFileSync('index.html', 'utf8');
    expect(html).toContain(PRODUCT.windowTitle);
  });

  it('the installer is built under the product name and repository', () => {
    // The auto-updater points at this repository for the life of every
    // installed copy. It disagreeing with config/product.ts would mean
    // shipping an app that checks the wrong URL for updates forever.
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      build: {
        productName: string;
        appId: string;
        publish: { owner: string; repo: string }[];
        nsis: { shortcutName: string };
      };
    };
    expect(pkg.build.productName).toBe(PRODUCT.name);
    expect(pkg.build.appId).toBe(PRODUCT.appId);
    expect(pkg.build.nsis.shortcutName).toBe(PRODUCT.name);
    expect(`${pkg.build.publish[0]!.owner}/${pkg.build.publish[0]!.repo}`).toBe(PRODUCT.repo);
  });

  it('the built-in administrator is generic, not a person', () => {
    // This ships to other people. The publisher is credited on the installer
    // and the landing page — never baked into the account they sign in as, or
    // into the domain they administer.
    expect(VM_HOST.user).toBe('admin');
    expect(VM_HOST.email).toBe(`admin@${COMPANY.domain}`);
    expect(VM_HOST.displayName).toBe('Administrator');
    expect(PUBLISHER_FILES.length).toBeGreaterThan(0);
  });

  it('the publisher is named on the installer and the landing page', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      author?: { name?: string };
    };
    expect(pkg.author?.name).toBe(PRODUCT.publisher);

    const site = readFileSync(join('site', 'index.html'), 'utf8');
    expect(site).toContain(PRODUCT.publisher);
  });
});
