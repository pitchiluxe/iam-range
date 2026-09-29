# Lab 7 — Conditional Access Deep Dive

**Days 43–49 · Phase 2: Entra ID & Cloud Identity · Repo:** `iam-entra-id-lab` (folder `conditional-access/`)

## Do this lab in the app

1. **PowerShell (this PC)**: find your public IP for the named location:

```powershell
Invoke-RestMethod https://api.ipify.org
```

2. **Entra admin center** (Browser) → *Protection → Conditional Access*: the
   named location, CA002–CA006 in report-only, then the **What If** tool.
3. **PowerShell (this PC)**: run the export script; open `ca-summary.csv` in
   **Sheets**.
4. Compare with the app's simulated policies: `Get-ConditionalAccessPolicy` in
   **Terminal** lists what the `omari.test` estate enforces.

## Career objective

Design a Conditional Access baseline the way a Zero Trust team would: named,
numbered, tested in report-only, provable with the What If tool, and exported
as code so it can be reviewed like any other change.

## Quick review

1. When two CA policies apply, how are their grant controls combined?
2. Why must a named location use a *public* IP range?
3. What is "legacy authentication", and why can't it do MFA?
4. Grant control vs session control — give one example of each.
5. What does the What If tool tell you that the sign-in log can't?

## Scenario

Audit found: admins sign in without phishing-resistant MFA, legacy IMAP/POP
is still allowed, and Finance stays signed in for days. Fix all three without
breaking anyone and keep break-glass untouched.

## Concept

CA evaluates **every** policy that matches (users + app + conditions). All
grant requirements from all matching policies must be met; any **Block** wins.
There is no policy order.

## Hands-on lab

Every policy below: Exclude `CA-Exclude-BreakGlass`, create in **Report-only**,
verify, then switch On.

### Named location

Find your home public IP (`(Invoke-RestMethod https://api.ipify.org)`).
*Protection → Conditional Access → Named locations → IP ranges location*:
`NL-Home-Lab`, `<your-public-ip>/32`, *Mark as trusted*. A private range like
`192.168.1.0/24` never reaches Entra ID, so it would never match.

### Policies

| # | Name | Users | Target | Conditions | Control |
|---|---|---|---|---|---|
| CA001 | Require-MFA-All-Users | All (from Lab 5) | All cloud apps | — | Grant: MFA |
| CA002 | Block-Legacy-Auth | All users | All cloud apps | **Client apps:** Exchange ActiveSync + Other clients | **Block** |
| CA003 | Admins-Phishing-Resistant | Directory roles: Global Admin, Privileged Role Admin, User Admin, Helpdesk Admin, App Admin | All cloud apps | — | Grant: *Authentication strength → Phishing-resistant MFA* |
| CA004 | Admin-Portals-MFA | All users | **Microsoft Admin Portals** | — | Grant: MFA |
| CA005 | MFA-Outside-Trusted | All users | All cloud apps | Locations: include Any, exclude *All trusted locations* | Grant: MFA |
| CA006 | Finance-Session-Limit | `Finance-Team` | All cloud apps | — | Session: sign-in frequency 4 hours, persistent browser *Never* |

CA003 applies to **your own admin account** too. Register a phishing-resistant
method on it *before* switching CA003 On, or the next admin sign-in fails. If
you don't own a FIDO2 key, use Windows Hello for Business or a
passkey in Microsoft Authenticator, or set CA003 to the built-in *Multifactor
authentication* strength and record why.

### Test

1. **What If** (*Conditional Access → Policies → What If*): Alex from a
   non-trusted IP on Office 365; helpdesk.tech on Microsoft Admin Portals; a
   break-glass account on anything. Screenshot each result.
2. Sign in for real as each and compare the sign-in log's *Conditional Access*
   tab with What If.
3. Legacy auth: try `Test-NetConnection outlook.office365.com -Port 993` and
   explain why a port test is *not* evidence — then find a CA002 report-only
   entry for a legacy client (or document why your tenant has none).

### Policies as code (`conditional-access/Export-C90CaPolicies.ps1`)

```powershell
Connect-MgGraph -Scopes 'Policy.Read.All' -NoWelcome
$out = New-Item -ItemType Directory -Force .\conditional-access\export

Get-MgIdentityConditionalAccessPolicy -All | ForEach-Object {
    $_ | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $out "$($_.DisplayName).json")
    [pscustomobject]@{
        Policy        = $_.DisplayName
        State         = $_.State
        IncludeUsers  = ($_.Conditions.Users.IncludeUsers + $_.Conditions.Users.IncludeRoles) -join ';'
        ExcludeGroups = $_.Conditions.Users.ExcludeGroups -join ';'
        Apps          = $_.Conditions.Applications.IncludeApplications -join ';'
        ClientApps    = $_.Conditions.ClientAppTypes -join ';'
        Grant         = ($_.GrantControls.BuiltInControls -join ';') +
                        $(if ($_.GrantControls.AuthenticationStrength) { ';strength' })
        SignInFreq    = $_.SessionControls.SignInFrequency.Value
    }
} | Tee-Object -Variable summary | Export-Csv .\conditional-access\ca-summary.csv -NoTypeInformation

# Safety check: every enabled policy must exclude the break-glass group
$bg = (Get-MgGroup -Filter "displayName eq 'CA-Exclude-BreakGlass'").Id
Get-MgIdentityConditionalAccessPolicy -All | Where-Object {
    $_.State -ne 'disabled' -and $_.Conditions.Users.ExcludeGroups -notcontains $bg
} | ForEach-Object { Write-Warning "$($_.DisplayName) does NOT exclude break-glass" }

Get-MgIdentityConditionalAccessNamedLocation | ForEach-Object {
    [pscustomobject]@{
        Name    = $_.DisplayName
        Trusted = $_.AdditionalProperties.isTrusted
        Ranges  = ($_.AdditionalProperties.ipRanges | ForEach-Object { $_.cidrAddress }) -join ';'
    }
}
```

## Validation checklist

- Six policies exist, numbered, each excludes `CA-Exclude-BreakGlass`
- Each ran in report-only before being turned On (screenshots)
- `NL-Home-Lab` uses your public IP, marked trusted
- What If results saved for three personas
- Export script produces JSON per policy + `ca-summary.csv`, no warnings
- Break-glass still signs in with no CA applied

## Challenge

IAM-5061: Finance says they are asked to sign in "every few hours" and one
analyst is fully blocked from the Intune portal. Using What If and the sign-in
log, decide which policies are involved (CA006 frequency; CA003 or CA004 for
the portal) and whether the fix is a policy change or a user-registration issue.

## Troubleshooting

| Symptom | Check |
|---|---|
| Policy never applies | Report-only still on? User excluded? App not in scope? |
| Everyone blocked | A Block policy with *All users* and no exclusions — sign in with break-glass |
| Trusted location ignored | Private IP range, or traffic egressing through a VPN |
| Admin can't satisfy CA003 | No phishing-resistant method registered |

## GitHub assignment

`conditional-access/` with the export script, the JSON exports, `ca-summary.csv`,
What If screenshots and `docs/lab07-conditional-access.md` explaining each policy's
*why* in one sentence.

## Resume bullet

> Designed and deployed a six-policy Conditional Access baseline (MFA, legacy
> auth block, phishing-resistant MFA for admins, location and session controls),
> validated in report-only and What If, and exported as JSON for change review.

## Interview question

"Walk me through how you'd troubleshoot a user blocked by Conditional Access."
Sign-in log → CA tab → which policy, which control failed → What If to confirm
→ fix the user (register a method) or the policy (scope), never disable the policy.

## Homework

- Read Microsoft Learn: *Conditional Access: Plan a deployment*.
- Explain why CA has no policy order in two sentences.
