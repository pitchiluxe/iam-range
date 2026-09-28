/**
 * tests/setupGuide.test.ts — the setup guide tells learners the names the kit
 * actually uses. If adlab.vbox.json changes, this fails until the guide does.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DOWNLOADS, ISO_FOLDER, ISO_NAMES, NAMING } from '@/ui/labSetupGuide';
import { PLAN } from '@/vm/adlab/state';

const kit = JSON.parse(readFileSync('omari-lab/10-AD-ENTERPRISE-VBOX/adlab.vbox.json', 'utf8')) as {
  vmFolder: string;
  group: string;
  internalNetwork: string;
  isos: { server: string; client: string };
  vms: Record<string, { vmName: string; nics: { alias: string }[] }>;
};
const naming = NAMING.map(([k, v]) => `${k}: ${v}`).join('\n');

describe('lab setup guide', () => {
  it('names the ISOs exactly where and as the kit looks for them', () => {
    expect(kit.isos.server).toBe(`${ISO_FOLDER}\\${ISO_NAMES.server}`);
    expect(kit.isos.client).toBe(`${ISO_FOLDER}\\${ISO_NAMES.client}`);
  });

  it('uses the kit\'s VM, adapter, network and group names', () => {
    for (const vm of Object.values(kit.vms)) {
      expect(naming).toContain(vm.vmName);
      for (const nic of vm.nics) expect(naming).toContain(`"${nic.alias}"`);
    }
    expect(naming).toContain(kit.internalNetwork);
    expect(naming).toContain(kit.group);
  });

  it('uses the lab\'s address plan', () => {
    for (const v of [PLAN.dcInternalIp, PLAN.mask, PLAN.scopeStart, PLAN.scopeEnd]) expect(naming).toContain(v);
    expect(naming).toContain('corp.technobiz.local');
  });

  it('links the official downloads over https', () => {
    expect(DOWNLOADS.server).toMatch(/^https:\/\/www\.microsoft\.com\/.*evalcenter\/download-windows-server-2022$/);
    expect(DOWNLOADS.client).toMatch(/^https:\/\/www\.microsoft\.com\/.*evalcenter\/download-windows-11-enterprise$/);
    expect(DOWNLOADS.virtualbox).toBe('https://www.virtualbox.org/wiki/Downloads');
  });

  it('the diagram names the same machines and addresses', () => {
    const svg = readFileSync('docs/images/ad-lab-network.svg', 'utf8');
    for (const v of ['ADLab-DC01', 'ADLab-CLIENT01', kit.internalNetwork, PLAN.dcInternalIp, PLAN.scopeStart, PLAN.scopeEnd, ISO_NAMES.server, ISO_NAMES.client]) {
      expect(svg).toContain(v);
    }
  });
});

describe('page security policy', () => {
  it('lets the in-VM browser frame allowlisted hosts only (filled in at build time)', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).toMatch(/frame-src %FRAME_SRC%;/);
    expect(html).toMatch(/default-src 'self'/);
  });
});
