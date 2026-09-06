/**
 * ui/consoles/appPortalWindow.ts — the Northwind SSO application portal.
 *
 * The "MyApps" page an end user lands on after signing in. Clicking a tile runs
 * a real SSO attempt through MockAppServer.ssoLogin(), and the page you get
 * back reflects what the learner actually configured:
 *
 *   success + SAML   the assertion POST, with issuer, entity id and ACS URL
 *   success + OIDC   the consent screen, with client id and the claims released
 *   mfa-required     the MFA prompt the app's policy demands
 *   missing-role     Access Denied, naming the role the app requires
 *   config faults    the protocol error a real IdP returns, with the mismatch
 *
 * That is what makes this an observation surface rather than set dressing: a
 * broken SAML config in lab07 produces a visibly different page from a working
 * one, so the learner can see their fix land instead of taking it on trust.
 */
import type { VmServices } from '@/vm/session';
import type { AppId, Application, User } from '@/domain';

/** Failure reasons from ssoLogin, rendered as the page a user would meet. */
const FAILURE_PAGES: Record<
  string,
  { title: string; detail: string; hint: string; tone: 'denied' | 'error' | 'mfa' }
> = {
  'user-disabled': {
    title: 'Account disabled',
    detail: 'This account has been disabled by an administrator.',
    hint: 'Expected after a leaver or termination ticket is actioned.',
    tone: 'denied',
  },
  'missing-role': {
    title: 'Access denied',
    detail: 'Your account is not assigned a role this application requires.',
    hint: 'Grant the required role, or add the user to a group that carries it.',
    tone: 'denied',
  },
  'mfa-required': {
    title: 'Additional verification required',
    detail: 'This application requires multi-factor authentication.',
    hint: 'The account has no MFA method registered — enrol one in the IAM Console.',
    tone: 'mfa',
  },
  'invalid-redirect-uri': {
    title: 'Error: redirect_uri_mismatch',
    detail: 'The redirect URI in the request does not match the one registered for this client.',
    hint: 'Compare the registered redirect URI against what the app sends.',
    tone: 'error',
  },
  'expired-cert': {
    title: 'Error: signature validation failed',
    detail: 'The signing certificate presented by the identity provider has expired.',
    hint: 'Rotate the SAML signing certificate.',
    tone: 'error',
  },
  'wrong-issuer': {
    title: 'Error: invalid issuer',
    detail: 'The issuer in the assertion does not match the value this application trusts.',
    hint: 'Align the issuer / entity id on both sides.',
    tone: 'error',
  },
  'wrong-client-secret': {
    title: 'Error: invalid_client',
    detail: 'Client authentication failed — the client secret does not match.',
    hint: 'Regenerate the secret and update the application configuration.',
    tone: 'error',
  },
  'claim-mismatch': {
    title: 'Error: claim mapping',
    detail: 'The application expected a role claim and received a group claim.',
    hint: 'Fix the claim mapping so the role is released under the expected name.',
    tone: 'error',
  },
  'app-misconfigured': {
    title: 'Error: application misconfigured',
    detail: 'This application is not correctly configured for single sign-on.',
    hint: 'Check the SSO configuration in the IAM Console.',
    tone: 'error',
  },
  'app-offline': {
    title: 'Service unavailable',
    detail: 'The application is not responding.',
    hint: 'The service itself is down — this is not an identity problem.',
    tone: 'error',
  },
  'unknown-app': {
    title: 'Unknown application',
    detail: 'No application is registered under that identifier.',
    hint: '',
    tone: 'error',
  },
  'unknown-user': {
    title: 'Unknown account',
    detail: 'That account does not exist in the directory.',
    hint: '',
    tone: 'error',
  },
};

const TONE_COLOR = { denied: '#f48771', error: '#f48771', mfa: '#d7ba7d' };

export function renderAppPortalWindow(body: HTMLElement, conductor: VmServices): void {
  body.innerHTML = '';
  Object.assign(body.style, {
    overflow: 'hidden',
    background: '#1a1d22',
    flex: '1',
    minHeight: '0',
  });

  const root = document.createElement('div');
  root.style.cssText =
    'display:flex;flex-direction:column;height:100%;min-height:0;font-size:12px;color:#c8cdd3;' +
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;";
  body.appendChild(root);

  /** Which app's SSO result is on screen, or null for the portal listing. */
  let openAppId: AppId | null = null;
  /** Whose identity the portal is browsing as. */
  let asUserId: string | null = null;

  const el = (tag: string, css: string, text?: string): HTMLElement => {
    const e = document.createElement(tag);
    e.style.cssText = css;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  function render(): void {
    root.innerHTML = '';

    if (!conductor.dir || !conductor.apps) {
      root.appendChild(
        el(
          'div',
          'padding:28px;text-align:center;color:#8b95a1;line-height:1.6;',
          'The identity services are not available. Reset the environment to re-seed.',
        ),
      );
      return;
    }

    const dir = conductor.dir;
    const users = dir.listUsers();
    if (asUserId === null && users.length > 0) asUserId = users[0]!.id;
    const user = users.find((u) => u.id === asUserId) ?? users[0];

    // ── Header: who you are browsing as ────────────────────────────────────
    const header = el(
      'div',
      'display:flex;align-items:center;gap:10px;padding:10px 14px;background:#232830;' +
        'border-bottom:1px solid #2d343d;flex-shrink:0;',
    );
    const brand = el(
      'div',
      'font-size:13px;font-weight:600;color:#4ec9b0;',
      'Northwind App Portal',
    );
    const spacer = el('div', 'flex:1;');
    const label = el('span', 'font-size:11px;color:#8b95a1;', 'Signed in as');
    const picker = document.createElement('select');
    picker.style.cssText =
      'background:#0e1116;color:#e6e6e6;border:1px solid #2d343d;border-radius:4px;' +
      'padding:4px 8px;font-size:11.5px;outline:none;';
    for (const u of users) {
      const opt = new Option(`${u.username}${u.status === 'active' ? '' : ` (${u.status})`}`, u.id);
      picker.appendChild(opt);
    }
    if (user) picker.value = user.id;
    picker.addEventListener('change', () => {
      asUserId = picker.value;
      openAppId = null;
      render();
    });
    header.append(brand, spacer, label, picker);
    root.appendChild(header);

    const content = el('div', 'flex:1;min-height:0;overflow-y:auto;padding:14px;');
    root.appendChild(content);

    if (!user) {
      content.appendChild(el('div', 'color:#8b95a1;', 'No accounts in the directory yet.'));
      return;
    }

    if (openAppId) {
      renderSsoResult(content, conductor.apps.getApp(openAppId), user);
      return;
    }
    renderTiles(content, conductor.apps.apps(), user);
  }

  /** The MyApps grid. */
  function renderTiles(parent: HTMLElement, apps: Application[], user: User): void {
    parent.appendChild(
      el('div', 'font-size:11px;color:#8b95a1;margin-bottom:10px;', 'My Applications'),
    );

    if (apps.length === 0) {
      parent.appendChild(
        el('div', 'color:#6b7280;font-size:11.5px;', 'No applications are federated yet.'),
      );
      return;
    }

    const grid = el(
      'div',
      'display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;',
    );
    for (const app of apps) {
      const tile = document.createElement('button');
      tile.style.cssText =
        'text-align:left;background:#232830;border:1px solid #2d343d;border-radius:6px;' +
        'padding:12px;cursor:pointer;color:#c8cdd3;';
      tile.append(
        el('div', 'font-size:12.5px;color:#e6e6e6;font-weight:600;', app.name),
        el(
          'div',
          'font-size:10.5px;color:#8b95a1;margin-top:4px;',
          `SSO: ${app.protocol}${app.mfaRequired ? ' · MFA required' : ''}`,
        ),
        el(
          'div',
          `font-size:10px;margin-top:6px;color:${app.status === 'configured' ? '#6a9955' : '#f48771'};`,
          app.status,
        ),
      );
      tile.addEventListener('click', () => {
        openAppId = app.id;
        render();
      });
      grid.appendChild(tile);
    }
    parent.appendChild(grid);
    parent.appendChild(
      el(
        'div',
        'margin-top:14px;font-size:10.5px;color:#6b7280;line-height:1.6;',
        `Click an application to attempt single sign-on as ${user.username}. ` +
          'The page you get back reflects the current IdP and application configuration.',
      ),
    );
  }

  /** The page the chosen app returns for this user, right now. */
  function renderSsoResult(parent: HTMLElement, app: Application | undefined, user: User): void {
    const back = document.createElement('button');
    back.textContent = '← Back to My Apps';
    back.style.cssText =
      'background:transparent;border:none;color:#4ec9b0;cursor:pointer;font-size:11.5px;' +
      'padding:0 0 10px 0;';
    back.addEventListener('click', () => {
      openAppId = null;
      render();
    });
    parent.appendChild(back);

    if (!app) {
      parent.appendChild(el('div', 'color:#f48771;', 'That application is no longer registered.'));
      return;
    }

    const result = conductor.apps.ssoLogin(app.id, user.id);

    const card = el(
      'div',
      'background:#fff;color:#1a1a2e;border-radius:6px;padding:18px 20px;line-height:1.6;',
    );

    if (result.ok) {
      card.appendChild(
        el('div', 'font-size:15px;font-weight:600;color:#0f5132;', `Signed in to ${app.name}`),
      );
      card.appendChild(
        el(
          'div',
          'font-size:12px;color:#444;margin-top:4px;',
          app.protocol === 'SAML'
            ? 'SAML 2.0 assertion accepted by the service provider.'
            : 'OIDC token issued and consent granted.',
        ),
      );

      // The protocol detail is the teaching: which values had to line up.
      const rows: Array<[string, string]> =
        app.protocol === 'SAML'
          ? [
              ['Subject (NameID)', user.username],
              ['Issuer', app.issuer ?? 'https://idp.northwind.example'],
              ['Entity ID', app.entityId ?? app.clientId],
              ['ACS URL', app.redirectUri],
              ['MFA satisfied', app.mfaRequired ? `yes (${user.mfa})` : 'not required'],
            ]
          : [
              ['Subject (sub)', user.username],
              ['Client ID', app.clientId],
              ['Redirect URI', app.redirectUri],
              ['Scopes', 'openid profile email groups'],
              ['MFA satisfied', app.mfaRequired ? `yes (${user.mfa})` : 'not required'],
            ];

      const table = el('div', 'margin-top:12px;border-top:1px solid #e5e5e5;');
      for (const [k, v] of rows) {
        const row = el(
          'div',
          'display:flex;justify-content:space-between;gap:12px;padding:5px 0;' +
            'border-bottom:1px solid #f0f0f0;font-size:11.5px;',
        );
        row.append(
          el('span', 'color:#666;', k),
          el('span', 'color:#111;font-family:Consolas,monospace;', v),
        );
        table.appendChild(row);
      }
      card.appendChild(table);
      parent.appendChild(card);
      return;
    }

    const page = FAILURE_PAGES[result.reason] ?? {
      title: 'Sign-in failed',
      detail: result.reason,
      hint: '',
      tone: 'error' as const,
    };
    card.appendChild(
      el('div', `font-size:15px;font-weight:600;color:${TONE_COLOR[page.tone]};`, page.title),
    );
    card.appendChild(el('div', 'font-size:12px;color:#444;margin-top:6px;', page.detail));
    card.appendChild(
      el(
        'div',
        'font-size:11px;color:#666;margin-top:10px;font-family:Consolas,monospace;',
        `application: ${app.name} · protocol: ${app.protocol} · user: ${user.username}`,
      ),
    );

    // Surface the actual injected mismatch, so a break/fix lab is diagnosable
    // from the page the user sees rather than only from the console.
    const diff = app.configDiffFromBaseline;
    if (diff && Object.keys(diff).length > 0) {
      const detail = el(
        'div',
        'margin-top:12px;padding-top:10px;border-top:1px solid #e5e5e5;font-size:11px;color:#666;',
      );
      detail.appendChild(el('div', 'font-weight:600;color:#111;', 'Configuration mismatch'));
      for (const [field, { expected, actual }] of Object.entries(diff)) {
        detail.appendChild(
          el(
            'div',
            'font-family:Consolas,monospace;margin-top:4px;',
            `${field}: expected ${String(expected)} · actual ${String(actual)}`,
          ),
        );
      }
      card.appendChild(detail);
    }

    if (page.hint) {
      card.appendChild(
        el('div', 'margin-top:12px;font-size:11px;color:#0f5132;', `Next step: ${page.hint}`),
      );
    }
    parent.appendChild(card);
  }

  // No lab to subscribe to here: the portal re-renders on its own
  // interactions, and the window manager rebuilds it on re-entry.
  render();
}
