/**
 * ui/consoles/hostPowerShellWindow.ts — real Windows PowerShell on this PC.
 *
 * The simulated PowerShell window answers the ActiveDirectory module against
 * the workstation's own directory. This one is the real powershell.exe, for
 * the work the simulator cannot do: Install-Module, Connect-MgGraph,
 * Invoke-RestMethod against Microsoft Graph, python -m http.server for the
 * Lab 12 dashboard. The desktop app's main process runs it (see 'pwsh:*' in
 * electron/main.cjs); in a plain browser there is no such process, and the
 * window says so.
 *
 * Enter runs the block, Shift+Enter adds a line, so a pasted function runs as
 * one unit. While a command waits in Read-Host the box becomes the answer
 * field — masked when the script asked for a secret.
 */

type Bridge = {
  invoke: (cmd: string, ...args: unknown[]) => Promise<unknown>;
  onPwshEvent?: (fn: (id: number, kind: string, data: unknown) => void) => () => void;
};

function bridge(): Bridge | null {
  const e = (window as unknown as { electron?: Bridge }).electron;
  return e?.invoke && e.onPwshEvent ? e : null;
}

const STYLES = `
.hps-root{display:flex;flex-direction:column;height:100%;background:#012456;color:#eeedf0;font-family:Consolas,'Cascadia Mono',monospace;font-size:12.5px;}
.hps-bar{flex-shrink:0;display:flex;gap:6px;align-items:center;padding:5px 8px;background:#001a3d;border-bottom:1px solid #0b3b7a;font-family:"Segoe UI",system-ui,sans-serif;font-size:11.5px;}
.hps-bar span{color:#9fb7da;margin-right:auto;}
.hps-bar button{padding:3px 10px;border-radius:3px;border:1px solid #2a5aa0;background:#07306a;color:#fff;font:inherit;cursor:pointer;}
.hps-bar button:hover{background:#0b3f8a;}
.hps-out{flex:1;min-height:0;overflow:auto;padding:8px 10px;white-space:pre-wrap;word-break:break-word;line-height:1.4;}
.hps-err{color:#ff8a8a;}
.hps-cmd{color:#ffff8a;}
.hps-sys{color:#9fb7da;}
.hps-in{flex-shrink:0;display:flex;gap:6px;align-items:flex-start;padding:6px 10px;border-top:1px solid #0b3b7a;background:#001a3d;}
.hps-prompt{padding-top:4px;white-space:nowrap;color:#eeedf0;}
.hps-in textarea,.hps-in input{flex:1;min-height:22px;max-height:180px;resize:vertical;background:#012456;color:#fff;border:1px solid #2a5aa0;border-radius:3px;padding:4px 6px;font:inherit;outline:none;}
`;

const MAX_OUTPUT_CHARS = 400_000;

export function renderHostPowerShellWindow(body: HTMLElement): void {
  if (!document.getElementById('hps-css')) {
    const style = document.createElement('style');
    style.id = 'hps-css';
    style.textContent = STYLES;
    document.head.appendChild(style);
  }
  body.innerHTML = '';
  Object.assign(body.style, { overflow: 'hidden', flex: '1', minHeight: '0' });

  const root = document.createElement('div');
  root.className = 'hps-root';
  const bar = document.createElement('div');
  bar.className = 'hps-bar';
  const info = document.createElement('span');
  info.textContent = 'Windows PowerShell on this PC · Enter runs · Shift+Enter new line';
  const stopBtn = document.createElement('button');
  stopBtn.textContent = 'Stop';
  stopBtn.title = 'Stop the running command (restarts the session)';
  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'Clear';
  const restartBtn = document.createElement('button');
  restartBtn.textContent = 'New session';
  bar.append(info, stopBtn, clearBtn, restartBtn);

  const out = document.createElement('div');
  out.className = 'hps-out';
  const inRow = document.createElement('div');
  inRow.className = 'hps-in';
  const prompt = document.createElement('span');
  prompt.className = 'hps-prompt';
  const editor = document.createElement('textarea');
  editor.rows = 1;
  editor.spellcheck = false;
  editor.placeholder = 'Type or paste PowerShell…';
  const answer = document.createElement('input');
  answer.style.display = 'none';
  inRow.append(prompt, editor, answer);
  root.append(bar, out, inRow);
  body.appendChild(root);

  const write = (text: string, cls?: string): void => {
    const span = document.createElement('span');
    if (cls) span.className = cls;
    span.textContent = text; // output is untrusted text, never HTML
    out.appendChild(span);
    while ((out.textContent?.length ?? 0) > MAX_OUTPUT_CHARS && out.firstChild) out.firstChild.remove();
    out.scrollTop = out.scrollHeight;
  };

  const b = bridge();
  if (!b) {
    write(
      'The real PowerShell console runs in the IAM Range desktop app, which can start\n' +
        'powershell.exe on this computer. A web browser cannot.\n\n' +
        'Install and open the desktop app, or use Windows PowerShell directly for the\n' +
        'Entra ID and Microsoft Graph labs. The simulated PowerShell window still\n' +
        'handles every Active Directory step.\n',
      'hps-sys',
    );
    editor.disabled = true;
    inRow.style.display = 'none';
    for (const btn of [stopBtn, clearBtn, restartBtn]) btn.style.display = 'none';
    return;
  }

  let sessionId: number | null = null;
  let busy = true;
  let cwd = '';
  const history: string[] = [];
  let historyPos = 0;

  const setBusy = (v: boolean): void => {
    busy = v;
    editor.disabled = v;
    prompt.textContent = v ? '…' : `PS ${cwd}>`;
    if (!v) {
      answer.style.display = 'none';
      editor.style.display = '';
      editor.focus();
    }
  };

  const unsubscribe = b.onPwshEvent!((id, kind, data) => {
    if (!root.isConnected) {
      unsubscribe();
      if (sessionId !== null) void b.invoke('pwsh:stop', sessionId);
      return;
    }
    if (id !== sessionId) return;
    if (kind === 'out') write(String(data));
    else if (kind === 'err') write(String(data), 'hps-err');
    else if (kind === 'done') {
      cwd = String(data);
      setBusy(false);
    } else if (kind === 'ask') {
      // Read-Host is waiting: the answer box replaces the editor until it returns.
      editor.style.display = 'none';
      answer.type = data ? 'password' : 'text';
      answer.value = '';
      answer.style.display = '';
      answer.focus();
    } else if (kind === 'exit') {
      write(`\n[PowerShell exited${data === null ? '' : ` with code ${String(data)}`}. Click New session.]\n`, 'hps-sys');
      sessionId = null;
      busy = true;
      editor.disabled = true;
      prompt.textContent = '';
    }
  });

  const start = async (): Promise<void> => {
    setBusy(true);
    write('Starting Windows PowerShell…\n', 'hps-sys');
    const res = (await b.invoke('pwsh:start')) as { id?: number; error?: string };
    if (res?.error || !res?.id) {
      write(`${res?.error ?? 'Could not start PowerShell.'}\n`, 'hps-err');
      return;
    }
    sessionId = res.id;
  };

  const runBlock = (code: string): void => {
    if (busy || sessionId === null || !code.trim()) return;
    history.push(code);
    historyPos = history.length;
    write(`PS ${cwd}> `, 'hps-sys');
    write(`${code}\n`, 'hps-cmd');
    editor.value = '';
    editor.rows = 1;
    setBusy(true);
    void b.invoke('pwsh:run', sessionId, code);
  };

  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      runBlock(editor.value);
    } else if (e.key === 'ArrowUp' && !editor.value.includes('\n') && historyPos > 0) {
      e.preventDefault();
      editor.value = history[--historyPos]!;
    } else if (e.key === 'ArrowDown' && !editor.value.includes('\n') && historyPos < history.length) {
      e.preventDefault();
      editor.value = history[++historyPos] ?? '';
    }
  });
  editor.addEventListener('input', () => {
    editor.rows = Math.min(10, editor.value.split('\n').length);
  });

  answer.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || sessionId === null) return;
    e.preventDefault();
    // Secrets are never echoed into the transcript.
    write(answer.type === 'password' ? '••••••••\n' : `${answer.value}\n`, 'hps-cmd');
    void b.invoke('pwsh:input', sessionId, answer.value);
    answer.value = '';
    answer.style.display = 'none';
  });

  const restart = async (): Promise<void> => {
    if (sessionId !== null) await b.invoke('pwsh:stop', sessionId);
    sessionId = null;
    await start();
  };
  stopBtn.addEventListener('click', () => {
    write('\n[Stopped. Variables and functions from this session are gone.]\n', 'hps-sys');
    void restart();
  });
  restartBtn.addEventListener('click', () => void restart());
  clearBtn.addEventListener('click', () => {
    out.innerHTML = '';
  });

  void start();
}
