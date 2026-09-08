/**
 * main.ts — boots the workstation.
 *
 * Order matters: the lock screen comes first, and the desktop is only built
 * once someone has actually authenticated against the IdP. What they then see
 * depends on who they are — IT and Security get Active Directory, the terminal
 * and the script editor; everyone else gets an ordinary corporate desktop.
 *
 * That makes the login screen part of the simulation rather than a doorway:
 * disable an account in Active Directory, sign out, and watch it be refused.
 */
import { createDesktopOverlay } from '@/ui/desktopOverlay';
import { createLoginScreen } from '@/ui/loginScreen';
import { session } from '@/vm/session';
import { login, LoginSession } from '@/vm/loginSession';
import type { VmSession } from '@/vm/session';
import { logoffChime } from '@/ui/sounds';
import { applyTheme } from '@/ui/themes';
import { installAppChrome } from '@/ui/appChrome';
import { startUpdateNotifier } from '@/ui/updateNotifier';
import { installCaptureSourcePicker } from '@/ui/captureSourcePicker';

// Before anything paints: the windows reference these variables in about a
// hundred places and nothing defined them, so every one resolved to nothing.
applyTheme();

// The shared window chrome. Installed once at boot rather than per window: a
// rule that only exists after the right window has been opened is a rule that
// does not exist, and the baseline it carries fixes typography in every window
// without any of them being edited.
installAppChrome();

const appEl = document.getElementById('app');
if (!appEl) throw new Error('[vm] #app container is missing from index.html');

const desktop = createDesktopOverlay();

/** The desktop is typed against the lab's Conductor; the session provides the
 *  same services, and every window only ever used it as a type. */
type ShowArg = Parameters<typeof desktop.show>[0];

function showDesktop(): void {
  desktop.show(session as unknown as ShowArg, login.department, login.user?.username);
}

function signOut(): void {
  logoffChime();
  login.signOut();
  desktop.hide();
  loginScreen.present();
}

const loginScreen = createLoginScreen(login, showDesktop);

// The desktop's Exit button means "sign out" here — there is nowhere else to go.
desktop.onExit = signOut;

loginScreen.present();

// Watch for updates and say so.
//
// This has to be at the top level. It first landed inside signOut(), which is
// syntactically fine and completely dead: the subscription was only wired when
// somebody signed out, so the one moment it mattered — an update arriving while
// you work — was the one moment nothing was listening.
startUpdateNotifier();

// Answer the main process when it asks which screen to share. Installed at the
// top level for the same reason: the question arrives while the recorder is
// starting, and a listener wired inside some other flow would not be there yet.
installCaptureSourcePicker();

/** Dev/test hook. */
(
  window as unknown as {
    __vm: { session: VmSession; login: LoginSession; signOut(): void; reset(): void };
  }
).__vm = {
  session,
  login,
  signOut,
  reset: () => {
    session.reset();
    if (login.isSignedIn) showDesktop();
  },
};
