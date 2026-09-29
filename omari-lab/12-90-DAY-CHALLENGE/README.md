# 90-Day IAM Job-Ready Challenge

Thirteen one-week labs that take you from Active Directory basics to a
job-ready Junior IAM Engineer portfolio. Open **90-Day Challenge** (📅) on the
IAM Range desktop to see the schedule, today's task, each lab's checklist and
a feedback form; the lab text itself is in `labs/`.

## Environment — everything inside IAM Range

| Labs | Done in | Buttons in the lab |
|---|---|---|
| 1–3, 9–11, 13 | The app's own Active Directory, `omari.test` (`DC=omari,DC=test`), under `OU=Challenge90` | Active Directory, Terminal (AD), PowerShell ISE, Access Reviews, Ticket Queue, Cloud Identity |
| 4–8 | Your real Microsoft Entra ID tenant, in the app's **Browser** (Entra admin center, Azure portal), plus **PowerShell (this PC)** for Microsoft Graph | Entra admin center, Azure portal, My Apps, SAML Toolkit, jwt.ms, Graph Explorer, PowerShell (this PC) |
| 12 | PowerShell (this PC) + your normal browser for `http://localhost:8000` | PowerShell (this PC), Sheets |

Each lab opens with **Do this lab in the app**: which button, which command,
in order. Every Active Directory command in those sections is run through the
app's simulator by the test suite, in lab order, so the steps are known to work.

**PowerShell (this PC)** is real Windows PowerShell running on your computer,
inside the app (desktop app only). Functions and variables persist between
commands; `Read-Host -AsSecureString` shows a masked box; **Stop** ends a
running command. The Microsoft sign-in pages load inside the desktop app's
Browser; the web build cannot frame them and offers **Open ↗** instead.

The *Hands-on lab* sections keep the real-server versions of every script
(`corp.technobiz.local`): write them, commit them to GitHub, and run them on a
real domain controller whenever you have one.

## Schedule

| Days | Lab | Phase | Repo |
|---|---|---|---|
| 1–7 | 1. AD Enterprise Base | AD Foundation | `iam-ad-enterprise-lab` |
| 8–14 | 2. PowerShell AD Automation Toolkit | AD Foundation | `iam-ad-enterprise-lab` |
| 15–21 | 3. AD Troubleshooting Deep Dive | AD Foundation | `iam-ad-enterprise-lab` |
| 22–28 | 4. Entra ID Foundations | Entra ID & Cloud | `iam-entra-id-lab` |
| 29–35 | 5. MFA & SSO | Entra ID & Cloud | `iam-entra-id-lab` |
| 36–42 | 6. Enterprise Apps & App Registrations | Entra ID & Cloud | `iam-entra-id-lab` |
| 43–49 | 7. Conditional Access Deep Dive | Entra ID & Cloud | `iam-entra-id-lab` |
| 50–56 | 8. Microsoft Graph & OAuth | Entra ID & Cloud | `iam-graph-automation` |
| 57–63 | 9. JML Workflow Automation | Lifecycle & Governance | `iam-jml-automation` |
| 64–70 | 10. Just-in-Time Access & Access Reviews | Lifecycle & Governance | `iam-access-governance` |
| 71–77 | 11. Access Request Ticketing | Lifecycle & Governance | `iam-access-governance` |
| 78–84 | 12. Identity Governance Dashboard | Lifecycle & Governance | `iam-access-governance` |
| 85–90 | 13. Capstone & Job-Ready | Job-Ready | `iam-90-day-capstone` |

A standard week (~8 hours): day 1 read + quick review, days 2–4 build, day 5
break it and fix it, day 6 GitHub write-up, day 7 checklist + interview answer
+ feedback.

## Resetting

- **Restart this lab** (feedback panel): the lab starts again *today* with a
  full week; later labs move with it. Only this lab's ticks and feedback clear.
- **Restart challenge…** (top bar): Day 1 becomes today, all 90 days are
  re-dated, and all ticks and feedback clear.
- To reset the directory itself, use **Reset Environment** in the app.

## Giving feedback

At the end of each lab, fill in the feedback panel in the app (repo URL,
what went well, errors, one improvement, difficulty) and click **Copy
feedback**. Paste it to your mentor; the next lab can be adjusted from it.

## Rules

- No real passwords, secrets or personal data in any repo. Prompts and
  environment variables only; synthetic data for anything public.
- Lab 10 Part D (AD Privileged Access Management feature) is **irreversible** —
  optional, snapshot first.
