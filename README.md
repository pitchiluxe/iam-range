# IAM Operator Workstation

A standalone identity-operations workstation: the virtual machine from the
IAM & SSO 3D Lab, running on its own with no 3D world and no lab engine.

It boots straight into a seeded Northwind directory — 14 users, 10 groups,
5 federated applications — with every console live from the first frame and six
tickets already waiting in the queue.

```bash
npm install
npm run dev      # http://localhost:5174
npm test -- --run
npm run build
```

## What's in it

| Window | What it does |
|---|---|
| **IAM Console** | Users, groups, roles, credentials, sessions, audit trail |
| **Ticket Queue** | Raise and work tickets, with SLA timers and comments |
| **SecOps Dashboard** | Searchable audit log, incidents, access reviews |
| **Terminal** | PowerShell shell — real AD cmdlet names, plus `dir`, `whoami`, `net user`, `ipconfig` |
| **PowerShell ISE** | Script editor with nine automation templates and save-your-own |
| **App Portal** | SSO portal — attempt sign-on as any user and see the page they'd get |
| **Browser** | Restricted browser, IAM/identity resources only |
| Calculator, Notepad, Sticky Notes, File Explorer, Settings, Control Panel, Recycle Bin | Desktop accessories |

Every console action runs against the same services and writes to the same
audit log, so what you do in the Terminal shows up in the IAM Console and the
SecOps log — the surfaces cannot disagree.

## Relationship to `../app`

This project was extracted from the 3D lab and is now **independent**. Changes
here do not affect `../app`, and vice versa. The extraction was possible
without rewriting the windows because each one imported the lab's `Conductor`
only as a **type** — so they bind by shape to `VmSession`, which owns the same
seven services and nothing else.

**Carried over:** `domain/`, `services/`, `terminal/`, `config/`, `util/`,
`seed/baseline`, `ui/desktopOverlay` and 14 console windows.

**Left behind, deliberately:**

- `three/` — the 3D engine. The VM never imported it.
- `labs/`, `conductor/`, `seed/perLab/` — lab definitions, steps, scoring, faults.
- `Objectives` and `AI Supervisor` windows — both exist to serve labs.
- Evidence capture and scoring. The audit log is the record here.

The lab-shaped stores (`labStore`, `evidenceStore`, `scoreStore`, `tutorStore`,
`progressStore`, `faultStore`) are **absent rather than stubbed**. A stub would
invite window code to keep depending on a concept this app does not have.

The bundle is ~200 KB against the lab's ~886 KB, almost entirely because
Three.js stayed behind.

## The starting backlog

Boot raises six tickets across six kinds — a CFO lockout, an access request, a
new starter, an MFA device replacement, a leaver and a transfer.

They obey the rules the 3D lab arrived at the hard way. A ticket names accounts
the directory actually has; its payload points at the **subject** rather than
whoever raised it; and if the prose claims evidence, that evidence is real. The
lockout ticket describes failed sign-ins, so `greta.olsen` is genuinely
`locked` and five `signin.failure` events are in the audit log — investigate,
and you find what the ticket said you would.

The onboarding ticket is the deliberate exception: `priya.raman` does not
exist, because creating her is the job.

`tests/session.test.ts` enforces all of that, so a ticket added later cannot
quietly describe a world that is not there.

## Sessions

`VmSession` (`src/vm/session.ts`) owns the seven services and seeds the
directory. **Reset Environment** in the Ticket Queue re-seeds from scratch.

Services are *replaced* on reset, not cleared — so windows resolve them per
action rather than capturing a reference at render time. That was a real bug in
the 3D app: a window holding a stale service mutated an orphaned directory and
still reported success.

## Tests

147 tests cover the parts with real logic: the script runner and its PowerShell
subset, terminal cmdlets and shell built-ins, the capability registry,
directory integrity, the calculator's expression evaluator, and the browser
allowlist including its bypass attempts.

Lab-dependent suites did not come across, and neither did the Electron
main-process allowlist test — this project has no main process yet. If you add
an Electron shell, port that assertion across with it.

## Ideas from here

- An Electron shell, reusing `../app/electron` and its allowlist guards.
- Free-play scenarios: inject a lockout or a broken SAML config on demand,
  without the full lab machinery.
