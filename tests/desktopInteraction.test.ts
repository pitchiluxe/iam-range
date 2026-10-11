import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizePointer, pointerSvg } from '@/ui/mousePointer';
import { createStickyNote, normalizeNotes } from '@/ui/stickyNotes';
import { watchRemoval } from '@/ui/watchRemoval';

afterEach(() => vi.unstubAllGlobals());
describe('window lifecycle observer', () => {
  it('ignores repeated page updates and cleans up after removal, preventing render feedback', () => {
    let notify = () => {};
    const disconnect = vi.fn(), cleanup = vi.fn();
    vi.stubGlobal('MutationObserver', class { constructor(fn: () => void) { notify = fn; } disconnect = disconnect; observe = vi.fn(); });
    vi.stubGlobal('document', { body: {} });
    const element = { isConnected: true };
    watchRemoval(element as HTMLElement, cleanup);
    for (let i = 0; i < 50; i++) notify();
    expect(cleanup).not.toHaveBeenCalled();
    element.isConnected = false; notify();
    expect(cleanup).toHaveBeenCalledOnce(); expect(disconnect).toHaveBeenCalledOnce();
  });
});
describe('pointer preferences', () => {
  it('clamps unsupported size and rejects invalid colors/styles', () => {
    expect(normalizePointer({ size: 99, color: 'url(x)', style: 'invalid' as never })).toEqual({ size: 5, color: '#a3e635', style: 'white' });
    expect(normalizePointer({ size: -2 }).size).toBe(1);
  });
  it('keeps user-selected inverted/color schemes and emits a readable text cursor', () => {
    expect(normalizePointer({ style: 'inverted', size: 3 }).style).toBe('inverted');
    expect(normalizePointer({ style: 'color', color: '#fb7185' }).color).toBe('#fb7185');
    expect(pointerSvg('#fff', '#000', true)).toContain('M16 4v24');
  });
});
describe('sticky note migration', () => {
  it('preserves old notes, colors and placement while adding stable identities and dimensions', () => {
    const notes = normalizeNotes([{ text: 'Keep my work', color: '#93c5fd', left: 25, top: 60 }]);
    expect(notes[0]).toMatchObject({ text: 'Keep my work', color: '#93c5fd', left: 25, top: 60, open: true, width: 280 });
    expect(notes[0]?.id).toBeTruthy();
  });
  it('preserves closed notes without deleting or duplicating them', () => {
    const note = { ...createStickyNote(), text: 'Saved', open: false };
    expect(normalizeNotes([note])[0]).toMatchObject({ id: note.id, text: 'Saved', open: false });
  });
  it('rejects corrupt records and clamps note dimensions', () => {
    expect(normalizeNotes({ text: 'wrong shape' })).toEqual([]);
    expect(normalizeNotes([null, { text: 42 }, { text: 'valid', width: -10, height: 10000 }])[0]).toMatchObject({ width: 240, height: 700 });
  });
});
