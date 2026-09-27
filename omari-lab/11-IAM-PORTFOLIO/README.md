# IAM Portfolio Labs: 10 projects across IGA, AM and PAM

This kit builds the workspace and lab infrastructure for a 10-project IAM portfolio, and sets up the local Ollama instructor that reviews your work.

| File | Purpose |
|---|---|
| `Test-OllamaInstructor.ps1` / `test-ollama-instructor.sh` | **Pre-check.** Calls `http://localhost:11434/api/tags`. On success it prints `OLLAMA LOCAL INSTANCE VERIFIED: Training Instructor Integrated.` On failure it halts and prints step-by-step instructions for starting Ollama on your OS. |
| `New-IamPortfolioWorkspace.ps1` / `new-iam-portfolio-workspace.sh` | Runs the pre-check, then builds `IAM-Portfolio-Labs/`. Each folder `00`–`10` gets `README.md` and `scripts/`, plus `.ollama-instructor/config.json` and `system-prompt.txt`. It never overwrites your READMEs; `-Force` refreshes the instructor config. |
| `ollama-instructor.config.json` | **The single source of truth** for the instructor: endpoint, preferred models, the exact system prompt, the rubric and all 10 projects. The workspace copies it, and IAM Range's **IAM Portfolio** app imports it. |
| `Vagrantfile` | DC01 (Windows Server 2022, `192.168.56.10`, AD DS `corp.local`) and LNX01 (Ubuntu 22.04, `192.168.56.20`, Docker CE), on a host-only network. |
| `vm/` | **The real-VM track.** Runs six of the projects on the AD lab's real **ADLab-DC01** VirtualBox VM. See below. |
| `00-Organization-Setup/` | `Invoke-EnterpriseOrgSetup.ps1` builds the AD organization. `RUNBOOK.md` covers the tiering model, the naming standard, and the Entra ID and Okta setup steps. |

## Quick start (Windows)

```powershell
cd omari-lab\11-IAM-PORTFOLIO
.\New-IamPortfolioWorkspace.ps1                  # pre-check + workspace in Documents\IAM-Portfolio-Labs

$env:IAMLAB_DSRM_PASSWORD = Read-Host -AsSecureString | ConvertFrom-SecureString -AsPlainText
vagrant up dc01                                  # AD DS forest corp.local (promotion reboots once)
vagrant up lnx01                                 # Ubuntu + Docker CE
```

Then run `00-Organization-Setup\Invoke-EnterpriseOrgSetup.ps1` on DC01, and open **IAM Range → IAM Portfolio**.

> **Before `vagrant up`:** turn Windows' hypervisor off (Memory integrity, Virtual Machine Platform and `hypervisorlaunchtype off`). Otherwise VirtualBox runs through Hyper-V and is very slow. See `../10-AD-ENTERPRISE-VBOX/README.md`.

## The real-VM track (DC01)

Six projects are the on-premises side of the brief and run on the AD Enterprise Lab's real `ADLab-DC01` VM (`../10-AD-ENTERPRISE-VBOX`):

| Project | What is seeded in DC01 | What the checker reads |
|---|---|---|
| **P01** JML | HR feed `C:\IAM\HR\hr_feed.csv`: a joiner, a mover (Sales → Finance) and a leaver | the accounts, group membership, the Terminated Users OU, the log and script in `C:\IAM\JML` |
| **P02** RBAC | four users, and the Finance, Engineering and HR shares under `C:\Shares` | the Role-/Res- groups (AGDLP), folder ACLs, no path to an admin group, the access matrix |
| **P03** Access review | `GG-Engineering-Restricted` with a user who should not be there, plus a direct ACE | the review request, decisions, remediation log and before/after report in `C:\IAM\UAR` |
| **P04** Stale accounts | three dormant accounts, an active user, a service account and a break-glass account | disabled and scrambled dormant accounts, exclusions untouched, the report and deletion queue |
| **P08** JIT | the AD PAM optional feature, requester `dkim`, approver `sec.lead` | a time-bound (TTL) Domain Admins membership, no standing access, the ticketed elevation log |
| **P10** SIEM | real Security events: a 1102 log clear, four 4625 then a 4624, and a Domain Admins add | your detection queries and `C:\IAM\SIEM\alerts.csv` |

In **IAM Range → IAM Portfolio**, each of these projects shows three buttons:

1. **Prepare DC01 (once).** `vm/Initialize-PortfolioDC.ps1` needs DC01 at the end of AD Lab 01. It promotes it to `corp.technobiz.local` (the DSRM password is random, generated in the guest and never stored), builds the enterprise baseline and saves the snapshot **Portfolio-Base**. It takes 10–30 minutes.
2. **Set up this project.** `vm/Set-PortfolioScenario.ps1 -Project pNN` seeds (or re-seeds) the scenario. Seeded user passwords are random and never shown: you don't need them.
3. **Check my work on the VM.** `vm/Get-PortfolioFacts.ps1` reads DC01 **read-only**, and the app grades it with deterministic checks. The instructor then coaches on the failures; it never changes the VM.

Do the work *inside DC01* (VirtualBox console, as `CORP\Administrator`) with PowerShell you write yourself. Only work done after the project was set up counts. To start over, restore the snapshot (`..\10-AD-ENTERPRISE-VBOX\AdLab-Snapshot.ps1 -Restore Portfolio-Base -Only DC01`) and set the project up again.

Projects 5, 6, 7 and 9 need a cloud tenant (Entra ID, Okta, AWS), so they stay on the workspace and submission-review track.

## Isolation

- **Lab traffic** stays on the VirtualBox **host-only** network `192.168.56.0/24`. Only this PC and the VMs can reach it.
- **No bridged or public adapters** are used.
- **Adapter 1 is VirtualBox NAT**, which Vagrant needs for SSH and WinRM. NAT is outbound-only, and every forwarded management port is bound to `127.0.0.1`.
- **The DSRM password** is read from `IAMLAB_DSRM_PASSWORD` at run time and never written to a file.

## The instructor

The instructor's system prompt (`systemPrompt` in the config) makes it act as:

- a code reviewer and security auditor that judges every script, policy and query strictly against **least privilege**;
- a **SOX / SOC 2 compliance auditor**, asking who approved a change, what evidence proves it, how it is reversed, and where it is logged;
- a teacher who never gives the answer first: direction, then investigation, then concept, and only after that the fix described in words.

In IAM Range, the **IAM Portfolio** app puts this together:

- A **deterministic least-privilege checker** runs on each submission. It catches wildcard IAM actions and principals, ExternalId or MFA conditions missing from trust policies, secrets in code, Domain Admins additions, JWT or TLS validation that has been switched off, PIM activations longer than 2 hours, and destructive scripts with no dry-run or audit log.
- The model reviews the submission and scores the rubric. It must quote a line for every finding it adds, and it treats the checker's findings as facts it can't contradict.
- Replies stream in as the model writes them, formatted as Markdown: numbered findings, severity badges and a rubric table.
- **Clear chat** clears the conversation but keeps your submission and progress.

Projects are marked complete only when you tick every deliverable yourself. The AI never marks a project complete.
