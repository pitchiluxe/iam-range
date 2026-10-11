# 5-Step IAM Career Lab

This hands-on lab follows the "Break Into IAM" roadmap and maps directly to an entry-level IAM Analyst job description. Complete these five steps to build a portfolio-ready foundation.

---

See the [lab pathway and project crosswalk](lab-pathways.md) for exact lesson IDs, project names, prerequisites, and environment choices. For cohort pacing, use the [bootcamp syllabus](bootcamp-syllabus.md).

## Overview

| Step | Focus | Duration | Delivery |
|------|-------|----------|----------|
| 1 | IT Foundation | 4 weeks | IAM Range manual |
| 2 | IAM Specialization | 5 weeks | IAM Range Portfolio labs |
| 3 | LinkedIn Portfolio | Ongoing | Writer app |
| 4 | Interview Prep | 1 week | docs/interview-prep.md |
| 5 | Job Applications | Ongoing | docs/portfolio.md |

**Suggested pacing: 12 weeks**, including time to finish and present projects — designed to complete alongside full-time employment (10-15 hrs/week).

---

## Step 1: Build a Foundation in IT

### Why This Matters

Every entry-level IT job rests on four pillars. Learn each lifecycle and the tools that run it.

**The Four Pillars:**
1. **Identity Lifecycle** — Onboarding, offboarding, password resets, group membership
2. **Device Lifecycle** — Provisioning, compliance, remote troubleshooting, secure disposal
3. **Ticket Lifecycle** — Logging, triaging, documenting, SLA management, escalation
4. **Wi-Fi & Networking** — Connectivity diagnostics, VPN, infrastructure issues

### Resources in IAM Range

- **Infrastructure**: Open **AD Enterprise Lab** and complete `adl-01`–`adl-09`, then the help-desk scenarios `adl-10`–`adl-11` and enterprise setup `adl-12`. Follow the [AD Enterprise Lab guide](ad-enterprise-lab.md).
- **Manual lessons**: In **IAM Range manual**, complete Year 1 (`y1-host` through `y1-capstone`), then IAM Analyst lab: `analyst-env`, `analyst-provision`, `analyst-rbac`, `analyst-policy`, and `analyst-shares`.
- **Endpoint practice**: Follow the [help desk endpoint labs](help-desk-endpoint-labs.md) using Ticket Queue and Remote Desktop.
- **PowerShell**: Use the Terminal for `Get-ADUser`, `Get-ADGroupMember`, `Get-DirectorySyncStatus`
- **Ticket Queue**: Work the lockouts, access issues, and sync discrepancies

### What You'll Be Able to Do

- Diagnose and resolve common IT issues with a structured troubleshooting method
- Explain identity, device, and ticket lifecycles end to end
- Use Active Directory and the simulated Cloud Identity console; continue to real Entra ID exercises in Step 2

### Portfolio Artifacts (Step 1)

1. OU and group structure demonstration
2. Bulk provisioning script and output
3. Least-privilege file share setup with evidence
4. Password and lockout policy configuration
5. Privilege-creep finding with audit trail

---

## Step 2: Build IAM Specialization

### Core Responsibilities of an IAM Analyst

Joiner, Mover, Leaver workflows, access requests, RBAC, SSO/MFA, access reviews, PAM, audit evidence, sign-in troubleshooting.

### Projects That Solve Mission-Critical Problems

| Problem | Project |
|---------|---------|
| Terminated employees keep access for days | **Automated offboarding workflow** |
| New hires wait days for access | **Role-based onboarding** |
| Stolen passwords → account takeover | **MFA & Conditional Access rollout** |
| Auditors ask "who has access?" | **Access review with evidence report** |

### IAM Range Portfolio Labs

Open **IAM Portfolio** and follow the [project crosswalk](lab-pathways.md#bootcamp-project-crosswalk):

- **Lifecycle and RBAC**: `p01` Automated Joiner-Mover-Leaver (JML) Pipeline and `p02` Role-Based Access Control (RBAC) Matrix Design.
- **Governance**: `p03` Automated User Access Review (UAR) & Recertification Campaign and `p04` Stale & Dormant Account Remediation Engine.
- **Authentication**: `p05` Enterprise Single Sign-On (SSO) Application Integration and `p06` Context-Aware Adaptive Conditional Access Policies.
- **Privilege and evidence**: `p08` Just-In-Time (JIT) Privileged Access & Escalation and `p10` Centralized Identity Directory Event Log Auditing (SIEM).

Use manual chapters **Year 2 · IAM Analyst** and **Year 3 · IAM Engineer** as supporting lessons. For guided cloud practice, open **90-Day Challenge**, Labs 4–8; these require your own Entra tenant and host PowerShell. The [Year 2](../omari-lab/07-YEAR-2-IAM-ANALYST/README.md) and [Year 3](../omari-lab/08-YEAR-3-IAM-ENGINEER/README.md) folders are optional real-VM scenario kits layered onto the OMARI baseline, rather than the app's Portfolio lesson catalogue.

### What You'll Be Able to Do

- Provision and revoke access according to role-based policies
- Configure and troubleshoot SSO/MFA
- Conduct access governance reviews
- Respond to identity security incidents

---

## Step 3: Post on LinkedIn While You Build

### The Problem-Focused Approach

Don't post: "Today I learned how to use Entra ID."

Do post: "A terminated employee still had email access three days later. Here's how I closed that gap." (screenshot attached)

### The 4-Part Formula

1. **The Problem** — What was broken or at risk
2. **Why It Matters** — What it costs the business if ignored
3. **What You Did** — The steps you took to fix it
4. **The Proof** — Screenshots of your actual work

### Sample Posts to Adapt

Use Writer to draft these from your saved lab evidence. Report only results you actually measured and label simulated work clearly:

- "Fixed a privilege-creep finding: one user had both HR read and IAM admin access. Here's the remediation."
- "Built an access review process that caught 12 high-risk accounts with stale access."
- "Implemented MFA rollout preventing credential takeover for 450+ users."

---

## Step 4: Prepare for Interviews

### Technical Preparation

- **Walk each project**: the problem, your solution, the result
- **Explain end-to-end**: identity, device, and ticket lifecycles
- **Troubleshoot aloud**: "A user cannot sign in. What do you check?"

**IAM Sign-In Troubleshooting Checklist:**
1. Check account status (enabled, not expired)
2. Verify group membership
3. Review recent sign-in logs
4. Confirm MFA registration
5. Check Conditional Access policies

### Behavioral Preparation

Use the STAR method (Situation, Task, Action, Result):

1. A time you handled a difficult user
2. A time you made a mistake and fixed it
3. How you prioritize when everything is urgent

### Resources

- Read [interview preparation](interview-prep.md) for sample answers
- Practice explaining privilege-creep, access reviews, and offboarding SOPs
- Record yourself doing the IAM Range manual lessons — use the videos in your portfolio

---

## Step 5: Apply in Volume

### Cast a Wide Net

- Apply to many roles, consistently
- Don't filter by title, industry, or on-site requirements
- Help desk and IT support roles count: they are Step 1 with a paycheck

### Keep the Engine Running

While applying:
- Keep building projects (Step 2)
- Keep posting (Step 3)
- Keep practicing interviews (Step 4)

### Track Your Applications

Create a spreadsheet with:
- Company, role, date applied
- Application method (ATS, LinkedIn, referral)
- Status and next steps

---

## Getting Started

1. **Install IAM Range**: Download from GitHub Releases
2. **Sign in as `admin`** with the password shown on the sign-in panel
3. **Complete the AD Enterprise Lab**: Start with networking, then AD DS, DNS, domain join
4. **Open the Ticket Queue**: Work each ticket to prove the environment works
5. **View the 90-Day Challenge**: Open **90-Day Challenge** on the desktop and read the [challenge guide](../omari-lab/12-90-DAY-CHALLENGE/README.md)

---

## Why This Works

Employers hire proof, not promises. The five pillars are consistent across organizations — the tools change, but the fundamentals don't. Build each step methodically, document everything, and you'll have a portfolio that demonstrates competence, not just knowledge.

---

*Lab guide based on the "Break Into IAM" roadmap. For the structured 12-week bootcamp, see `docs/bootcamp-syllabus.md`.*