# IAM Range

[![CI](https://github.com/pitchiluxe/iam-range/actions/workflows/ci.yml/badge.svg)](https://github.com/pitchiluxe/iam-range/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/pitchiluxe/iam-range)](https://github.com/pitchiluxe/iam-range/releases/latest)

IAM Range is a simulated Windows workstation for practising Identity and Access Management
and Privileged Identity Management. The directory behind it is real enough to
be wrong: you can misconfigure it, and it will behave the way a misconfigured
one behaves.

The domain starts **empty**. One administrator account, no organisational
units, no groups, nobody in it. Everything else gets there because you put it
there, which is the point — every account in a real directory exists because
somebody provisioned it.

## What is in it

| Application | What it does |
| --- | --- |
| Active Directory Users and Computers | The snap-in, backed by a real directory. The tree shows what exists and nothing that does not. |
| PowerShell | A working subset of the AD cmdlets, with script templates for bulk work. |
| Cloud Identity | Okta and Entra ID in front of the domain: sync cycles, SCIM, soft-match failures. |
| Ticket Queue | Work raised for the state the domain is actually in, with the evidence made true first. |
| IAM Tutor | Answers from a written reference and names the article it used. Socratic by default. |
| Documentation | Thirteen articles on the things the job and the interview both ask about. |
| Writer | The documents an identity engineer files — incident report, access review, offboarding checklist. |
| SecOps Dashboard, App Portal, Control Panel, Settings, Explorer, Terminal | The rest of the desktop. |

Which applications appear depends on the department of the account signed in.
HR does not get Active Directory. Signing in as somebody else to see what their
desktop has is a genuine diagnostic step.

## Using this to land an IAM Analyst role

The lab is mapped to an entry-level IAM Analyst job description. See
`docs/iam-analyst-lab.md` for the full curriculum and `docs/interview-prep.md`
for sample answers.

To build a portfolio from it, open `docs/portfolio.md`. It lists the exact
artifacts to capture:

- OU and group structure
- Bulk onboarding script
- Least-privilege file share with Deny
- Password and lockout policy
- Privilege-creep finding with audit trail
- Dormant-account review
- Entra ID sync verification
- Offboarding SOP and auditor evidence pack

## Running it

```bash
npm install
npm run dev        # http://localhost:5174
```

Sign in as `admin` with the password shown on the sign-in panel.

```bash
npm test -- --run  # the suite
npm run type-check
npm run lint
npm run build      # production build into dist/
```

## Building the desktop application

```bash
npm run build:desktop   # installer into dist-installer/, no publish
npm run release         # build and publish to GitHub Releases
```

`npm run electron:dev` runs the Electron shell against an existing `dist/`.

Publishing needs `GH_TOKEN` and the `publish` block in `package.json` pointing
at a repository that exists. CI does this on every push to the default branch,
and fails the job if the publish step produced no installer — a build that
exits zero having shipped nothing is the failure this check exists for.

## The optional part

The tutor and the ticket generator can use [Ollama](https://ollama.com/download),
a local model runtime. Nothing leaves the machine; the model runs on it.

```bash
ollama pull llama3.2
```

Without Ollama the tutor quotes the documentation rather than composing an
answer, and generated tickets use their built-in wording. That is a narrower
experience, not a broken one, and it is the one most people will have — so it
is tested as a first-class path rather than as a fallback.

Settings → AI Assistant reports whether Ollama is currently answering.

## The landing page

`site/` is a single static page with a download button. `vercel.json` deploys
it as-is with no build step. `npm run build:icons` regenerates the mark it
shares with the application.

## How it is put together

```
src/
  config/       company, credentials, host identity, desktop profiles,
                knowledge base, document templates, script templates
  domain/       types, branded IDs, audit and validator unions
  services/     directory, IdP, app server, tickets, audit, reviews,
                incidents, PIM, cloud tenants, capability registry
  vm/           session, login, environment stage, ticket generator, tutor
  terminal/     tokenizer, dispatcher, script runner, shell intrinsics
  ui/           desktop overlay, login screen, sounds, toast
  ui/consoles/  one file per application window
```

Two rules hold the thing together.

**The capability registry is the single source of truth.** `services/capabilities.ts`
defines what an operator can do. The console renders a form per capability, the
terminal dispatches cmdlets against it, and ticket kinds declare which
capability resolves them. Adding an action there makes it reachable everywhere
at once; a ticket kind with no resolving capability fails the build.

**Drift is a test failure.** A ticket naming an account that does not exist, a
lockout ticket with no locked account, a validator with no case, a script
template that does not parse, or a source file naming a company this project
renamed away from — each of those breaks the suite rather than being noticed
months later by somebody using it.

## A note on realism

Every account, company, domain and application is fictional. The workstation
touches nothing on the host machine and opens no network connection of its own;
the only outbound request it can make is to a local Ollama, and only if you
install one.

Built and published by Erick Omari.
