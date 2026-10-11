# IAM Range lab pathways

Use the [five-step career roadmap](iam-lab-5-step-roadmap.md) for career planning and the [bootcamp syllabus](bootcamp-syllabus.md) for a 12-week project schedule. Both use the same lessons below; the [90-Day Challenge](../omari-lab/12-90-DAY-CHALLENGE/README.md) is an alternative 13-lab schedule, not an additional prerequisite.

## Start here

1. Sign in as `admin` using the password on the sign-in panel. Available applications depend on the signed-in account.
2. Open **IAM Range manual**. Start with **Year 1 · Help Desk and Workstation Foundations**, then **IAM Analyst lab**. Select lessons by title; the IDs below identify them in the course source.
3. Open **AD Enterprise Lab** for infrastructure practice. Complete `adl-01`–`adl-05` (networking, AD DS/DNS, routing, DHCP, domain join), `adl-06`–`adl-09` (OUs, groups, GPO, shares), `adl-10`–`adl-11` (help desk), then `adl-12` (enterprise setup). Use **Check My Work** and the [series guide](ad-enterprise-lab.md).
4. Work **Ticket Queue** after creating staff in the main directory. Use **Generate Work** as needed and follow the [endpoint workflow](help-desk-endpoint-labs.md). The main directory starts empty; completing the separate AD Enterprise simulator does not populate it.
5. Open **IAM Portfolio**, choose the project below, build its deliverables, and submit for review. Save evidence and use **Writer** for reports. See the [portfolio kit](../omari-lab/11-IAM-PORTFOLIO/README.md) and [artifact checklist](portfolio.md).

## Choose your environment

| Path | Where the work happens | Prerequisites and limits |
|---|---|---|
| Manual, Ticket Queue, Cloud Identity | Main simulated workstation, `omari.test` | Build OUs, groups, and staff first. Cloud Identity teaches simulated Okta/Entra sync and provisioning; it is not a complete Intune, M365, or Jira implementation. |
| AD Enterprise Lab | Separate DC01/CLIENT01 simulator, `corp.technobiz.local`, or real VirtualBox VMs | Select the environment in the lab. For real machines, follow the [VirtualBox setup](../omari-lab/10-AD-ENTERPRISE-VBOX/README.md). |
| IAM Portfolio | Project briefs, deliverables, deterministic review, optional DC01 checks | Real VM checks are supported for `p01`, `p02`, `p03`, `p04`, `p08`, `p10`. Follow the kit before using VM mode. Projects `p05`, `p06`, `p07`, `p09` require the external environment specified in their briefs for an actual deployment. |
| 90-Day Challenge | Main directory for Labs 1–3, 9–11, 13; real Entra tenant for Labs 4–8; local dashboard for Lab 12 | Cloud labs use Browser and **PowerShell (this PC)**, which runs on the host in the desktop app. Prepare your own tenant, permissions, and feature licenses. Follow each lab's **Do this lab in the app** section. |
| Year 2 / Year 3 scenario kits | Existing OMARI real-VM baseline | Optional extensions: [Year 2](../omari-lab/07-YEAR-2-IAM-ANALYST/README.md), [Year 3](../omari-lab/08-YEAR-3-IAM-ENGINEER/README.md). These seed scenarios rather than create a new VM or replace the Portfolio projects. |

Keep each environment's domain names and commands together. The AD Enterprise simulator, main directory, and real tenant have separate state. Label portfolio evidence with the environment used.

## Bootcamp project crosswalk

Complete the supporting lessons before building the project. Reuse lifecycle project `p01` for both onboarding and offboarding, with separate evidence for each outcome.

| Weeks / project | Manual lessons | Hands-on path | Evidence to save |
|---|---|---|---|
| 1–2 / 1: User lifecycle | `analyst-env`, `analyst-provision`; `joiner`, `mover`, `leaver` | AD Enterprise `adl-06`, `adl-07`; [analyst walkthrough](iam-analyst-lab.md) | OU tree, provisioning script, membership before/after |
| 2–3 / 2: Device lifecycle | `y1-network`, `y1-windows`, `y1-gpo`, `analyst-policy` | AD Enterprise `adl-01`–`adl-05`, `adl-08`; endpoint tickets | Domain join, policy checks, endpoint repair notes; use a separate Intune environment for enrollment/compliance |
| 3–4 / 3: Ticket lifecycle | `y1-helpdesk`, `analyst-helpdesk`, `y1-capstone` | AD Enterprise `adl-10`, `adl-11`; Ticket Queue and Remote Desktop | Symptom, diagnosis, repair, verification, escalation note |
| 5–6 / 4: Onboarding | `joiner`, `analyst-provision`, `analyst-rbac`, `analyst-docs` | `p01` Automated Joiner-Mover-Leaver (JML) Pipeline; `p02` Role-Based Access Control (RBAC) Matrix Design; Challenge Lab 9 | Approved access, role matrix, provisioning audit |
| 6–7 / 5: Offboarding | `leaver`, `latency`, `scim`, `analyst-docs` | `p01`; Challenge Lab 9 | Disable/revoke evidence, application access checks, offboarding SOP |
| 8–9 / 6: Governance | `analyst-audit`, `analyst-dormant`, `certification`, `y3-iga`, `y3-pam` | `p03` Automated User Access Review (UAR) & Recertification Campaign; `p04` Stale & Dormant Account Remediation Engine; `p08` Just-In-Time (JIT) Privileged Access & Escalation; Challenge Lab 10 | Review decisions, stale-account remediation, time-bounded privilege evidence |
| 9–11 / 7: Authentication | `y2-sso`, `y2-mfa`, `y2-hybrid`, `analyst-cloud` | `p05` Enterprise Single Sign-On (SSO) Application Integration; `p06` Context-Aware Adaptive Conditional Access Policies; optional `p07` Centralized Modern Authentication Portal (OIDC/OAuth); Challenge Labs 4–8 | Authentication flow, policy tests, sign-in troubleshooting evidence |
| 11–12 / 8: Incident capstone | `y3-incidents`, `analyst-audit`, `evidence`, `emergency-access` | `p10` Centralized Identity Directory Event Log Auditing (SIEM); Challenge Lab 13 | Incident timeline, containment, validation, executive report; real Entra/KQL work is a separate cloud extension |

For automation across projects, use `y1-powershell`, `y3-standards`, `y3-apis`, and Challenge Labs 2, 8, 9. For an optional advanced AWS extension, use Portfolio `p09` Multi-Account Cross-Account Role Assumption after the core pathway.

## Completion and career evidence

- Finish the manual lesson checks, AD Enterprise **Check My Work**, Portfolio review, or Challenge checklist appropriate to the activity. These are separate progress systems.
- Save the problem statement, commands/configuration, before-and-after evidence, verification, and reflection. A bootcamp project can combine several labs; completing one lab does not automatically complete the project.
- Use [portfolio guidance](portfolio.md) and [interview preparation](interview-prep.md) for roadmap Steps 3–5. Describe measured results, including whether they came from a simulation or real environment.
- The bootcamp's timed exams, eight-project grading, certificate, internship verification, and placement support are administered by the program, separately from app progress.

Lesson and project names are checked against the [manual catalogue](../src/config/manual.ts), [AD Enterprise catalogue](../src/vm/adlab/labs.ts), and [Portfolio configuration](../omari-lab/11-IAM-PORTFOLIO/ollama-instructor.config.json).
