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
    background: '#1a1d22',
    flex: '1',
    minHeight: '0',
  });

  if (!conductor.dir || !conductor.idp || !conductor.audit || !conductor.tickets) {
    body.style.padding = '24px';
    const msg = document.createElement('div');
    msg.style.cssText = 'color:#8b95a1;font-size:13px;font-family:Consolas,monospace;';
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
          actor: 'system' as UserId,
        }
      : null;

  const root = document.createElement('div');
  root.style.cssText = 'display:flex;height:100%;font-size:12px;color:#c8cdd3;min-height:0;';
  body.appendChild(root);

  // ── Template gallery ──────────────────────────────────────────────────────
  const gallery = document.createElement('div');
  gallery.style.cssText =
    'width:220px;flex-shrink:0;background:#12151a;border-right:1px solid #2d343d;' +
    'overflow-y:auto;padding:10px 0;';
  root.appendChild(gallery);

  // ── Editor + output ───────────────────────────────────────────────────────
  const right = document.createElement('div');
  right.style.cssText = 'flex:1;display:flex;flex-direction:column;min-width:0;min-height:0;';
  root.appendChild(right);

  const toolbar = document.createElement('div');
  toolbar.style.cssText =
    'display:flex;align-items:center;gap:8px;padding:8px 10px;background:#232830;' +
    'border-bottom:1px solid #2d343d;flex-shrink:0;';
  right.appendChild(toolbar);

  const scriptName = document.createElement('input');
  scriptName.type = 'text';
  scriptName.value = 'Untitled.ps1';
  scriptName.style.cssText =
    'flex:1;min-width:0;background:#0e1116;color:#e6e6e6;border:1px solid #2d343d;' +
    'border-radius:4px;padding:4px 8px;font-size:11.5px;font-family:Consolas,monospace;outline:none;';

  const mkBtn = (label: string, primary = false): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText =
      `border:none;border-radius:4px;padding:5px 12px;font-size:11.5px;cursor:pointer;` +
      `font-weight:600;flex-shrink:0;` +
      (primary ? 'background:#4ec9b0;color:#06231d;' : 'background:#2d343d;color:#c8cdd3;');
    return b;
  };
  const runBtn = mkBtn('▶ Run', true);
  const saveBtn = mkBtn('Save as template');
  const clearBtn = mkBtn('Clear');
  toolbar.append(scriptName, runBtn, saveBtn, clearBtn);

  const editor = document.createElement('textarea');
  editor.spellcheck = false;
  editor.style.cssText =
    'flex:1;min-height:0;background:#0c0c0c;color:#ccc;border:none;outline:none;resize:none;' +
    "padding:12px;font-family:Consolas,'Cascadia Mono',monospace;font-size:12.5px;line-height:1.5;" +
    'tab-size:2;';
  editor.value = SCRIPT_TEMPLATES[0]!.body;
  right.appendChild(editor);

  const output = document.createElement('div');
  output.style.cssText =
    'height:38%;flex-shrink:0;overflow-y:auto;background:#0e1116;border-top:1px solid #2d343d;' +
    'padding:8px 12px;font-family:Consolas,monospace;font-size:11.5px;line-height:1.5;';
  right.appendChild(output);

  const write = (text: string, color = '#ccc'): void => {
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
        'padding:7px 8px;color:#c8cdd3;border-radius:4px;min-width:0;';
      const t = document.createElement('div');
      t.textContent = name;
      t.style.cssText = 'font-size:11.5px;color:#e6e6e6;';
      const p = document.createElement('div');
      p.textContent = purpose;
      p.style.cssText = 'font-size:10px;color:#6b7280;margin-top:2px;line-height:1.35;';
      b.append(t, p);
      b.addEventListener('mouseenter', () => (b.style.background = '#1f242b'));
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
            scriptName.value = s.name;
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
    const ctx = currentCtx();
    output.innerHTML = '';
    if (!ctx) {
      write('The identity services are not available. Reset the environment to re-seed.', '#f48771');
      return;
    }

    const res = runScript(editor.value, ctx);

    if (res.parseError) {
      // Nothing ran — say so explicitly rather than leaving the learner to
      // guess whether half the batch went through.
      write(`Script error: ${res.parseError}`, '#f48771');
      write('No commands were run.', '#f48771');
      return;
    }

    for (const { command, result } of res.results) {
      write(`PS C:\\> ${command}`, '#4ec9b0');
      if (result.output) write(result.output, result.ok ? '#ccc' : '#f48771');
    }

    write('');
    const summary = `${res.succeeded} succeeded, ${res.failed} failed.`;
    write(summary, res.ok ? '#6a9955' : '#d7ba7d');
    if (res.failed > 0) {
      write('Fix the failing lines above and re-run — the rest already applied.', '#8b95a1');
    }
  });

  saveBtn.addEventListener('click', () => {
    const name = scriptName.value.trim() || 'Untitled.ps1';
    saveScript(name, editor.value);
    renderGallery();
    write(`Saved "${name}" to My scripts.`, '#6a9955');
  });

  clearBtn.addEventListener('click', () => {
    editor.value = '';
    output.innerHTML = '';
    editor.focus();
  });

  // Ctrl+Enter runs, as in a real editor.
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      runBtn.click();
    }
  });

  renderGallery();
  write('Pick a template on the left, edit the name list, then Run (Ctrl+Enter).', '#6a9955');
}
