#!/usr/bin/env node
/**
 * capture-screenshots.cjs — real product shots for the landing page.
 *
 * Loads the production build in Electron, drives it to a handful of genuine
 * states, and writes PNGs into site/assets. The point is that the pictures on
 * the site are the software: a mocked-up screenshot of a lab that teaches
 * people to distrust interfaces that lie would be a poor start.
 *
 * Run with `npm run build && node capture-screenshots.cjs`. It needs the build
 * because it loads dist/index.html the way the packaged app does.
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'site', 'assets');
const WIDTH = 1440;
const HEIGHT = 900;

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

ipcMain.on('env:get:sync', (event) => {
  event.returnValue = { IS_ELECTRON: true, APP_VERSION: '0.1.0' };
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The shipped administrator credential, read from the seed rather than
 * repeated here.
 *
 * It was repeated here, and when the default changed this script carried on
 * typing the old one: sign-in failed silently and the "desktop" screenshot on
 * the landing page was actually the lock screen. Reading it means the script
 * cannot disagree with the application it is photographing.
 */
function seededAdminPassword() {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'config', 'credentials.ts'), 'utf8');
  const match = /password:\s*'([^']+)'/.exec(src);
  if (!match) throw new Error('Could not read the seeded administrator password.');
  return match[1];
}

/** Ask the renderer to open one of the desktop applications. */
const OPEN_APP = (id) =>
  `document.dispatchEvent(new CustomEvent('apex-launch-app',{detail:{appId:'${id}'}}))`;

const SIGN_IN = `
  (() => {
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    return true;
  })()`;

const ENTER_PASSWORD = `
  (() => {
    const pw = document.querySelector('input[type=password]');
    if (!pw) return 'no field';
    pw.value = ${JSON.stringify(seededAdminPassword())};
    const btn = Array.from(document.querySelectorAll('button'))
      .find((b) => b.textContent.trim() === 'Sign in');
    if (!btn) return 'no button';
    btn.click();
    return 'ok';
  })()`;

/** Build out a domain so the shots show a workstation in use, not an empty one. */
const SEED_DOMAIN = `
  (async () => {
    const vm = window.__vm;
    const dir = vm.session.dir;
    dir.createOu('Corp', 'Top level');
    const users = dir.listOus();
    const corp = users.find((o) => o.name === 'Corp');
    dir.createOu('Users', 'Staff accounts', corp && corp.id);
    dir.createOu('Groups', 'Security groups', corp && corp.id);
    dir.createOu('ServiceAccounts', 'Non-human accounts', corp && corp.id);
    dir.createGroup('grp-helpdesk-tier1', 'Service desk tier 1');
    dir.createGroup('grp-finance-payroll', 'Payroll access');
    const people = [
      ['jdoe', 'John Doe', 'Help Desk', 'Service Desk Analyst'],
      ['mchen', 'Maya Chen', 'HR', 'HR Business Partner'],
      ['rpatel', 'Ravi Patel', 'Finance', 'Payroll Analyst'],
      ['aokafor', 'Ada Okafor', 'Engineering', 'Software Engineer'],
    ];
    for (const [username, displayName, department, title] of people) {
      dir.createUser({
        username, displayName, email: username + '@iamlab.com',
        department, title, mfa: 'none',
      });
    }
    const okta = vm.session.cloud.okta;
    okta.connect();
    okta.grantAppAccount('HR Portal', 'rpatel@iamlab.com');
    okta.sync('system');
    okta.openSession('rpatel@iamlab.com');
    const ravi = dir.getUserByUsername('rpatel');
    dir.disableUser(ravi.id, 'system');
    return 'seeded';
  })()`;

/** Shots to take, in order. */
const SHOTS = [
  {
    file: 'shot-signin.png',
    caption: 'the sign-in screen',
    async setup(win) {
      await win.webContents.executeJavaScript(SIGN_IN);
      await wait(700);
    },
  },
  {
    // The hero shot on the landing page. A bare desktop: it is the first thing
    // anyone sees of the product and it should show what they get on signing
    // in, which is a clean workstation rather than somebody else's open
    // windows.
    file: 'shot-desktop.png',
    caption: 'the desktop, nothing open',
    async setup(win) {
      const signedIn = await win.webContents.executeJavaScript(ENTER_PASSWORD);
      if (signedIn !== 'ok') throw new Error('Sign-in failed: ' + signedIn);
      await wait(1000);
      // If the sign-in silently failed, __vm is still there but the desktop is
      // not — check before seeding, so the failure is loud.
      const onDesktop = await win.webContents.executeJavaScript(
        "Boolean(document.getElementById('apex-taskbar'))",
      );
      if (!onDesktop) throw new Error('Signed in but no desktop appeared.');
      await win.webContents.executeJavaScript(SEED_DOMAIN);
      await wait(500);
      // Close anything a previous run left behind, so this is genuinely bare.
      await win.webContents.executeJavaScript(`
        (() => {
          document.querySelectorAll('[title="close"]').forEach((b) => b.click());
          return true;
        })()`);
      await wait(600);
    },
  },
  {
    file: 'shot-directory.png',
    caption: 'Active Directory Users and Computers with the ticket queue',
    async setup(win) {
      await win.webContents.executeJavaScript(OPEN_APP('active-directory'));
      await wait(500);
      await win.webContents.executeJavaScript(OPEN_APP('ticket-console'));
      await wait(900);
      // Tile them, rather than letting the random open offset stack one on
      // top of the other — the point of the shot is that both are visible.
      await win.webContents.executeJavaScript(`
        (() => {
          const wins = Array.from(document.querySelectorAll('.apex-window'));
          const gap = 16;
          const h = Math.min(660, window.innerHeight - 110);
          const y = 28;
          const widths = [800, 560];
          const total = widths[0] + gap + widths[1];
          let x = Math.round((window.innerWidth - total) / 2);
          wins.slice(0, 2).forEach((el, i) => {
            el.style.left = x + 'px';
            el.style.top = y + 'px';
            el.style.width = widths[i] + 'px';
            el.style.height = h + 'px';
            x += widths[i] + gap;
          });
          return wins.length;
        })()`);
      await wait(500);
    },
  },
  {
    file: 'shot-cloud.png',
    caption: 'Okta and Entra, with a stale cloud copy',
    async setup(win) {
      await win.webContents.executeJavaScript(`
        (() => {
          const wm = document.querySelectorAll('.win-close, [title="close"]');
          wm.forEach((b) => b.click());
          return true;
        })()`);
      await wait(300);
      await win.webContents.executeJavaScript(OPEN_APP('cloud-identity'));
      await wait(900);
    },
  },
  {
    file: 'shot-manual.png',
    caption: 'the manual',
    async setup(win) {
      await win.webContents.executeJavaScript(`
        (() => {
          document.querySelectorAll('[title="close"]').forEach((b) => b.click());
          return true;
        })()`);
      await wait(300);
      await win.webContents.executeJavaScript(OPEN_APP('manual'));
      await wait(900);
    },
  },
  {
    file: 'shot-terminal.png',
    caption: 'the shell',
    async setup(win) {
      await win.webContents.executeJavaScript(`
        (() => {
          document.querySelectorAll('[title="close"]').forEach((b) => b.click());
          return true;
        })()`);
      await wait(300);
      await win.webContents.executeJavaScript(OPEN_APP('terminal'));
      await wait(600);
      await win.webContents.executeJavaScript(`
        (async () => {
          const inp = document.querySelector('input[type=text]:not([placeholder])');
          if (!inp) return 'no terminal';
          const run = async (c) => {
            inp.value = c;
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            await new Promise((r) => setTimeout(r, 180));
          };
          await run('Get-ADUser');
          await run('Get-DirectorySyncStatus -Provider okta');
          return 'ran';
        })()`);
      await wait(900);
    },
  },
];

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    backgroundColor: '#0a0d12',
    webPreferences: {
      preload: path.join(ROOT, 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  try {
    await win.loadFile(path.join(ROOT, 'dist', 'index.html'));
    await wait(1500);

    for (const shot of SHOTS) {
      await shot.setup(win);
      const image = await win.webContents.capturePage();
      fs.writeFileSync(path.join(OUT, shot.file), image.toPNG());
      console.log(`  ${shot.file} — ${shot.caption}`);
    }
    console.log(`Wrote ${SHOTS.length} screenshots to site/assets`);
  } catch (err) {
    console.error('Screenshot capture failed:', err);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
