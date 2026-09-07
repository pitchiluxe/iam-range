/**
 * tests/updateNotifier.test.ts — the notifier has to actually run.
 *
 * `startUpdateNotifier()` was called from inside `signOut()`. That compiles,
 * lints, type-checks and does nothing: the subscription was wired only when
 * somebody signed out, so the one moment an update notice matters — a new
 * version arriving while you work — was the one moment nothing was listening.
 *
 * It is the same failure the audit log and the capability registry are guarded
 * against elsewhere in this project: the code exists, reads correctly, and is
 * never reached. Nothing in the type system can see it, so it is asserted here
 * instead — the call must sit at the top level of main.ts, not nested inside a
 * function that boot never invokes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MAIN = readFileSync(join(process.cwd(), 'src', 'main.ts'), 'utf8');

/**
 * Strip every braced block, leaving only statements at file scope.
 *
 * Crude, and enough: a call surviving this is unconditionally executed when
 * the module loads, which is exactly the property being asserted.
 */
function topLevelOnly(source: string): string {
  let depth = 0;
  let out = '';
  for (const ch of source) {
    if (ch === '{') depth += 1;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0) out += ch;
  }
  return out;
}

describe('update notifier wiring', () => {
  it('starts at boot, not inside a function body', () => {
    expect(MAIN).toContain('startUpdateNotifier');
    expect(topLevelOnly(MAIN)).toContain('startUpdateNotifier()');
  });

  it('is imported from the module that owns it', () => {
    expect(MAIN).toMatch(/import \{ startUpdateNotifier \} from '@\/ui\/updateNotifier'/);
  });

  it('wires the bridge itself rather than relying on Settings having been opened', () => {
    const notifier = readFileSync(
      join(process.cwd(), 'src', 'ui', 'updateNotifier.ts'),
      'utf8',
    );
    // updateManager.install() is what subscribes to the main process. It used
    // to be called only by the Settings window, so the updater broadcast into
    // a void unless the user went looking.
    expect(notifier).toContain('updateManager.install()');
    expect(notifier).toContain('updateManager.subscribe(');
  });
});
