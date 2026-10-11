/**
 * ui/consoles/scriptEditorWindow.ts — PowerShell ISE-style script editor.
 *
 * Pick a template, edit the name list the ticket gave you, run it. Each line
 * goes through the same dispatcher a typed command does, so a script fires the
 * identical service calls, audit events and lab-step validators as doing the
 * work by hand — which is the point: the learner automates the job rather than
 * clicking twenty times, against the live directory.
 */
import type { VmServices } from '@/vm/session';
import type { UserId } from '@/domain';
import type { CapabilityContext } from '@/services';
import { runScript } from '@/terminal/script';
import {
  SCRIPT_TEMPLATES,
  loadSavedScripts,
  saveScript,
  deleteSavedScript,
  type ScriptTemplate,
} from '@/config/scriptTemplates';
import { LOAD_PS1_EVENT, takePendingPs1, type PendingPs1 } from '@/util/ps1Opener';
import { FS } from '@/terminal/shellIntrinsics';
import { VM_HOST } from '@/config/vmHost';
import { openHostScript } from '@/util/hostScriptOpener';
import { notifyEndpointChanged } from '@/util/endpointEvents';

const CATEGORY_LABEL: Record<ScriptTemplate['category'], string> = {
  provisioning: 'Provisioning',
  offboarding: 'Offboarding',
  access: 'Access',
  credentials: 'Credentials',
  audit: 'Audit',
};

export function renderScriptEditorWindow(body: HTMLElement, conductor: VmServices): void {
  body.innerHTML = '';
  Object.assign(body.style, {
    overflow: 'hidden',
    background: 'var(--panel)',
    flex: '1',
    minHeight: '0',
  });

  if (!conductor.dir || !conductor.idp || !conductor.audit || !conductor.tickets) {
    body.style.padding = '24px';
    const msg = document.createElement('div');
    msg.style.cssText = 'color:var(--muted);font-size:13px;font-family:Consolas,monospace;';
    msg.textContent = 'The identity services are not available. Reset the environment to re-seed.';
    body.appendChild(msg);
    return;
  }

  /** Resolved per run: VmServices.start() replaces the service instances. */
  const currentCtx = (): CapabilityContext | null =>
    conductor.dir && conductor.idp && conductor.audit && conductor.tickets
      ? {
          dir: conductor.dir,
          idp: conductor.idp,
          tickets: conductor.tickets,
          audit: conductor.audit,
          pim: conductor.pim,
      cloud: conductor.cloud,
          endpoints: conductor.endpoints,
          actor: 'system' as UserId,
        }
      : null;

  const root = document.createElement('div');
  root.style.cssText = 'display:flex;height:100%;font-size:12px;color:var(--fg);min-height:0;';
  body.appendChild(root);

  // ── Template gallery ──────────────────────────────────────────────────────
  const gallery = document.createElement('div');
  gallery.style.cssText =
    'width:220px;flex-shrink:0;background:var(--panel-alt);border-right:1px solid var(--border);' +
    'overflow-y:auto;padding:10px 0;';
  root.appendChild(gallery);

  // ── Editor + output ───────────────────────────────────────────────────────
  const right = document.createElement('div');
  right.style.cssText = 'flex:1;display:flex;flex-direction:column;min-width:0;min-height:0;';
  root.appendChild(right);

  const toolbar = document.createElement('div');
  toolbar.style.cssText =
    'display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 10px;background:var(--border);' +
    'border-bottom:1px solid var(--border);flex-shrink:0;';
  right.appendChild(toolbar);

  const scriptName = document.createElement('input');
  scriptName.type = 'text';
  scriptName.value = `${SCRIPT_TEMPLATES[0]!.id}.ps1`;
  scriptName.setAttribute('aria-label', 'Script filename or workstation path');
  scriptName.style.cssText =
    'flex:1;min-width:0;background:var(--panel);color:var(--fg);border:1px solid var(--border);' +
    'border-radius:4px;padding:4px 8px;font-size:11.5px;font-family:Consolas,monospace;outline:none;';

  const mkBtn = (label: string, primary = false): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText =
      `border:none;border-radius:4px;padding:5px 12px;font-size:11.5px;cursor:pointer;` +
      `font-weight:600;flex-shrink:0;` +
      (primary ? 'background:var(--accent);color:#06231d;' : 'background:var(--border);color:var(--fg);');
    return b;
  };
  const runBtn = mkBtn('▶ Run', true);
  const saveBtn = mkBtn('Save');
  const newBtn = mkBtn('New');
  const openBtn = mkBtn('Open');
  const importBtn = mkBtn('Import .ps1');
  const exportBtn = mkBtn('Export .ps1');
  const runtime = document.createElement('select');
  runtime.setAttribute('aria-label', 'PowerShell execution environment');
  for (const [value, label] of [['directory', 'IAM Range directory'], ['host', 'Windows PowerShell on this PC']]) {
    const option = document.createElement('option'); option.value = value!; option.textContent = label!; runtime.appendChild(option);
  }
  const clearBtn = mkBtn('Clear');
  toolbar.append(scriptName, newBtn, openBtn, saveBtn, runBtn, runtime, importBtn, exportBtn, clearBtn);
  const modeNote = document.createElement('div');
  modeNote.style.cssText = 'padding:6px 10px;font-size:11px;color:var(--muted);';
  const updateMode = (): void => {
    modeNote.textContent = runtime.value === 'host'
      ? 'Runs in real Windows PowerShell on your computer. Export virtual files first and use their actual paths. Review the transferred script, then click Run script.'
      : 'Runs against the lab directory: cmdlets, scalar variables, arrays, foreach and Import-Csv. Save to Scripts or enter a full workstation path. F5 runs; Ctrl+S saves.';
  };
  runtime.addEventListener('change', updateMode); updateMode();
  right.appendChild(modeNote);

  const editor = document.createElement('textarea');
  editor.spellcheck = false;
  editor.setAttribute('aria-label', 'PowerShell script');
  editor.style.cssText =
    'flex:1;min-height:0;background:var(--panel);color:var(--fg);border:none;outline:none;resize:none;' +
    "padding:12px;font-family:Consolas,'Cascadia Mono',monospace;font-size:12.5px;line-height:1.5;" +
    'tab-size:2;';
  editor.value = SCRIPT_TEMPLATES[0]!.body;
  right.appendChild(editor);

  const output = document.createElement('div');
  output.style.cssText =
    'height:38%;flex-shrink:0;overflow-y:auto;background:var(--panel);border-top:1px solid var(--border);' +
    'padding:8px 12px;font-family:Consolas,monospace;font-size:11.5px;line-height:1.5;user-select:text;';
  right.appendChild(output);

  const write = (text: string, color = 'var(--fg)'): void => {
    const pre = document.createElement('pre');
    pre.textContent = text;
    pre.style.cssText = `margin:0;white-space:pre-wrap;word-break:break-word;color:${color};font:inherit;`;
    output.appendChild(pre);
    output.scrollTop = output.scrollHeight;
  };


  // ── Gallery rendering ─────────────────────────────────────────────────────
  function renderGallery(): void {
    gallery.innerHTML = '';

    const heading = (text: string): void => {
      const h = document.createElement('div');
      h.textContent = text;
      h.style.cssText =
        'padding:8px 12px 4px;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;' +
        'color:#6b7280;font-weight:600;';
      gallery.appendChild(h);
    };

    const entry = (
      name: string,
      purpose: string,
      onOpen: () => void,
      onDelete?: () => void,
    ): void => {
      const row = document.createElement('div');
      row.style.cssText =
        'display:flex;align-items:flex-start;gap:6px;margin:1px 6px;border-radius:4px;';
      const b = document.createElement('button');
      b.style.cssText =
        'flex:1;text-align:left;background:transparent;border:none;cursor:pointer;' +
        'padding:7px 8px;color:var(--fg);border-radius:4px;min-width:0;';
      const t = document.createElement('div');
      t.textContent = name;
      t.style.cssText = 'font-size:11.5px;color:var(--fg);';
      const p = document.createElement('div');
      p.textContent = purpose;
      p.style.cssText = 'font-size:10px;color:#6b7280;margin-top:2px;line-height:1.35;';
      b.append(t, p);
      b.addEventListener('mouseenter', () => (b.style.background = 'var(--panel-alt)'));
      b.addEventListener('mouseleave', () => (b.style.background = 'transparent'));
      b.addEventListener('click', onOpen);
      row.appendChild(b);

      if (onDelete) {
        const d = document.createElement('button');
        d.textContent = '×';
        d.title = 'Delete saved script';
        d.style.cssText =
          'background:transparent;border:none;color:#6b7280;cursor:pointer;font-size:14px;' +
          'padding:6px 6px 0 0;flex-shrink:0;';
        d.addEventListener('click', onDelete);
        row.appendChild(d);
      }
      gallery.appendChild(row);
    };

    let lastCategory: ScriptTemplate['category'] | null = null;
    for (const t of SCRIPT_TEMPLATES) {
      if (t.category !== lastCategory) {
        heading(CATEGORY_LABEL[t.category]);
        lastCategory = t.category;
      }
      entry(t.name, t.purpose, () => {
        editor.value = t.body;
        scriptName.value = `${t.id}.ps1`;
        output.innerHTML = '';
        write(`Loaded template: ${t.name}`, '#6a9955');
      });
    }

    const saved = loadSavedScripts();
    if (saved.length > 0) {
      heading('My scripts');
      for (const s of saved) {
        entry(
          s.name,
          new Date(s.savedAt).toLocaleString(),
          () => {
            editor.value = s.body;
            scriptName.value = s.path ?? s.name;
            output.innerHTML = '';
            write(`Loaded saved script: ${s.name}`, '#6a9955');
          },
          () => {
            deleteSavedScript(s.id);
            renderGallery();
          },
        );
      }
    }
  }

  // ── Actions ───────────────────────────────────────────────────────────────
  runBtn.addEventListener('click', () => {
    if (runtime.value === 'host') {
      openHostScript({ name: scriptName.value, content: editor.value });
      write('Script opened in Windows PowerShell on this PC. Review it there and click Run script.', 'var(--muted)');
      return;
    }
    const ctx = currentCtx();
    output.innerHTML = '';
    if (!ctx) {
      write('The identity services are not available. Reset the environment to re-seed.', 'var(--err)');
      return;
    }

    const res = runScript(editor.value, ctx);

    if (res.parseError) {
      // Nothing ran — say so explicitly rather than leaving the learner to
      // guess whether half the batch went through.
      write(`Script error: ${res.parseError}`, 'var(--err)');
      write('No commands were run.', 'var(--err)');
      return;
    }

    for (const { command, result } of res.results) {
      write(`PS C:\\> ${command}`, 'var(--accent)');
      if (result.output) write(result.output, result.ok ? 'var(--fg)' : 'var(--err)');
    }

    write('');
    const summary = `${res.succeeded} succeeded, ${res.failed} failed.`;
    write(summary, res.ok ? '#6a9955' : '#d7ba7d');
    if (res.failed > 0) {
      write('Fix the failing lines above and re-run — the rest already applied.', 'var(--muted)');
    }
    for (const endpoint of conductor.endpoints?.list() ?? []) notifyEndpointChanged(endpoint.name);
  });

  saveBtn.addEventListener('click', () => {
    const name = scriptName.value.trim() || 'Untitled.ps1';
    try {
      const saved = saveScript(name, editor.value);
      scriptName.value = saved.path ?? saved.name;
      renderGallery();
      write(`Saved to ${saved.path}. Run with & "${saved.path}" in Terminal, or use Run here.`, '#6a9955');
    } catch (error) { write(error instanceof Error ? error.message : String(error), 'var(--err)'); }
  });
  newBtn.addEventListener('click', () => {
    scriptName.value = 'Untitled.ps1';
    editor.value = '# Describe the task and verify the result.\nGet-ADUser -Filter * | Select-Object SamAccountName,Name,Department\n';
    output.innerHTML = ''; editor.focus();
  });
  openBtn.addEventListener('click', () => {
    const path = FS.resolvePath(scriptName.value, `C:\\Users\\${VM_HOST.user}\\Scripts`);
    const content = FS.readFile(path);
    if (content === null) { write(`Cannot find ${path}. Enter the full .ps1 path or use Import .ps1.`, 'var(--err)'); return; }
    loadFile({ name: path, content });
  });
  const fileInput = document.createElement('input');
  fileInput.type = 'file'; fileInput.accept = '.ps1'; fileInput.style.display = 'none'; right.appendChild(fileInput);
  importBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) void file.text().then(content => loadFile({ name: file.name, content })).catch(error => write(String(error), 'var(--err)'));
    fileInput.value = '';
  });
  exportBtn.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([editor.value], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url;
    link.download = scriptName.value.split(/[\\/]/).at(-1) || 'Untitled.ps1';
    link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  clearBtn.addEventListener('click', () => {
    editor.value = '';
    output.innerHTML = '';
    editor.focus();
  });

  // Ctrl+Enter runs, as in a real editor.
  editor.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveBtn.click(); }
    if (e.key === 'F5') { e.preventDefault(); runBtn.click(); }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      runBtn.click();
    }
  });

  const loadFile = (file: PendingPs1): void => {
    editor.value = file.content;
    scriptName.value = file.name;
    output.innerHTML = '';
    write(`Opened ${file.name}`, '#6a9955');
  };

  const onLoadPs1 = (e: Event): void => {
    if (!body.isConnected) {
      document.removeEventListener(LOAD_PS1_EVENT, onLoadPs1);
      return;
    }
    const detail = (e as CustomEvent<PendingPs1>).detail;
    if (detail) loadFile(detail);
  };
  document.addEventListener(LOAD_PS1_EVENT, onLoadPs1);

  const pending = takePendingPs1();
  if (pending) loadFile(pending);

  renderGallery();
  if (!pending) write('Choose New, Import .ps1, or a template. Save creates a .ps1 file on the workstation disk. Run with F5 or Ctrl+Enter.', '#6a9955');
}
