/** Keep each window's typing position and draw a reliable blinking caret while focused. */
const remembered = new WeakMap<HTMLElement, HTMLElement>();

function editable(element: Element | null): element is HTMLElement {
  return element instanceof HTMLElement && (
    (element instanceof HTMLInputElement && ['text', 'search', 'password', 'email', 'url', 'tel'].includes(element.type)
      && !element.disabled && !element.readOnly)
    || (element instanceof HTMLTextAreaElement && !element.disabled && !element.readOnly)
    || element.isContentEditable
  );
}

export function restoreWindowTextFocus(body: HTMLElement): void {
  if (body.contains(document.activeElement)) return;
  const field = remembered.get(body) ?? body.querySelector<HTMLElement>('[data-default-focus]');
  if (field?.isConnected && editable(field) && field.getClientRects().length) {
    field.focus({ preventScroll: true });
  }
}

export function installTextFocus(): void {
  if (document.getElementById('iam-steady-caret')) return;
  const caret = document.createElement('div');
  caret.id = 'iam-steady-caret';
  caret.setAttribute('aria-hidden', 'true');
  caret.style.cssText = 'position:fixed;display:none;width:2px;pointer-events:none;z-index:2147483646;';
  document.body.appendChild(caret);
  const mirror = document.createElement('div');
  mirror.setAttribute('aria-hidden', 'true');
  mirror.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;left:0;top:0;';
  document.body.appendChild(mirror);
  let decorated: HTMLElement | null = null;
  let frame = 0;

  function hide(): void {
    caret.style.display = 'none';
    decorated?.removeAttribute('data-stable-caret');
    decorated = null;
  }

  function paint(): void {
    frame = 0;
    hide();
    const field = document.activeElement;
    if (!document.hasFocus() || !editable(field) || !field.closest('.apex-window-body') || !field.getClientRects().length) return;
    const bounds = field.getBoundingClientRect();
    const style = getComputedStyle(field);
    let x: number, y: number;
    let height = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
      if (field.selectionStart === null || field.selectionStart !== field.selectionEnd) return;
      for (const property of ['box-sizing', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height',
        'letter-spacing', 'text-indent', 'text-align', 'direction', 'padding-top', 'padding-right', 'padding-bottom',
        'padding-left', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'tab-size']) {
        mirror.style.setProperty(property, style.getPropertyValue(property));
      }
      mirror.style.width = `${bounds.width}px`;
      mirror.style.boxSizing = 'border-box';
      mirror.style.height = `${bounds.height}px`;
      mirror.style.borderStyle = 'solid';
      mirror.style.overflow = 'hidden';
      mirror.style.whiteSpace = field instanceof HTMLTextAreaElement ? 'pre-wrap' : 'pre';
      mirror.style.overflowWrap = field instanceof HTMLTextAreaElement ? 'break-word' : 'normal';
      // Never copy password characters into the DOM mirror.
      const text = field instanceof HTMLInputElement && field.type === 'password' ? '•'.repeat(field.value.length) : field.value;
      mirror.textContent = text.slice(0, field.selectionStart);
      const marker = document.createElement('span');
      marker.textContent = text.slice(field.selectionStart) || '\u200b';
      mirror.appendChild(marker);
      const rect = marker.getClientRects()[0];
      mirror.textContent = '';
      if (!rect) return;
      height = rect.height || height;
      x = bounds.left + rect.left - field.scrollLeft;
      y = bounds.top + rect.top - field.scrollTop;
    } else {
      const selection = window.getSelection();
      if (!selection?.isCollapsed || !selection.rangeCount || !field.contains(selection.anchorNode)) return;
      const range = selection.getRangeAt(0).cloneRange();
      const rect = range.getClientRects()[0];
      if (!rect) return; // Native caret remains available for empty rich text.
      x = rect.left; y = rect.top;
      height = rect.height || height;
    }
    if (x < bounds.left || x > bounds.right || y < bounds.top || y + height > bounds.bottom + 1) return;
    const hit = document.elementFromPoint(Math.min(x + 1, bounds.right - 1), y + height / 2);
    if (hit !== field && !field.contains(hit)) return; // Covered/minimized windows never draw on top.
    const color = style.caretColor === 'auto' ? style.color : style.caretColor;
    Object.assign(caret.style, { display: 'block', left: `${x}px`, top: `${y}px`, height: `${height}px`, background: color });
    field.setAttribute('data-stable-caret', '');
    decorated = field;
    mirror.textContent = '';
  }

  const schedule = (): void => { if (!frame) frame = requestAnimationFrame(paint); };
  document.addEventListener('focusin', event => {
    const field = event.target;
    if (field instanceof HTMLElement && editable(field)) {
      const body = field.closest<HTMLElement>('.apex-window-body');
      if (body) remembered.set(body, field);
    }
    schedule();
  });
  for (const event of ['focusout', 'input', 'keyup', 'pointerup', 'selectionchange', 'scroll']) {
    document.addEventListener(event, schedule, true);
  }
  window.addEventListener('resize', schedule);
  window.addEventListener('blur', hide);
  window.addEventListener('focus', schedule);
  document.addEventListener('visibilitychange', schedule);
  // Reposition during window dragging without changing the typing position.
  document.addEventListener('pointermove', event => { if (event.buttons) schedule(); });
  const observer = new ResizeObserver(schedule);
  document.addEventListener('focusin', event => {
    observer.disconnect();
    if (event.target instanceof HTMLElement && editable(event.target)) observer.observe(event.target);
  });
}
