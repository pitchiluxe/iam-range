/**
 * ui/consoles/iam/capabilitySection.ts — renders any IamCapability as a form.
 *
 * The console used to hard-code one block of DOM per action, which is how it
 * drifted out of step with the ticket queue: `password-reset` was the most
 * common ticket in the app and no control existed to resolve it. Sections are
 * now generated from the capability registry, so declaring a capability is
 * enough to make it reachable — there is no second place to remember.
 */
import type { CapabilityContext, IamCapability, CapabilityParam } from '@/services';
import type { MockDirectory } from '@/services';

export interface CapabilitySectionDeps {
  ctx: CapabilityContext;
  dir: MockDirectory;
  /** Called after a successful action so the step validators and score see it. */
  onSuccess(cap: IamCapability, message: string): void;
  /** Called after any action so the console can re-read directory state. */
  refresh(): void;
}

const LABEL_CSS =
  'display:block;font-size:10px;text-transform:uppercase;letter-spacing:.5px;' +
  'color:var(--muted);margin-bottom:3px;';
const FIELD_CSS =
  'background:#0e1116;color:var(--fg);border:1px solid var(--border);' +
  'border-radius:3px;padding:5px 7px;font-size:12px;min-width:150px;';

function h3(text: string, synopsis: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'margin:14px 0 6px;';
  const h = document.createElement('div');
  h.textContent = text;
  h.style.cssText = 'color:var(--accent);font-size:13px;font-weight:600;';
  const p = document.createElement('div');
  p.textContent = synopsis;
  p.style.cssText = 'color:var(--muted);font-size:11px;margin-top:2px;';
  wrap.append(h, p);
  return wrap;
}

/** Build the input for one parameter. Returns the element plus a value reader,
 *  so the caller never has to know which kind of control it got. */
function buildField(
  param: CapabilityParam,
  dir: MockDirectory,
): { el: HTMLElement; read(): string } {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;';
  const label = document.createElement('label');
  label.textContent = param.label + (param.required ? ' *' : '');
  label.style.cssText = LABEL_CSS;
  wrap.appendChild(label);

  // Directory-backed params become pickers, so the learner can't mistype an
  // identity — and so the console shows them what exists.
  const optionsFor = (): string[] => {
    if (param.kind === 'user') return dir.listUsers().map((u) => u.username);
    if (param.kind === 'group') return dir.listGroups().map((g) => g.name);
    if (param.kind === 'role') return dir.listRoles().map((r) => r.name);
    return [...(param.options ?? [])];
  };

  if (
    param.kind === 'user' ||
    param.kind === 'group' ||
    param.kind === 'role' ||
    param.kind === 'enum'
  ) {
    const sel = document.createElement('select');
    sel.style.cssText = FIELD_CSS;
    if (!param.required) sel.appendChild(new Option('— none —', ''));
    for (const o of optionsFor()) sel.appendChild(new Option(o, o));
    wrap.appendChild(sel);
    return { el: wrap, read: () => sel.value };
  }

  if (param.kind === 'bool') {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.style.cssText = 'width:16px;height:16px;accent-color:var(--accent);margin-top:4px;';
    wrap.appendChild(cb);
    return { el: wrap, read: () => (cb.checked ? 'true' : 'false') };
  }

  const input = document.createElement('input');
  input.type = param.kind === 'password' ? 'password' : 'text';
  input.placeholder = param.label.toLowerCase();
  input.style.cssText = FIELD_CSS;
  wrap.appendChild(input);
  return { el: wrap, read: () => input.value };
}

/** Render one capability as a labelled form with a run button. */
export function renderCapabilityForm(
  parent: HTMLElement,
  cap: IamCapability,
  deps: CapabilitySectionDeps,
): void {
  parent.appendChild(h3(cap.label, cap.synopsis));

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;';
  const readers = cap.params.map((p) => {
    const f = buildField(p, deps.dir);
    row.appendChild(f.el);
    return { name: p.name, read: f.read, required: p.required, label: p.label };
  });

  const result = document.createElement('div');
  result.style.cssText = 'font-size:11px;margin-top:5px;min-height:14px;';

  const go = document.createElement('button');
  go.textContent = cap.readOnly ? 'Run' : cap.label;
  go.style.cssText =
    'background:var(--accent);color:#06231d;border:none;border-radius:3px;' +
    'padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer;';
  go.addEventListener('click', () => {
    const args: Record<string, string> = {};
    for (const r of readers) args[r.name] = r.read().trim();

    const missing = readers.filter((r) => r.required && !args[r.name]);
    if (missing.length > 0) {
      result.textContent = `${missing[0]!.label} is required.`;
      result.style.color = 'var(--err)';
      return;
    }

    const res = cap.run(deps.ctx, args);
    if (!res.ok) {
      result.textContent = res.error;
      result.style.color = 'var(--err)';
      return;
    }
    result.textContent = res.message;
    result.style.color = 'var(--accent)';
    if (res.rows && res.rows.length > 0) {
      result.appendChild(buildTable(res.rows));
    }
    if (!cap.readOnly) {
      deps.onSuccess(cap, res.message);
      deps.refresh();
    }
  });

  row.appendChild(go);
  parent.appendChild(row);
  parent.appendChild(result);
}

/** Render a capability's `rows` as a compact table (Get-* results). */
function buildTable(rows: Record<string, unknown>[]): HTMLElement {
  const table = document.createElement('table');
  table.style.cssText =
    'width:100%;border-collapse:collapse;margin-top:6px;font-size:11px;color:var(--fg);';
  const cols = Object.keys(rows[0]!);

  const thead = document.createElement('tr');
  for (const c of cols) {
    const th = document.createElement('th');
    th.textContent = c;
    th.style.cssText =
      'text-align:left;padding:3px 6px;border-bottom:1px solid var(--border);' +
      'color:var(--muted);font-weight:600;';
    thead.appendChild(th);
  }
  table.appendChild(thead);

  for (const r of rows) {
    const tr = document.createElement('tr');
    for (const c of cols) {
      const td = document.createElement('td');
      td.textContent = String(r[c] ?? '—');
      td.style.cssText = 'padding:3px 6px;border-bottom:1px solid #1b1f24;';
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }
  return table;
}
