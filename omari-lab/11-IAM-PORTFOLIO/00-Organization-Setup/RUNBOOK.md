# 00 — Enterprise Organization Setup Runbook

This builds the enterprise identity framework the ten portfolio projects run on. It spans three directories:

```
                 [ ENTERPRISE IDENTITY BOUNDARY ]
                               |
          +--------------------+--------------------+
          |                    |                    |
 [ Active Directory ]  [ Microsoft Entra ID ]  [ Okta Developer ]
  On-premises core      Cloud architecture      Workforce access management
```

## Unified security policy

**Tiering model**

| Tier | Plane | Contains |
|---|---|---|
| Tier 0 | Control plane | Domain controllers, identity providers (IdP), root certificates, identity vaults |
| Tier 1 | Systems | Core infrastructure, business-critical servers, databases, core SaaS platforms |
| Tier 2 | Workstation / end user | Standard workstations, mobile devices, standard tools |

**Naming standards**

| Object | Standard | Example |
|---|---|---|
| UPN, on-premises | `[first_initial][lastname]@corp.local` | `sjohnson@corp.local` |
| UPN, cloud | `[first_initial][lastname]@[yourdomain].com` | `sjohnson@contoso.com` |
| Service account | `svc-[application]` | `svc-entra-connect` |
| Security group | `[Environment]-[Department]-[Resource/Role]-[AccessType]` | `Prod-HR-Workday-ReadWrite`, `Prod-Eng-SourceCode-Read` |

## Directory 1 — Active Directory (automated)

Run on DC01, which the Vagrantfile builds as `corp.local`:

```powershell
.\Invoke-EnterpriseOrgSetup.ps1 -WhatIf   # preview
.\Invoke-EnterpriseOrgSetup.ps1
```

The script creates the following, and is safe to re-run:

- **OU tree:** `Enterprise_Root`, containing `Tier0_Admins`, `Tier1_Systems`, `Tier2_Staff`, `Groups` (with `Security_Groups` and `Distribution_Groups` inside) and `Disabled_Accounts`.
- **Global security groups:** `GS-Finance-Accounting-RW`, `GS-Engineering-DevOps-Admin` and `GS-HR-Onboarding-RO`.
- **Password policy:** minimum length 14, history 24, maximum age 90 days, complexity on, reversible encryption off.
- **GPO:** `Default_Enterprise_Password_Policy`, linked to `Enterprise_Root`.

> **Audit note: the blueprint puts the password policy in the wrong place.** It sets the password policy in a GPO linked to `Enterprise_Root`. Windows applies domain-account password settings **only from the domain root**. The same settings in an OU-linked GPO change only *local* accounts on computers in that OU. So the script sets the policy at the domain level, and still creates and links the GPO so the structure matches the blueprint. When different groups need different rules, use Fine-Grained Password Policies.

You can practise the same AD build with a checker inside IAM Range: **AD Enterprise Lab → Lab 12: Enterprise Organization Setup**. It works in the simulator or on the real VirtualBox VMs.

## Directory 2 — Microsoft Entra ID (manual, portal)

Use the [Microsoft Entra admin center](https://entra.microsoft.com/).

1. **Administrative units:** Identity → Roles & admins → Administrative units → Add.
   - Create `AU-HQ-Tier2-Staff`, `AU-Global-Finance` and `AU-Global-Engineering`.
   - These scope helpdesk roles to one unit instead of the whole tenant.
2. **Dynamic group:** Identity → Groups → New group.
   - Group type: **Security**. Name: `Cloud-Eng-AllDevelopers-Dynamic`. Membership type: **Dynamic User**.
   - Dynamic query:
     ```text
     (user.department -eq "Engineering") and (user.accountEnabled -eq true)
     ```
   - Project 1 (JML) relies on this group.
3. **User settings:** Identity → Users → User settings.
   - **App registrations: No**, so users can't register their own apps.
   - **Restrict access to Microsoft Entra admin center: Yes.** Note that this only hides the portal; it doesn't block Graph, PowerShell or the CLI. Real enforcement needs Conditional Access. Record that as a finding.

Evidence for each step: a screenshot, plus an export of the audit log entry.

## Directory 3 — Okta (manual, admin console)

1. **Groups:** Directory → Groups → Add group. Create `Okta-Finance-SaaS-AppAccess` and `Okta-Engineering-CloudInfrastructure`.
2. **Custom attribute:** Directory → Profile Editor → User → Add attribute.
   - Display name: **Clearance Level** (the blueprint's "Clear Clearance Level" is a typo).
   - Variable name: `clearanceLevel`. Enumerated values: `Tier0`, `Tier1`, `Tier2`.
3. **Authentication policy:** Security → Authentication Policies → Add Policy, named `Enterprise-Adaptive-SignOn`.
   - Rule: a member of `Okta-Engineering-CloudInfrastructure` re-authenticates every **12 hours**, using strong (phishing-resistant) authenticators.

Evidence: an export of the policy rule, plus a System Log entry showing it applied.

## Environment

| Component | Where |
|---|---|
| VMs | `Vagrantfile`: DC01 `192.168.56.10` (`corp.local`) and LNX01 `192.168.56.20` (Docker CE), on a host-only network |
| Workspace | `New-IamPortfolioWorkspace.ps1` builds `IAM-Portfolio-Labs/`, after checking that local Ollama is running |
| Instructor | `.ollama-instructor/config.json`, also used by **IAM Range → IAM Portfolio** |
