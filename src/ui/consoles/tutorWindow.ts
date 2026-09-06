/**
 * ui/consoles/tutorWindow.ts — the IAM/PIM tutor.
 *
 * A chat window, with two things a plain chat window does not have.
 *
 * The **mode switch** decides how much it gives away. Socratic is the default
 * and it asks rather than answers; you have to deliberately move to Explain or
 * Walk me through it. That friction is the point — a tutor that hands over the
 * answer on the first question has replaced the lab with a transcript.
 *
 * The **sources strip** under each reply names the articles the answer was
 * built from, and clicking one opens it in Documentation. The tutor is a small
 * local model and it will occasionally be wrong; being able to check it in one
 * click is what makes it usable anyway.
 */
import type { VmServices } from '@/vm/session';
import { readEnvironment } from '@/vm/environmentStage';
import {
  askTutor,
  tutorAvailable,
  suggestedQuestions,
  MODE_LABEL,
  type TutorAnswer,
  type TutorMode,
} from '@/vm/tutor';
import { openDocumentation } from './documentationWindow';

const MODES: TutorMode[] = ['socratic', 'explain', 'walkthrough'];

export function renderTutorWindow(body: HTMLElement, vm: VmServices): void {
  body.style.cssText =
    'display:flex;flex-direction:column;height:100%;background:#0e1116;' +
    'font-family:"Segoe UI",system-ui,sans-serif;color:#e6e6e6;';

  let mode: TutorMode = 'socratic';

  // --- Header: mode switch and whether a model is actually answering --------
  const header = document.createElement('div');
  header.style.cssText =
    'flex-shrink:0;display:flex;align-items:center;gap:10px;padding:10px 14px;' +
    'background:#1b1f24;border-bottom:1px solid #2d343d;';

  const modeWrap = document.createElement('div');
  modeWrap.style.cssText = 'display:flex;gap:4px;';
  const modeBtns = MODES.map((m) => {
    const b = document.createElement('button');
    b.textContent = MODE_LABEL[m];
    b.style.cssText =
      'padding:5px 10px;border-radius:4px;border:1px solid #2d343d;cursor:pointer;' +
      'font-size:11px;background:#0e1116;color:#8b95a1;';
    b.onclick = () => {
      mode = m;
      paintModes();
    };
    modeWrap.appendChild(b);
    return { m, b };
  });
  function paintModes(): void {
    for (const { m, b } of modeBtns) {
      const on = m === mode;
      b.style.background = on ? '#2563eb' : '#0e1116';
      b.style.color = on ? '#fff' : '#8b95a1';
      b.style.borderColor = on ? '#2563eb' : '#2d343d';
    }
  }
  paintModes();

  const status = document.createElement('span');
  status.style.cssText = 'margin-left:auto;font-size:11px;color:#8b95a1;';
  status.textContent = 'Checking for Ollama…';

  header.append(modeWrap, status);
  body.appendChild(header);

  // The badge is honest about which tutor you are talking to, because the two
  // behave differently and a learner should know which one they are reading.
  void tutorAvailable().then((up) => {
    status.textContent = up ? '● Ollama connected' : '○ Offline — answers quote the docs';
    status.style.color = up ? '#4ec9b0' : '#8b95a1';
  });

  // --- Transcript -----------------------------------------------------------
  const log = document.createElement('div');
  log.style.cssText = 'flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:12px;';
  body.appendChild(log);

  function bubble(who: 'you' | 'tutor', text: string): HTMLElement {
    const wrap = document.createElement('div');
    wrap.style.cssText =
      'max-width:82%;padding:10px 12px;border-radius:8px;font-size:12.5px;line-height:1.6;' +
      'white-space:pre-wrap;' +
      (who === 'you'
        ? 'align-self:flex-end;background:#2563eb;color:#fff;'
        : 'align-self:flex-start;background:#161b22;border:1px solid #2d343d;');
    wrap.textContent = text;
    log.appendChild(wrap);
    log.scrollTop = log.scrollHeight;
    return wrap;
  }

  /** Sources strip: the claim that the answer is grounded, made checkable. */
  function citations(answer: TutorAnswer): void {
    if (answer.citations.length === 0) return;
    const strip = document.createElement('div');
    strip.style.cssText =
      'align-self:flex-start;display:flex;flex-wrap:wrap;gap:6px;align-items:center;' +
      'margin-top:-6px;font-size:10.5px;color:#8b95a1;';
    strip.appendChild(document.createTextNode('Sources:'));
    for (const a of answer.citations) {
      const chip = document.createElement('button');
      chip.textContent = a.title;
      chip.style.cssText =
        'padding:3px 8px;border-radius:10px;border:1px solid #2d343d;background:#0e1116;' +
        'color:#4ec9b0;cursor:pointer;font-size:10.5px;';
      chip.onclick = () => openDocumentation(a.id);
      strip.appendChild(chip);
    }
    log.appendChild(strip);
    log.scrollTop = log.scrollHeight;
  }

  const env = readEnvironment(vm.dir);
  bubble(
    'tutor',
    'I am the tutor for this workstation. I know what state your domain is in and which ' +
      'ticket you are on, and I answer from the material in Documentation.\n\n' +
      'By default I will ask rather than tell. Switch to "Explain the concept" or ' +
      '"Walk me through it" when you want more.',
  );

  // --- Suggested openers ----------------------------------------------------
  const suggestions = document.createElement('div');
  suggestions.style.cssText =
    'flex-shrink:0;display:flex;flex-wrap:wrap;gap:6px;padding:0 14px 10px;';
  for (const q of suggestedQuestions(env)) {
    const chip = document.createElement('button');
    chip.textContent = q;
    chip.style.cssText =
      'padding:5px 10px;border-radius:12px;border:1px solid #2d343d;background:#161b22;' +
      'color:#c9d1d9;cursor:pointer;font-size:11px;text-align:left;';
    chip.onclick = () => {
      input.value = q;
      void send();
    };
    suggestions.appendChild(chip);
  }
  body.appendChild(suggestions);

  // --- Composer -------------------------------------------------------------
  const composer = document.createElement('div');
  composer.style.cssText =
    'flex-shrink:0;display:flex;gap:8px;padding:10px 14px;background:#1b1f24;' +
    'border-top:1px solid #2d343d;';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Ask about this ticket, or about IAM and PIM…';
  input.style.cssText =
    'flex:1;padding:8px 10px;border-radius:4px;border:1px solid #2d343d;background:#0e1116;' +
    'color:#e6e6e6;font-size:12.5px;outline:none;';

  const sendBtn = document.createElement('button');
  sendBtn.textContent = 'Ask';
  sendBtn.style.cssText =
    'padding:8px 16px;border-radius:4px;border:none;background:#2563eb;color:#fff;' +
    'cursor:pointer;font-size:12px;';

  composer.append(input, sendBtn);
  body.appendChild(composer);

  let busy = false;

  async function send(): Promise<void> {
    const question = input.value.trim();
    if (!question || busy) return;
    busy = true;
    input.value = '';
    sendBtn.disabled = true;
    sendBtn.textContent = 'Thinking…';
    suggestions.remove();

    bubble('you', question);
    const pending = bubble('tutor', '…');

    // The ticket is read at ask time, not window-open time: the learner will
    // pick a different one mid-conversation and expect the tutor to notice.
    const open = vm.tickets.list().find((t) => t.status !== 'resolved');
    const answer = await askTutor(question, {
      env: readEnvironment(vm.dir),
      mode,
      ...(open ? { ticket: { subject: open.subject, body: open.body } } : {}),
    });

    pending.textContent = answer.text;
    citations(answer);

    busy = false;
    sendBtn.disabled = false;
    sendBtn.textContent = 'Ask';
    input.focus();
  }

  sendBtn.onclick = () => void send();
  input.onkeydown = (e) => {
    if (e.key === 'Enter') void send();
  };
  setTimeout(() => input.focus(), 50);
}
