/**
 * ui/consoles/terminalWindow.ts — PowerShell-style terminal inside the VM.
 *
 * Every command runs a capability from the registry, so typing
 * `Unlock-ADAccount -Identity jane.doe` fires the same service call, audit
 * event and lab-step validator as clicking Unlock in the IAM Console. The
 * cmdlet names are the real AD ones a helpdesk or IAM interview asks about.
 */
import type { VmServices } from '@/vm/session';
import type { UserId } from '@/domain';
import type { CapabilityContext } from '@/services';
import { createShellState, dispatch } from '@/terminal/dispatcher';
import { COMPANY } from '@/config';

const BANNER = [
  `${COMPANY.name} — Identity Operations Shell`,
  'Windows PowerShell 5.1 (simulated)',
  '',
  "Type 'Get-Help' to list commands, 'Get-Help <cmdlet>' for one, 'exit' to close.",
  '',
].join('\n');

export function renderTerminalWindow(body: HTMLElement, conductor: VmServices): void {
  body.innerHTML = '';
  // Additive: replacing cssText would drop the `flex:1; min-height:0` the
  // window manager sets, so the shell would size to its content instead of
  // filling the window.
  Object.assign(body.style, {
    overflow: 'hidden',
    background: '#0c0c0c',
    flex: '1',
    minHeight: '0',
  });

  if (!conductor.dir || !conductor.idp || !conductor.audit || !conductor.tickets) {
    body.style.cssText = 'padding:24px;color:#8b95a1;font-size:13px;background:#0c0c0c;';
    body.innerHTML =
      '<div style="font-family:Consolas,monospace;">' +
      'Identity services unavailable.<br/><br/>Reset the environment from the ' +
      'Ticket Queue to re-seed the directory.</div>';
    return;
  }

  /**
   * Resolve the services fresh for every command.
   *
   * VmServices.start() (and therefore "Reset lab") calls bootstrap(), which
   * constructs NEW service instances. Capturing them once at render time left
   * the shell holding orphaned services after any reset: commands mutated a
   * directory nobody was looking at any more and still reported success.
   */
  const currentCtx = (): CapabilityContext | null => {
    if (!conductor.dir || !conductor.idp || !conductor.audit || !conductor.tickets) return null;
    return {
      dir: conductor.dir,
      idp: conductor.idp,
      tickets: conductor.tickets,
      audit: conductor.audit,
      pim: conductor.pim,
      cloud: conductor.cloud,
      actor: 'system' as UserId,
    };
  };

  const screen = document.createElement('div');
  screen.style.cssText =
    'height:100%;overflow-y:auto;padding:10px 12px;box-sizing:border-box;' +
    "font-family:Consolas,'Cascadia Mono',Menlo,monospace;font-size:12.5px;" +
    'line-height:1.45;color:#ccc;background:#0c0c0c;' +
    'scrollbar-width:thin;scrollbar-color:#333 #0c0c0c;';
  body.appendChild(screen);

  const history: string[] = [];
  let historyIdx = -1;
  // Owned per window so `cd` persists across commands in this session.
  const shell = createShellState();

  const write = (text: string, color = '#ccc'): void => {
    if (text === '') return;
    const pre = document.createElement('pre');
    pre.textContent = text;
    pre.style.cssText = `margin:0;white-space:pre-wrap;word-break:break-word;color:${color};font:inherit;`;
    screen.appendChild(pre);
  };

  /** The prompt line: `PS <current directory>>` plus a borderless input that
   *  looks like a caret. The path was hardcoded, so `cd` moved the shell and
   *  the prompt carried on claiming the drive root. */
  let activeInput: HTMLInputElement | null = null;
  const newPrompt = (): void => {
    const line = document.createElement('div');
    line.style.cssText = 'display:flex;gap:6px;align-items:baseline;';

    const ps = document.createElement('span');
    ps.textContent = `PS ${shell.cwd.path}>`;
    ps.style.cssText = 'color:#4ec9b0;flex-shrink:0;';

    const input = document.createElement('input');
    input.type = 'text';
    input.spellcheck = false;
    input.autocapitalize = 'off';
    input.setAttribute('autocomplete', 'off');
    input.style.cssText =
      'flex:1;background:transparent;border:none;outline:none;color:#ccc;font:inherit;padding:0;';

    line.append(ps, input);
    screen.appendChild(line);
    activeInput = input;
    input.focus();
    screen.scrollTop = screen.scrollHeight;

    input.addEventListener('keydown', (e) => {
      // History recall, as in a real shell.
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (history.length === 0) return;
        historyIdx = historyIdx < 0 ? history.length - 1 : Math.max(0, historyIdx - 1);
        input.value = history[historyIdx] ?? '';
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (historyIdx < 0) return;
        historyIdx++;
        if (historyIdx >= history.length) {
          historyIdx = -1;
          input.value = '';
        } else {
          input.value = history[historyIdx] ?? '';
        }
        return;
      }
      if (e.key !== 'Enter') return;

      const line = input.value;
      // Freeze the submitted line as text so it can't be edited afterwards.
      input.disabled = true;
      input.style.color = '#ccc';
      if (line.trim()) {
        history.push(line);
        historyIdx = -1;
      }
      run(line);
    });
  };


  const run = (line: string): void => {
    const ctx = currentCtx();
    if (!ctx) {
      write('The identity services are not available. Reset the environment to re-seed.', '#f48771');
      write('');
      newPrompt();
      return;
    }
    const res = dispatch(line, ctx, shell);

    if (res.control === 'clear') {
      screen.innerHTML = '';
      write(BANNER, '#6a9955');
      newPrompt();
      return;
    }
    if (res.control === 'exit') {
      write('');
      // Ask the window manager to close us; it owns window lifecycle.
      document.dispatchEvent(new CustomEvent('apex-close-window', { detail: { id: 'terminal' } }));
      return;
    }

    write(res.output, res.ok ? '#ccc' : '#f48771');
    write('');
    newPrompt();
  };

  // Clicking anywhere in the shell returns focus to the live prompt, the way a
  // terminal emulator behaves.
  screen.addEventListener('mousedown', (e) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    if (window.getSelection()?.toString()) return; // don't steal focus mid-selection
    e.preventDefault();
    activeInput?.focus();
  });

  write(BANNER, '#6a9955');
  newPrompt();
}
