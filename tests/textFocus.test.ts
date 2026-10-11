import { afterEach, describe, expect, it, vi } from 'vitest';
import { restoreWindowTextFocus } from '@/ui/textFocus';

class ElementStub {
  isConnected = true;
  isContentEditable = false;
  focus = vi.fn();
  getClientRects = () => [{}];
}
class InputStub extends ElementStub {
  type = 'text';
  disabled = false;
  readOnly = false;
}
class TextareaStub extends InputStub {}

afterEach(() => vi.unstubAllGlobals());

function setup(field: InputStub, alreadyInside = false) {
  vi.stubGlobal('HTMLElement', ElementStub);
  vi.stubGlobal('HTMLInputElement', InputStub);
  vi.stubGlobal('HTMLTextAreaElement', TextareaStub);
  vi.stubGlobal('document', { activeElement: {} });
  return { contains: () => alreadyInside, querySelector: () => field } as unknown as HTMLElement;
}

describe('window typing focus', () => {
  it('focuses the terminal default field when returning from another window', () => {
    const field = new InputStub();
    restoreWindowTextFocus(setup(field));
    expect(field.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('keeps focus on an existing control inside the window', () => {
    const field = new InputStub();
    restoreWindowTextFocus(setup(field, true));
    expect(field.focus).not.toHaveBeenCalled();
  });

  it.each(['disabled', 'readOnly', 'disconnected', 'hidden'])('does not focus a %s field', state => {
    const field = new InputStub();
    if (state === 'disabled') field.disabled = true;
    if (state === 'readOnly') field.readOnly = true;
    if (state === 'disconnected') field.isConnected = false;
    if (state === 'hidden') field.getClientRects = () => [];
    restoreWindowTextFocus(setup(field));
    expect(field.focus).not.toHaveBeenCalled();
  });
});
