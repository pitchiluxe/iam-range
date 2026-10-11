import { afterEach, expect, it, vi } from 'vitest';
import { copyText } from '@/util/copyText';
afterEach(() => vi.unstubAllGlobals());

it('uses the desktop clipboard bridge for selected terminal text', async () => {
  const invoke = vi.fn().mockResolvedValue(true);
  vi.stubGlobal('window', { electron: { invoke } });
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('not focused')) } });
  expect(await copyText('grp-hr-readers')).toBe(true);
  expect(invoke).toHaveBeenCalledWith('clipboard:writeText', 'grp-hr-readers');
});

it('uses the standard browser clipboard outside the desktop app', async () => {
  vi.stubGlobal('window', {});
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  expect(await copyText('directory evidence')).toBe(true);
  expect(writeText).toHaveBeenCalledWith('directory evidence');
});
