/**
 * tests/adLabGreenfield.test.ts — the Greenfield Build lab.
 *
 * The learner builds the whole Setup-guide design by hand on their own
 * Build-DC01 / Build-CLIENT01. These tests prove the lab is passable from two
 * fresh machines, that it stays outside the numbered series' replay chain,
 * and that its design matches the Setup guide's naming table.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AD_LABS, ALL_AD_LABS, BUILD_LAB, applySolution, hostsForLab, labById, startingState } from '@/vm/adlab/labs';
import { validate, CHECKS } from '@/vm/adlab/validation';
import { factsToLabState } from '@/vm/adlab/realVm';
import { buildInstructorPrompt } from '@/vm/adlab/instructor';
import { newSession } from '@/vm/adlab/instructor';
import { snapshotForInstructor } from '@/vm/adlab/observe';
import { NAMING } from '@/ui/labSetupGuide';

describe('Greenfield Build lab', () => {
  it('is offered alongside the series but is not part of its replay chain', () => {
    expect(ALL_AD_LABS).toContain(BUILD_LAB);
    expect(AD_LABS).not.toContain(BUILD_LAB);
    expect(labById('adl-build')).toBe(BUILD_LAB);
    // Lab 01 still starts from untouched machines.
    expect(startingState('adl-01').hosts.DC01.hostname).not.toBe('DC01');
  });

  it('starts from two fresh machines and is passable with the reference solution', () => {
    const s = startingState(BUILD_LAB.id);
    expect(validate(BUILD_LAB.id, BUILD_LAB.checks, { state: s }).passed).toBe(false);
    applySolution(s, BUILD_LAB.id);
    const r = validate(BUILD_LAB.id, BUILD_LAB.checks, { state: s });
    expect(r.results.filter((x) => !x.pass).map((x) => x.id)).toEqual([]);
  });

  it('uses only checks the validation engine knows, and reads both machines', () => {
    for (const id of BUILD_LAB.checks) expect(CHECKS[id], id).toBeDefined();
    expect(hostsForLab(BUILD_LAB)).toEqual(['DC01', 'CLIENT01']);
  });

  it('builds to the Setup guide design', () => {
    const design = NAMING.map(([, v]) => v).join('\n');
    for (const v of ['TechnoBiz-LAN', '172.16.0.1', 'corp.technobiz.local', 'TechnoBiz LAN', '172.16.0.100']) {
      expect(design).toContain(v);
      expect(BUILD_LAB.requirements.join('\n') + BUILD_LAB.guide!.flatMap((g) => g.steps).join('\n')).toContain(v);
    }
    expect(BUILD_LAB.vmSet).toBe('build');
  });

  it('gives the instructor the build phases to teach from', () => {
    const session = newSession(BUILD_LAB.id, BUILD_LAB.defaultMode);
    const s = startingState(BUILD_LAB.id);
    const prompt = buildInstructorPrompt({ kind: 'intro' }, { lab: BUILD_LAB, view: snapshotForInstructor(s), session } as never);
    expect(prompt).toContain('Phase 1 — Create the VMs in VirtualBox');
    expect(prompt).toContain('Phase 7 — CLIENT01 joins the domain');
  });

  it('names the hand-built VMs when they are missing', () => {
    const r = factsToLabState({ vms: {} }, 'build');
    expect(r.problemsByHost.DC01).toMatch(/Build-DC01/);
    expect(factsToLabState({ vms: {} }).problemsByHost.DC01).toMatch(/01-New-AdLabVMs/);
  });

  it('points the desktop app at Build-DC01 / Build-CLIENT01 only', () => {
    const cfg = JSON.parse(readFileSync(join(process.cwd(), 'omari-lab', '10-AD-ENTERPRISE-VBOX', 'adlab.vbox.json'), 'utf8'));
    expect(cfg.build.vms.DC01.vmName).toBe('Build-DC01');
    expect(cfg.build.vms.CLIENT01.vmName).toBe('Build-CLIENT01');
    const main = readFileSync(join(process.cwd(), 'electron', 'main.cjs'), 'utf8');
    expect(main).toMatch(/ipcMain\.handle\('adlab:vm-open'/);
    expect(main).toMatch(/'-VmSet', 'Build'/);
  });
});
