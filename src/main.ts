/**
 * main.ts — boots the standalone IAM operator workstation.
 *
 * The 3D lab reaches this desktop by walking to a workstation mesh and pressing
 * E. Here the desktop *is* the application: it fills the window at start-up and
 * never closes, backed by a seeded VmSession rather than a lab.
 */
import { createDesktopOverlay } from '@/ui/desktopOverlay';
import { session } from '@/vm/session';
import type { VmSession } from '@/vm/session';

const appEl = document.getElementById('app');
if (!appEl) throw new Error('[vm] #app container is missing from index.html');

const desktop = createDesktopOverlay();

// `show()` is typed against the lab's Conductor, but every window only ever
// used it through `import type` and touches the seven service properties this
// session also provides. The cast is the one place that fiction is admitted.
desktop.show(session as unknown as Parameters<typeof desktop.show>[0]);

// There is nowhere to exit *to* — closing the desktop would leave a blank
// page — so re-show it if anything asks it to close.
desktop.onExit = () => {
  desktop.show(session as unknown as Parameters<typeof desktop.show>[0]);
};

/** Dev/test hook, mirroring `window.__lab` in the 3D app. */
(window as unknown as { __vm: { session: VmSession; reset(): void } }).__vm = {
  session,
  reset: () => {
    session.reset();
    desktop.show(session as unknown as Parameters<typeof desktop.show>[0]);
  },
};
