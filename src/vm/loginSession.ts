/**
 * vm/loginSession.ts — who is signed in to the workstation.
 *
 * Sign-in goes through the real IdP, not a shortcut. That means the login
 * screen is a live demonstration of the identity system rather than a
 * decoration: an account you disabled in Active Directory cannot sign in, one
 * you locked is refused, one you reset with "must change at next logon" is
 * stopped and asked to choose a new password, and an MFA-registered account is
 * challenged.
 *
 * It also decides what the desktop contains. IT staff get Active Directory,
 * the terminal and the script editor; everyone else gets an ordinary corporate
 * desktop — the same distinction a real estate of workstations has.
 */
import type { MfaMethod, User, UserId } from '@/domain';
import type { VmServices } from './session';
import { isIdentityAdmin } from '@/config/desktopProfiles';

export type SignInOutcome =
  | { ok: true; user: User; isIT: boolean }
  | { ok: false; reason: SignInFailure; message: string; user?: User };

export type SignInFailure =
  | 'bad-password'
  | 'disabled'
  | 'locked'
  | 'must-change-password'
  | 'mfa-required'
  | 'conditional-block'
  | 'unknown';

/** What the sign-in screen should say for each refusal. */
const MESSAGES: Record<SignInFailure, string> = {
  'bad-password': "The user name or password is incorrect. Try again.",
  disabled: 'Your account has been disabled. Please see your system administrator.',
  locked: 'Your account is locked out. Please see your system administrator.',
  'must-change-password': 'You must change your password before signing in.',
  'mfa-required': 'Additional verification is required.',
  'conditional-block': 'Sign-in blocked by a conditional access policy.',
  unknown: 'Sign-in failed.',
};

export class LoginSession {
  private current: User | null = null;
  private sessionId: string | null = null;
  private listeners = new Set<() => void>();

  constructor(private readonly services: VmServices) {}

  get user(): User | null {
    return this.current;
  }

  get isSignedIn(): boolean {
    return this.current !== null;
  }

  /** The signed-in user's department, which decides their desktop. */
  get department(): string {
    return this.current?.department ?? '';
  }

  /** Whether this user administers identity — IT and Help Desk do. */
  get isIT(): boolean {
    return this.current ? isIdentityAdmin(this.current.department) : false;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  /**
   * Authenticate against the IdP.
   *
   * MFA is completed here rather than prompted separately: the challenge is
   * already modelled by the IdP, and a second screen would add ceremony
   * without teaching anything the console does not already show.
   */
  signIn(username: string, password: string): SignInOutcome {
    const result = this.services.idp.signIn(username, password);

    if (!result.ok) {
      const reason = (result.reason ?? 'unknown') as SignInFailure;
      return {
        ok: false,
        reason,
        message: MESSAGES[reason] ?? MESSAGES.unknown,
        ...(this.services.dir.getUserByUsername(username)
          ? { user: this.services.dir.getUserByUsername(username)! }
          : {}),
      };
    }

    if (result.user.mfa !== 'none') {
      const mfa = this.services.idp.completeMfa(result.session.id, result.user.mfa as MfaMethod);
      if (!mfa.ok) {
        return { ok: false, reason: 'mfa-required', message: MESSAGES['mfa-required'] };
      }
    }

    this.services.dir.recordSignIn(result.user.id);
    this.current = result.user;
    this.sessionId = result.session.id;
    this.notify();
    return { ok: true, user: result.user, isIT: this.isIT };
  }

  /**
   * Let a user clear a forced password change from the sign-in screen, the way
   * Windows does. Without this, an admin reset would lock the account out of
   * the workstation entirely with no way back.
   */
  changePassword(username: string, currentPassword: string, newPassword: string): boolean {
    const u = this.services.dir.getUserByUsername(username);
    if (!u) return false;
    return this.services.idp.changeOwnPassword(u.id, currentPassword, newPassword);
  }

  /** End the session and revoke it at the IdP, as a real sign-out does. */
  signOut(): void {
    if (this.current && this.sessionId) {
      this.services.idp.signOut(this.sessionId as never, this.current.id as UserId);
    }
    this.current = null;
    this.sessionId = null;
    this.notify();
  }

  /** Accounts offered on the sign-in screen. Disabled ones are shown but will
   *  be refused — hiding them would hide the consequence of disabling them. */
  listAccounts(): User[] {
    return this.services.dir
      .listUsers()
      .filter((u) => !u.username.startsWith('svc-'))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }
}
