# Technobiz IT & IAM Career Accelerator — Bootcamp Syllabus

This is the structured 12-week cohort-paced bootcamp curriculum based on the Technobiz IT & IAM Career Accelerator syllabus. It is delivered alongside the **IAM Range** simulated workstation, which provides the practice environment, with optional real VM and cloud exercises.

---

## Using this syllabus in IAM Range

Follow the [lab pathway and project crosswalk](lab-pathways.md) for every project, then use the [five-step career roadmap](iam-lab-5-step-roadmap.md) to turn your evidence into a portfolio and interview practice. Lesson IDs below refer to **IAM Range manual**; `p01`–`p10` refer to **IAM Portfolio**.

Examinations, grading, certificates, community support, internship verification, and placement services described here are Technobiz program requirements. Installing IAM Range provides practice tools; it does not enroll you in those services or award those credentials.

## Program at a Glance

| Attribute | Value |
|-----------|-------|
| **Duration** | 12 weeks, cohort-paced |
| **Format** | Online, project-based, with structured community support |
| **Instructional Model** | Scenario-driven, portfolio-first professional training |
| **Assessment** | 2 timed written examinations (80% passing standard) + 8 graded portfolio projects |
| **Credential** | Certificate of Completion + verified peer-support internship |
| **Prerequisites** | None — basic computer literacy + a computer capable of running a virtual machine |

### Guiding Principle

**Employers hire proof, not promises.** Rather than isolated tutorials, you work inside a realistic enterprise environment where you diagnose and resolve the operational and identity problems real organizations face every day.

Each project opens with a scenario briefing, continues through core concepts and targeted lessons, culminates in a hands-on build in live enterprise tooling, and closes with structured professional reflection. Every project ships as a documented GitHub repository with a 3–7 minute video demonstration.

---

## Program Schedule at a Glance

### Phase I — Crawl (Weeks 1-4)

| Week | Focus | Milestone |
|------|-------|-----------|
| 1 | Orientation and Project 1: User Lifecycle | Environment and portfolio setup complete |
| 2 | Project 1 concludes; Project 2: Device Lifecycle begins | Project 1 ships to portfolio |
| 3 | Project 2 concludes; Project 3: Ticket Lifecycle begins | Project 2 ships to portfolio |
| 4 | Project 3 concludes; core drills; exam prep | Project 3 ships; **Examination 1 (Gate 1)** |

### Phase II — Walk (Weeks 5-12)

| Week | Focus | Milestone |
|------|-------|-----------|
| 5 | Project 4: Onboarding & Access Provisioning | Phase II environment established |
| 6 | Project 4 concludes; Project 5: Offboarding begins | Project 4 ships to portfolio |
| 7 | Project 5 concludes; Automation & Governed Systems begins | Project 5 ships to portfolio |
| 8 | Project 6: Access Governance & Reviews | Governance environment established |
| 9 | Project 6 concludes; Project 7: SSO & Authentication begins | Project 6 ships to portfolio |
| 10 | Project 7: SSO, MFA, Conditional Access | Federation build complete |
| 11 | Project 7 concludes; Project 8 (Capstone) begins | Project 7 ships to portfolio |
| 12 | Capstone concludes; exam prep | Capstone ships; **Examination 2 (Gate 2)** |

Following Week 12, graduates enter the **Run Phase** placement program — self-paced job search support. The internship practicum runs in parallel with Phase II.

---

## Phase I: IT Operations Foundation (Weeks 1-4)

### Phase Objective

Establish the operational foundation for all enterprise IT roles. Learn how users, devices, and support operations function together before anything is secured.

### Project 1 — User Lifecycle

- **Focus**: Enterprise User Lifecycle Administration
- **Tools**: Active Directory, PowerShell
- **Skills & Knowledge**:
  - Directory services and organizational structure
  - Identity, authentication and authorization
  - Least privilege and role-based access control
  - Account administration across the joiner, mover, and leaver lifecycle
  - Naming standards and professional documentation

**IAM Range Labs**: `analyst-env`, `analyst-provision`, `joiner`, `mover`, `leaver`; AD Enterprise `adl-06`–`adl-07`

### Project 2 — Device Lifecycle

- **Focus**: Device Provisioning, Compliance, and Retirement
- **Tools**: Endpoint tools in IAM Range; Microsoft Intune for a separate real-tenant extension
- **Skills & Knowledge**:
  - Device identity and endpoint management
  - Networking fundamentals
  - Mobile device management and enrollment
  - Compliance policy design and enforcement
  - Endpoint encryption and security
  - Full device lifecycle from provisioning to secure disposal

**IAM Range Labs**: `y1-network`, `y1-windows`, `y1-gpo`, `analyst-policy`; AD Enterprise `adl-01`–`adl-05`, `adl-08`; [endpoint labs](help-desk-endpoint-labs.md). Intune enrollment, compliance, encryption, and disposal require a separate environment; Cloud Identity is not an Intune simulator

### Project 3 — Ticket Lifecycle

- **Focus**: Ticket Lifecycle Management: Troubleshooting, SLAs, Escalations
- **Tools**: IAM Range Ticket Queue (service-desk practice); Jira Service Management as a separate extension
- **Skills & Knowledge**:
  - IT service management and incident management
  - Ticket classification, prioritization, and SLA management
  - Structured troubleshooting and root cause analysis
  - Escalation handling and customer communication
  - Knowledge base documentation

**IAM Range Labs**: Work the live **Ticket Queue** — resolve lockouts, access issues, and sync discrepancies

### Core Drills — Resolving Common & Unpredictable Issues

Repetition-based fluency in the most frequent support issues (account lockouts, permission gaps, connectivity and authentication failures, provisioning errors), plus adaptive investigation of unpredictable scenarios that require judgment rather than memorization.

### Phase I Assessment: Examination 1

- Timed written exam covering Phase I domains
- Formats: multiple choice, true/false, fill-in-the-blank
- Emphasis on scenario-based judgment
- **Minimum 80% required to advance to Phase II**
- Retakes available under the program retake policy

---

## Phase II: Identity & Access Management Specialization (Weeks 5-12)

### Phase Objective

Transition from supporting enterprise technology to **securing enterprise identity**. Learn how organizations control access, manage identity lifecycles, protect authentication, govern permissions, and respond to identity security events.

### Project 4 — Onboarding

- **Focus**: Joiner Workflow: Onboarding and Access Provisioning
- **Tools**: Microsoft Entra ID, M365
- **Skills & Knowledge**:
  - HR as the authoritative source
  - Role-based group assignment and licensing
  - Shared resource and mailbox access
  - Approval workflows
  - Least privilege in practice
  - Audit documentation for every access grant

**IAM Range Labs**: `joiner`, `analyst-provision`, `analyst-rbac`, `analyst-docs`; Portfolio `p01` and `p02`

### Project 5 — Offboarding

- **Focus**: Leaver Workflow: Deprovisioning and Access Revocation
- **Tools**: Microsoft Entra ID, M365
- **Skills & Knowledge**:
  - Timely deprovisioning and session revocation
  - License recovery and group removal
  - Mailbox preservation, shared conversion, litigation hold
  - Asset recovery
  - Compliance verification and complete audit trails

**IAM Range Labs**: `leaver`, `latency`, `scim`, `analyst-docs`; Portfolio `p01`. M365 mailbox conversion and litigation hold require a separate tenant

### Project 6 — Access Governance

- **Focus**: Access Governance, Least Privilege, and Separation of Duties
- **Tools**: Microsoft Entra ID Governance
- **Skills & Knowledge**:
  - Access reviews and review evidence
  - Separation of duties analysis
  - Privileged access management
  - Identification and remediation of over-permissioned and toxic access combinations
  - Exception processes and governance reporting

**IAM Range Labs**: `analyst-audit`, `analyst-dormant`, `certification`, `y3-iga`, `y3-pam`; Portfolio `p03`, `p04`, `p08`

### Project 7 — SSO & Authentication

- **Focus**: SSO, MFA, and Conditional Access
- **Tools**: Okta, Entra Conditional Access
- **Skills & Knowledge**:
  - Federation concepts; identity providers and service providers
  - SAML 2.0, OAuth 2.0, and OIDC
  - Multi-factor authentication, passwordless, and risk-based policies
  - Diagnosis of authentication failures from logs (tokens, certificates, federation, synchronization)

**IAM Range Labs**: `analyst-cloud`, `y2-sso`, `y2-mfa`, `y2-hybrid`; Portfolio `p05`, `p06`, `p07`; real-tenant Challenge Labs 4–8

### Project 8 — Capstone: Incident Response

- **Focus**: Account Compromise Investigation and Remediation
- **Tools**: Microsoft Entra ID logs, KQL (Kusto Query Language)
- **Skills & Knowledge**:
  - Identity threat patterns: credential compromise and MFA fatigue
  - Structured investigation using sign-in and audit logs
  - Timeline reconstruction with KQL queries
  - Containment, credential reset, and validation
  - Incident reporting, root cause analysis, executive communication

**IAM Range Labs**: `y3-incidents`, `analyst-audit`, `evidence`, `emergency-access`; Portfolio `p10`; Challenge Lab 13. Real Entra logs and KQL require a separate cloud environment

### Core Thread — Automation & Governed Systems

- **Tools**: PowerShell, Microsoft Graph
- **Skills**: By-hand vs by-system decision, scripted provisioning/deprovisioning, automated access reporting, automation guardrails (logging, dry-run execution, rollback planning)

**IAM Range Labs**: `y1-powershell`, `y3-standards`, `y3-apis`, `analyst-provision`; Challenge Labs 2, 8, 9

### Phase II Assessment: Examination 2

- Timed written exam covering Phase II domains
- Weighted toward log-diagnosis scenarios and system-design judgment
- Formats: multiple choice, true/false, fill-in-the-blank
- **Minimum 80% required for program completion**
- Retakes available under the program retake policy

---

## Time Commitment & Student Expectations

Plan for **10-15 hours per week**. The program is designed to be completed alongside full-time employment — **consistency, not intensity**, is the primary predictor of completion.

| Activity | Weekly Time | Description |
|----------|-------------|-------------|
| Lessons | 3-4 hours | Scenario briefings, core concepts, and supporting lessons (video and written) |
| Lab Work | 5-8 hours | Hands-on builds in live enterprise tooling, guided by a lab checklist |
| Reflection & Documentation | 1-2 hours | Structured reflections, GitHub documentation, video demonstrations |
| Community | ~1 hour | Peer discussion, support participation, internship cases |

### Daily Discipline

- Complete the assigned lessons
- Complete the assigned lab work
- Post a structured reflection to the learning community

---

## Portfolio Requirements

Each project ships as a documented GitHub repository containing:

1. A problem statement and solution overview
2. Supporting artifacts (scripts, configs, screenshots)
3. A 3–7 minute video demonstration
4. A five-part professional reflection: what happened, why it mattered, how it was resolved, best practices, lessons learned (posted publicly for every project)

---

## Portfolio Spotlight: The Capstone Project

**The problem class**: A privileged user account shows signs of compromise — anomalous sign-in activity consistent with a modern credential attack, including MFA fatigue. The scope of attacker activity is unknown, and leadership requires answers.

**What the student does**: For the real-cloud extension, working in Microsoft Entra ID logs, the student executes a structured incident response: immediate containment (account lockdown, credential reset, session revocation, access removal), investigation across sign-in and audit logs, timeline reconstruction using KQL queries, and validation of scope.

**Why it matters to employers**: This single artifact demonstrates log analysis, structured investigation, decisive containment, and executive communication — the exact combination interviewers probe for in identity and security support roles.

---

## Verified Internship Practicum

After passing Examination 1, students become eligible to serve as lab support for students earlier in the program: gathering information, guiding troubleshooting, and documenting resolutions to a professional standard. Internship work is logged, reviewed, and verified by Technobiz upon program completion — giving graduates a legitimate, verifiable support experience entry for their resume in addition to the project portfolio.

---

## Placement Program (Run Phase)

Following successful completion of both examinations, graduates enter a structured placement program focused on converting the portfolio into employment outcomes:

- Portfolio assembly and presentation
- Resume and LinkedIn positioning
- Interview preparation built on the eight completed projects
- Structured job search system
- Offer evaluation and negotiation

---

## Tools & Technologies

Core simulator practice runs locally. Real VM exercises require Windows evaluation media; cloud extensions require your own tenant, permissions, and any licenses needed for the selected feature. See the [environment guide](lab-pathways.md#choose-your-environment).

| Category | Technologies |
|----------|-------------|
| Directory & Identity | Active Directory, Microsoft Entra ID, Entra ID Governance |
| Productivity & Endpoint | Microsoft 365, Microsoft Intune |
| Access & Federation | Okta, Entra Conditional Access, SAML 2.0, OAuth 2.0, OIDC |
| Service Management | Jira Service Management |
| Automation & Analysis | PowerShell, Microsoft Graph, KQL |
| Portfolio & Delivery | GitHub, video demonstration tooling |

---

## Program Learning Outcomes

Upon successful completion, graduates can:

1. Manage the full identity lifecycle across joiner, mover, and leaver events
2. Provision, modify, and revoke access in accordance with policy and least privilege
3. Manage desktop and mobile devices, including compliance enforcement and secure retirement
4. Troubleshoot common IT and identity issues with a structured, repeatable method
5. Run enterprise ticketing professionally (prioritization, SLAs, escalations)
6. Configure and troubleshoot single sign-on and modern authentication
7. Perform access governance reviews and apply least privilege across an organization
8. Respond to identity security incidents with structured investigation and remediation
9. Document and communicate clearly with users, peers, and stakeholders
10. Judge when a problem should be solved by hand versus built into a governed, automated system

---

## Career Readiness

Graduates leave with eight published portfolio projects, two passed examinations, a verified internship, and interview narratives grounded in real enterprise problem patterns.

**Target roles include**:

| | |
|---|---|
| IT Support Specialist | IAM Analyst |
| Help Desk Technician | Identity Support Analyst |
| Service Desk Analyst | Access Management Administrator |
| Desktop Support Technician | Junior IAM Administrator |

---

## Who This Program Is For

**This program is designed for**:

- Career changers seeking structured, verifiable entry into enterprise IT and identity roles
- Early-career IT professionals (help desk, support, field service) specializing into IAM
- Students and recent graduates who need demonstrable experience, not another credential alone
- Self-taught learners who have consumed tutorials but lack a portfolio that proves applied skill

**This program is NOT a fit for**:

- Those seeking passive, watch-only video content — every unit requires hands-on lab work
- Those unwilling to publish their work publicly — the GitHub portfolio is a completion requirement
- Those unable to commit 10-15 hours per week for 12 weeks
- Experienced IAM engineers seeking advanced architecture training

---

## Frequently Asked Questions

**Do I need prior IT experience?**
No. Phase I builds the operational foundation from first principles before the identity specialization begins.

**What equipment do I need?**
A computer capable of running a virtual machine and a reliable internet connection. Minimum specifications and alternatives for lower-spec machines are provided at orientation. Use the simulator first; consult the environment guide for optional VM and cloud prerequisites.

**Is the program self-paced or scheduled?**
The program is cohort-paced across 12 weeks with a defined weekly schedule. The daily discipline is flexible within each week, allowing students to work around employment.

**What happens if I do not pass an examination?**
Students may retake examinations under the program retake policy, which includes a required preparation period between attempts. Both examinations must be passed to complete the program.

**How is the internship verified?**
Internship cases are logged and documented to a defined standard, reviewed by Technobiz, and verified upon program completion. Employers may verify the internship with Technobiz.

**How is this different from a certification course?**
Certification courses prepare you to pass a written test. This program produces eight published portfolio projects and a verified internship. Certifications tell employers what you studied; a portfolio shows what you can do. Many graduates pursue certifications afterward with a significant head start.

**Will this guarantee me a job?**
No responsible program guarantees employment. This program is engineered to remove the most common reason entry-level candidates fail to convert: the absence of demonstrable experience. The Run Phase then provides a structured placement system.

---

## Program Policies

- **Daily Expectations**: Complete assigned lessons, complete assigned lab work, post a structured reflection. Consistency, not intensity, predicts completion.
- **Examination Policy**: Both exams are taken in a single timed sitting. Passing standard is 80%. Retakes are available under the retake policy, with a required preparation period between attempts.
- **Academic Integrity**: All portfolio work must be the student's own. Peers and interns guide troubleshooting rather than complete work on another student's behalf. Examinations are individual assessments.
- **Support**: Lab support community overseen by Technobiz staff, plus a program support ticketing channel for administrative matters.

---

## Getting Started with IAM Range

1. **Install IAM Range** from GitHub Releases
2. **Sign in as `admin`** (password shown on the sign-in panel)
3. **Complete Phase I**: Start with the AD Enterprise Lab — networking, AD DS, DNS, domain join
4. **Work the Ticket Queue**: Each ticket reflects your environment's actual state
5. **Build Phase II**: Use the Portfolio labs and Cloud Identity console
6. **Reference this syllabus** alongside each project

---

*This syllabus is a high-level summary of the program of study. For enrollment details, contact Technobiz.*
