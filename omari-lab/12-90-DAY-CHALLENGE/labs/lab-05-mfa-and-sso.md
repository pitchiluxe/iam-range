# Lab 5 — MFA & SSO

**Days 29–35 · Phase 2: Entra ID & Cloud Identity · Repo:** `iam-entra-id-lab` (folder `mfa-sso/`)

## Do this lab in the app

1. **Entra admin center** (Browser): Steps 0–4 — trial, break-glass accounts,
   security defaults, authentication methods, CA001 in report-only.
2. To sign in *as Alex* without losing your admin session, use **My Apps** above
   after signing out of the portal in the Browser, or use the Browser's
   **Open ↗** button to test Alex in your normal browser's private window.
3. **SAML Toolkit** above opens the toolkit site for Step 5; the Entra side of
   Step 5 is in the Entra admin center.
4. **PowerShell (this PC)**: save Step 6's script as
   `Documents\c90\Get-C90MfaStatus.ps1` (Notepad works) and run:

```powershell
Install-Module Microsoft.Graph.Identity.SignIns, Microsoft.Graph.Reports -Scope CurrentUser -Force
.\c90\Get-C90MfaStatus.ps1 -UserPrincipalName alex.rivera@<tenant>.onmicrosoft.com
```

5. For the decoded SAML assertion, use your normal browser with the
   SAML-tracer extension (extensions are not available in the in-app Browser).

## Career objective

Enforce MFA with Conditional Access without locking yourself out, configure
SAML single sign-on to a real test application, and read a SAML assertion
well enough to troubleshoot one.

## Quick review

1. Authentication factors: something you know / have / are. Which is a push notification?
2. Why is per-user MFA considered legacy?
3. In SAML, who is the IdP and who is the SP when Entra ID signs you in to an app?
4. What is *report-only* mode in Conditional Access?
5. What is a break-glass account for, and why is it excluded from MFA policies?

## Scenario

Security wants MFA for everyone and SSO for a SaaS test app for Sales. You
must deliver both without a single admin getting locked out — including you.

## Concept

```
User ─► App (SP) ─► redirect ─► Entra ID (IdP): password + MFA + CA checks
User ◄─ App ◄─ POST signed SAML assertion (NameID, claims) ◄─ Entra ID
```

MFA belongs in **Conditional Access**; the **Authentication methods policy**
decides which factors users may register.

## Hands-on lab

### Step 0 — day 29: start the P2 trial

*Billing → Licenses → All products → Try/Buy → Microsoft Entra ID P2 → Activate.*
Assign a P2 licence to yourself, Alex and the helpdesk account.

### Step 1 — break-glass accounts FIRST

1. Create `bg-admin-01@<tenant>.onmicrosoft.com` and `bg-admin-02@…`: cloud-only,
   Global Administrator, 20+ character random passwords stored offline.
2. Create a security group `CA-Exclude-BreakGlass` with both accounts.
3. Every Conditional Access policy you ever create excludes this group.
4. Sign in once with each to prove they work. Record in `docs/break-glass.md`
   *where* the passwords are kept — never the passwords.

### Step 2 — switch off Security defaults

*Overview → Properties → Manage security defaults → Disabled* (reason: "using
Conditional Access"). From this moment your only MFA is what you configure — do
Step 3 immediately.

### Step 3 — authentication methods

*Protection → Authentication methods → Policies → Microsoft Authenticator →
Enable → All users*. Then *Registration campaign → Enabled*, snooze 1 day.

### Step 4 — Conditional Access: require MFA

*Protection → Conditional Access → Create new policy*

| Setting | Value |
|---|---|
| Name | `CA001-Require-MFA-All-Users` |
| Users | Include: All users · Exclude: `CA-Exclude-BreakGlass` |
| Target resources | All cloud apps |
| Grant | Require multifactor authentication |
| Enable policy | **Report-only** |

Sign in as Alex, then check the sign-in log's **Report-only** tab: it should
say the policy *would* have required MFA. Only then switch it to **On**. Test
again: Alex is prompted to register Authenticator, then for MFA.

### Step 5 — SAML SSO with the Microsoft Entra SAML Toolkit

1. *Enterprise applications → New application →* search **Microsoft Entra SAML
   Toolkit** → Create.
2. Follow Microsoft Learn's tutorial for that app: register on the toolkit site,
   create a SAML configuration there, and copy the Sign-on URL, Identifier and
   Reply URL it gives you into *Single sign-on → SAML → Basic SAML Configuration*.
3. *Attributes & Claims*: NameID = `user.userprincipalname`; add `department`
   → `user.department`.
4. Download the **Certificate (Base64)** and the **Login URL**; paste them into
   the toolkit's configuration.
5. *Users and groups →* assign `Sales-Team`.
6. As Alex, open <https://myapps.microsoft.com> → the tile → you land signed in,
   and the toolkit shows the claims it received.
7. Install the *SAML-tracer* browser extension, repeat, and save the decoded
   assertion (with lab data only) as `mfa-sso/saml-assertion-sample.xml`.

### Step 6 — troubleshooting script (`mfa-sso/Get-C90MfaStatus.ps1`)

```powershell
param([Parameter(Mandatory)][string]$UserPrincipalName)   # param() must be the first statement

Connect-MgGraph -Scopes 'UserAuthenticationMethod.Read.All','Policy.Read.All','AuditLog.Read.All' -NoWelcome
$user = Get-MgUser -UserId $UserPrincipalName -ErrorAction Stop

Write-Host "Registered methods for $UserPrincipalName" -ForegroundColor Cyan
Get-MgUserAuthenticationMethod -UserId $user.Id |
    Select-Object @{ n = 'Method'; e = { $_.AdditionalProperties['@odata.type'] -replace '#microsoft.graph.' } }

Write-Host "Enabled Conditional Access policies" -ForegroundColor Cyan
Get-MgIdentityConditionalAccessPolicy | Where-Object State -ne 'disabled' |
    Select-Object DisplayName, State

Write-Host "Last 10 sign-ins (needs P1)" -ForegroundColor Cyan
Get-MgAuditLogSignIn -Filter "userPrincipalName eq '$UserPrincipalName'" -Top 10 |
    Select-Object CreatedDateTime, AppDisplayName, ConditionalAccessStatus,
        @{ n = 'Result'; e = { if ($_.Status.ErrorCode -eq 0) { 'Success' } else { "$($_.Status.ErrorCode) $($_.Status.FailureReason)" } } }
```

## Validation checklist

- Two break-glass accounts work and are excluded via `CA-Exclude-BreakGlass`
- CA001 ran in report-only first, with a screenshot of the report-only result
- CA001 is On; Alex registered Authenticator and gets MFA prompts
- SAML Toolkit SSO works from My Apps for a `Sales-Team` member only
- A user outside `Sales-Team` gets `AADSTS50105` (not assigned)
- Decoded SAML assertion saved (lab data only)

## Challenge

IAM-3042: Maria clicks the SAML app and gets "We couldn't sign you in." Order
your checks: assignment (`AADSTS50105`), Reply URL mismatch (`AADSTS50011`),
Identifier mismatch (`AADSTS700016`), expired signing certificate, clock skew
on the SP. Which of those can you see in Entra's sign-in log, and which only at
the app?

## Troubleshooting

| Code | Meaning |
|---|---|
| `AADSTS50076` / `50079` | MFA required / registration required |
| `AADSTS53003` | Blocked by Conditional Access |
| `AADSTS50105` | User not assigned to the app |
| `AADSTS50011` | Reply URL doesn't match the app config |

Paste any code into <https://login.microsoftonline.com/error>.

## GitHub assignment

`mfa-sso/` with the script, `docs/lab05-mfa-sso.md` (screenshots of CA001,
report-only result, My Apps SSO, claims), `docs/break-glass.md`.

## Resume bullet

> Enforced MFA through Conditional Access (report-only validation first, with
> excluded break-glass accounts) and configured SAML 2.0 SSO for a SaaS app,
> including claims mapping and assertion-level troubleshooting.

## Interview question

"How would you roll out MFA to 5,000 users without an outage?" Break-glass
first, report-only, pilot group, registration campaign, comms, then enforce.

## Homework

- Read Microsoft Learn: *Manage emergency access accounts in Microsoft Entra ID*.
- Explain in 100 words the difference between SAML and OIDC.
