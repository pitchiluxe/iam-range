/**
 * tests/challenge90.test.ts — the 90-Day Challenge schedule and lab content.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CHALLENGE_DAYS,
  CHALLENGE_LABS,
  CHALLENGE_PHASES,
  challengeDay,
  dateOfDay,
  labForDay,
  parseDeliverables,
} from '@/config/challenge90';
import { appsForDepartment } from '@/config/desktopProfiles';

describe('90-day schedule', () => {
  it('has 13 labs covering days 1–90 with no gaps or overlaps', () => {
    expect(CHALLENGE_LABS).toHaveLength(13);
    let expected = 1;
    for (const lab of CHALLENGE_LABS) {
      expect(lab.firstDay).toBe(expected);
      expect(lab.lastDay - lab.firstDay + 1).toBe(lab.dailyPlan.length);
      expected = lab.lastDay + 1;
    }
    expect(expected - 1).toBe(CHALLENGE_DAYS);
  });

  it('maps every day to exactly one lab', () => {
    for (let d = 1; d <= CHALLENGE_DAYS; d++) expect(labForDay(d)).toBeDefined();
    expect(labForDay(0)).toBeUndefined();
    expect(labForDay(91)).toBeUndefined();
  });

  it('puts every lab in a known phase', () => {
    const ids = CHALLENGE_PHASES.map((p) => p.id);
    for (const lab of CHALLENGE_LABS) expect(ids).toContain(lab.phase);
  });

  it('counts calendar days from the start date as day 1', () => {
    expect(challengeDay('2026-10-01', new Date(2026, 9, 1, 23, 30))).toBe(1);
    expect(challengeDay('2026-10-01', new Date(2026, 9, 2, 0, 5))).toBe(2);
    expect(challengeDay('2026-10-01', new Date(2026, 8, 30))).toBe(0);
    expect(challengeDay('2026-10-01', new Date(2026, 11, 29))).toBe(90);
    expect(challengeDay('not-a-date')).toBe(0);
    expect(dateOfDay('2026-10-01', 90)).toBe('2026-12-29');
  });
});

describe('lab content', () => {
  it('gives every lab the mentor-format sections and a non-empty checklist', () => {
    for (const lab of CHALLENGE_LABS) {
      for (const heading of ['## Career objective', '## Scenario', '## Hands-on lab', '## Validation checklist', '## Challenge', '## GitHub assignment', '## Resume bullet', '## Interview question']) {
        expect(lab.body, `Lab ${lab.number} missing ${heading}`).toContain(heading);
      }
      expect(lab.deliverables.length, `Lab ${lab.number}`).toBeGreaterThanOrEqual(4);
      expect(lab.body).toMatch(new RegExp(`Days ${lab.firstDay}–${lab.lastDay}`));
    }
  });

  it('targets the real lab estate and avoids known-wrong syntax', () => {
    const all = CHALLENGE_LABS.map((l) => l.body).join('\n');
    expect(all).not.toMatch(/contoso\.local/i);
    expect(all).not.toMatch(/New-ADGroup[^\n]*-GroupPurpose/); // not a New-ADGroup parameter
    expect(all).not.toMatch(/type:\s*'horizontalBar'/);     // removed in Chart.js 3
    expect(all).not.toMatch(/TempP@ss|P@ssw0rd/);        // no passwords in lab text
    expect(all).toContain('corp.technobiz.local');
  });

  it('creates break-glass exclusions before enforcing MFA', () => {
    const lab5 = CHALLENGE_LABS[4]!.body;
    expect(lab5.indexOf('break-glass accounts FIRST')).toBeGreaterThan(-1);
    expect(lab5.indexOf('break-glass accounts FIRST')).toBeLessThan(lab5.indexOf('Require-MFA-All-Users'));
  });

  it('parses only the validation checklist bullets', () => {
    const md = '## Scenario\n- not me\n## Validation checklist\n\n- one\n- two\n## Challenge\n- nor me';
    expect(parseDeliverables(md)).toEqual(['one', 'two']);
    expect(parseDeliverables('# nothing')).toEqual([]);
  });

  it('lists every lab in the kit README', () => {
    const readme = readFileSync(join('omari-lab', '12-90-DAY-CHALLENGE', 'README.md'), 'utf8');
    for (const lab of CHALLENGE_LABS) expect(readme).toContain(lab.title);
  });
});

describe('90-day challenge window', () => {
  const source = readFileSync(join('src', 'ui', 'consoles', 'challengeWindow.ts'), 'utf8');
  const overlay = readFileSync(join('src', 'ui', 'desktopOverlay.ts'), 'utf8');

  it('is registered and on every desktop', () => {
    expect(overlay).toMatch(/id: 'challenge-90'/);
    for (const dept of ['IT', 'HR', 'Finance']) expect(appsForDepartment(dept)).toContain('challenge-90');
  });

  it('renders lab text through the safe markdown renderer and offers feedback copy', () => {
    expect(source).toMatch(/renderMarkdown\(lab\.body\)/);
    expect(source).not.toMatch(/innerHTML\s*=\s*[^'"\s]/);   // only ever cleared
    expect(source).toMatch(/Copy feedback/);
    expect(source).toMatch(/Copy all feedback/);
  });
});

// ---------------------------------------------------------------------------
// Every in-app command in the AD labs actually runs in the simulator
// ---------------------------------------------------------------------------
import { VmSession } from '@/vm/session';
import { dispatch as dispatchLine, createShellState as newShell } from '@/terminal/dispatcher';
import { runScript } from '@/terminal/script';
import type { CapabilityContext } from '@/services';

/** ```powershell blocks inside "## Do this lab in the app". A block whose first
 *  line is `# PowerShell ISE` is a Script Editor script; the rest are typed
 *  into Terminal one line at a time. */
function inAppBlocks(markdown: string): { script: boolean; code: string }[] {
  const start = markdown.indexOf('## Do this lab in the app');
  if (start < 0) return [];
  const rest = markdown.slice(start + 3);
  const end = rest.search(/^## /m);
  const section = end < 0 ? rest : rest.slice(0, end);
  return [...section.matchAll(/```powershell\r?\n([\s\S]*?)```/g)]
    // "# PowerShell (this PC)" blocks run in the real console, not the simulator.
    .filter((m) => !/^# PowerShell \(this PC\)/.test(m[1]!))
    .map((m) => ({ script: /^# PowerShell ISE/.test(m[1]!), code: m[1]! }));
}

describe('in-app walkthroughs', () => {
  it('every lab starts with a "Do this lab in the app" section', () => {
    for (const lab of CHALLENGE_LABS) expect(lab.body, `Lab ${lab.number}`).toContain('## Do this lab in the app');
  });

  it('runs every Active Directory command, in lab order, on one simulated domain', () => {
    const s = new VmSession(null);
    const ctx = { dir: s.dir, idp: s.idp, tickets: s.tickets, audit: s.audit, pim: s.pim, cloud: s.cloud,
      endpoints: s.endpoints, actor: s.dir.getUserByUsername('admin')!.id } as CapabilityContext;
    const shell = newShell();
    const failures: string[] = [];
    for (const lab of CHALLENGE_LABS.filter((l) => l.workspace === 'ad')) {
      for (const block of inAppBlocks(lab.body)) {
        if (block.script) {
          const r = runScript(block.code, ctx);
          if (!r.ok) failures.push(`Lab ${lab.number} script: ${r.parseError ?? r.results.filter((x) => !x.result.ok).map((x) => `${x.command} → ${x.result.output}`).join(' | ')}`);
          continue;
        }
        for (const line of block.code.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))) {
          // The walkthrough locks the account by hand on the sign-in screen
          // before it unlocks it; do the same wrong-password sign-ins here.
          const unlock = /^Unlock-ADAccount -Identity (\S+)/.exec(line);
          if (unlock) for (let i = 0; i < 5; i++) s.idp.signIn(unlock[1]!, 'not-the-password');
          const r = dispatchLine(line, ctx, shell);
          if (!r.ok) failures.push(`Lab ${lab.number}: ${line} → ${r.output}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

describe('reset dates', () => {
  it('restarting a lab schedules it to begin on the day of the reset', async () => {
    const { startDateForLabToday, isoDate } = await import('@/config/challenge90');
    const today = new Date(2026, 9, 15, 18, 0);
    expect(startDateForLabToday(CHALLENGE_LABS[0]!, today)).toBe('2026-10-15');
    const lab5 = CHALLENGE_LABS[4]!; // days 29–35
    const start = startDateForLabToday(lab5, today);
    expect(start).toBe('2026-09-17');
    expect(challengeDay(start, today)).toBe(29);
    expect(labForDay(challengeDay(start, today))?.number).toBe(5);
    expect(isoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('in-app workspace', () => {
  const windowSrc = readFileSync(join('src', 'ui', 'consoles', 'challengeWindow.ts'), 'utf8');
  const overlaySrc = readFileSync(join('src', 'ui', 'desktopOverlay.ts'), 'utf8');

  it('does not offer the Real-VM setup guide', () => {
    expect(windowSrc).not.toMatch(/openLabSetupGuide|Real-VM setup guide/);
  });

  it('opens only registered app windows and allowlisted pages', async () => {
    const { TOOLS } = await import('@/ui/consoles/challengeWindow');
    const { isAllowedUrl } = await import('@/config/webAllowlist');
    for (const lab of CHALLENGE_LABS) {
      expect(lab.tools.length, `Lab ${lab.number}`).toBeGreaterThan(0);
      for (const tool of lab.tools) {
        const t = TOOLS[tool];
        if (t.url) expect(isAllowedUrl(t.url), t.url).toBe(true);
        else expect(overlaySrc, t.app).toContain(`id: '${t.app}'`);
      }
    }
  });

  it('lets the Entra ID labs reach Microsoft sign-in from the in-app Browser', async () => {
    const { isAllowedUrl } = await import('@/config/webAllowlist');
    for (const url of ['https://portal.azure.com', 'https://entra.microsoft.com', 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', 'https://login.live.com/']) {
      expect(isAllowedUrl(url), url).toBe(true);
    }
    expect(isAllowedUrl('https://evil-azure.com.attacker.test/')).toBe(false);
  });

  it('puts the real PowerShell console on every desktop, backed by the desktop app', () => {
    for (const dept of ['IT', 'HR']) expect(appsForDepartment(dept)).toContain('host-powershell');
    const main = readFileSync(join('electron', 'main.cjs'), 'utf8');
    expect(main).toMatch(/ipcMain\.handle\('pwsh:start'/);
    expect(main).toMatch(/randomBytes/); // the done-marker carries a per-session nonce
    expect(readFileSync(join('electron', 'preload.cjs'), 'utf8')).toMatch(/onPwshEvent/);
  });
});

describe('in-app checklists and plans', () => {
  it('ask for evidence the app can produce, not a real VM', () => {
    for (const lab of CHALLENGE_LABS.filter((l) => l.workspace === 'ad')) {
      const text = [...lab.deliverables, ...lab.dailyPlan].join('\n');
      expect(text, `Lab ${lab.number}`).not.toMatch(/CLIENT01|whoami|snapshot the VMs|badPwdCount/);
    }
  });
});
