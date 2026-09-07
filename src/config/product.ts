/**
 * config/product.ts — what this software is called and who publishes it.
 *
 * Distinct from config/company.ts, which is the *fictional* company inside the
 * simulation, and from config/vmHost.ts, which is the *simulated* machine.
 * This file is the real product: the name in the Start menu, the folder under
 * Program Files, the publisher column in Control Panel, the window title and
 * the installer.
 *
 * One definition because a rename that reaches half the surfaces is worse than
 * no rename. "Northwind" survived in six strings for months after the company
 * inside the simulation was renamed, and a workstation that calls itself two
 * things undermines the one thing this app sells: that what is on screen is
 * true.
 *
 * The Electron main process and the landing page cannot import this — one is
 * CommonJS, the other is static HTML. Their copies are checked against this
 * file by tests/branding.test.ts rather than trusted.
 */

export const PRODUCT = {
  /** Shown in the Start menu, the taskbar and the installer. */
  name: 'IAM Range',
  /** Window title. Slightly longer, because a title bar has room to say what
   *  the thing is rather than only what it is called. */
  windowTitle: 'IAM Range — Identity Operations Workstation',
  /** Who publishes it. Real, unlike everything inside the lab — this is the
   *  name in the Control Panel publisher column and on the installer. */
  publisher: 'Erick Omari',
  /** One line, used on the landing page and in Settings. */
  tagline: 'Learn the job by doing the job.',
  /** Folder name under Program Files, and the reverse-DNS application id. */
  installFolder: 'IAM Range',
  appId: 'com.mydigitalsolutions.iamrange',
  /** Where releases and source live. Installed copies check this URL for
   *  updates for the rest of their lives, so it must not change after the
   *  first public release. */
  repo: 'pitchiluxe/iam-range',
} as const;

export const PRODUCT_REPO_URL = `https://github.com/${PRODUCT.repo}`;
export const PRODUCT_RELEASES_URL = `${PRODUCT_REPO_URL}/releases/latest`;
