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

const appEl = document.getElementById('app');
if (!appEl) throw new Error('[vm] #app container is missing from index.html');

const desktop = createDesktopOverlay();

/** The desktop is typed against the lab's Conductor; the session provides the
 *  same services, and every window only ever used it as a type. */
type ShowArg = Parameters<typeof desktop.show>[0];

function showDesktop(): void {
  desktop.show(session as unknown as ShowArg, login.department);
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
