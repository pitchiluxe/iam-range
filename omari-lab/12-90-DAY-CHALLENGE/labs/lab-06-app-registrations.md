# Lab 6 — Enterprise Apps & App Registrations

**Days 36–42 · Phase 2: Entra ID & Cloud Identity · Repo:** `iam-entra-id-lab` (folder `apps/`)

## Do this lab in the app

1. **Entra admin center** (Browser) → *App registrations*: Parts A and B.
2. **PowerShell (this PC)**: paste the client-credentials test from Part B. The
   `Read-Host 'Client secret' -AsSecureString` line shows a masked box — paste
   the secret there; it never appears in the console output.
3. **jwt.ms** above: paste the token and screenshot the `roles` claim.
4. **PowerShell (this PC)**: run Part C's inventory script and open
   `apps\app-inventory.csv` in the app's **Sheets**.

## Career objective

Know the difference between an **app registration** (the app's definition) and
an **enterprise application** (its service principal in your tenant), grant
delegated vs application permissions correctly, and audit every app's secrets
and permissions — work that lands on IAM teams weekly.

## Quick review

1. Delegated vs application permission: whose identity is used in each?
2. What does *admin consent* record, and where?
3. Why do client secrets expire, and why is a certificate better?
4. What is `api://<app-id>` for?
5. Which Graph application permissions are effectively Global Admin?

## Scenario

Developers built an internal API and a nightly provisioning job. You must
register both with least privilege, expose a scope for the API, and deliver a
report of every app in the tenant with its permissions and credential expiry.

## Concept

| | App registration | Enterprise application |
|---|---|---|
| What | Global definition (IDs, redirect URIs, permissions requested) | Local instance (service principal) |
| Who | Developers | IAM / admins |
| Where consent lives | — | Here |
| SSO, assignment, provisioning | — | Here |

## Hands-on lab

### Part A — an API that exposes a scope

1. *App registrations → New registration →* `C90 Internal API`, single tenant.
2. *Expose an API →* Application ID URI `api://<client-id>` → *Add a scope*
   `Reports.Read`, *Admins and users*, enabled.
3. *App roles → Create app role* `Reports.Read.All`, allowed member types
   *Applications*.

### Part B — a daemon with least privilege

1. *New registration →* `C90 Provisioning Job`, single tenant, no redirect URI.
2. *API permissions → Microsoft Graph → Application →* `User.Read.All`,
   `GroupMember.ReadWrite.All`. **Do not add** `Application.ReadWrite.All`
   or `RoleManagement.ReadWrite.Directory` — either lets the app grant itself
   anything, which makes it a Global Admin in disguise.
3. *Grant admin consent*.
4. *Certificates & secrets → New client secret*, 90 days. Copy the value once
   into a password manager; it never goes in a file.

Test the client-credentials flow:

```powershell
$tenantId = '<tenant-id>'
$clientId = '<daemon-client-id>'
$secret   = Read-Host 'Client secret' -AsSecureString
$plain    = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
              [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret))

$token = (Invoke-RestMethod -Method Post -Uri "https://login.microsoftonline.com/$tenantId/oauth2/v2.0/token" -Body @{
    client_id = $clientId; client_secret = $plain; grant_type = 'client_credentials'
    scope = 'https://graph.microsoft.com/.default'
}).access_token

Invoke-RestMethod -Uri 'https://graph.microsoft.com/v1.0/users?$select=displayName,userPrincipalName' `
    -Headers @{ Authorization = "Bearer $token" } | Select-Object -ExpandProperty value
```

Paste the token into <https://jwt.ms>: find `aud`, `roles`, `tid`, `exp`. Note
there is no `scp` claim — app-only tokens carry `roles`.

### Part C — app inventory (`apps/Get-C90AppInventory.ps1`)

```powershell
Connect-MgGraph -Scopes 'Application.Read.All','Directory.Read.All' -NoWelcome
$graphSp = Get-MgServicePrincipal -Filter "appId eq '00000003-0000-0000-c000-000000000000'"
$roleName = @{}; $graphSp.AppRoles | ForEach-Object { $roleName[$_.Id] = $_.Value }
$risky = 'Application.ReadWrite.All','AppRoleAssignment.ReadWrite.All','RoleManagement.ReadWrite.Directory','Directory.ReadWrite.All'

Get-MgApplication -All | ForEach-Object {
    $app = $_
    $sp  = Get-MgServicePrincipal -Filter "appId eq '$($app.AppId)'"
    $granted = if ($sp) {
        Get-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $sp.Id |
            Where-Object ResourceId -eq $graphSp.Id | ForEach-Object { $roleName[$_.AppRoleId] }
    }
    $expiries = @($app.PasswordCredentials.EndDateTime) + @($app.KeyCredentials.EndDateTime) | Where-Object { $_ }
    [pscustomobject]@{
        App            = $app.DisplayName
        AppId          = $app.AppId
        Secrets        = $app.PasswordCredentials.Count
        Certificates   = $app.KeyCredentials.Count
        NextExpiry     = ($expiries | Sort-Object | Select-Object -First 1)
        GraphAppPerms  = ($granted -join ';')
        Risky          = [bool]($granted | Where-Object { $_ -in $risky })
    }
} | Tee-Object -Variable inv | Export-Csv .\apps\app-inventory.csv -NoTypeInformation
$inv | Sort-Object Risky, NextExpiry -Descending | Format-Table
```

### Part D — (optional) SCIM provisioning

SCIM needs a target that accepts it. If you have a **GitHub Enterprise Cloud
trial**, add the gallery app *GitHub Enterprise Cloud – Organization*, configure
SAML, then *Provisioning → Automatic* with an org token, assign `Engineering-Team`,
and use **Provision on demand** for one user. Otherwise, read the provisioning
logs of any gallery app and document the attribute mappings. Lab 9 covers the
lifecycle side.

## Validation checklist

- `C90 Internal API` exposes `Reports.Read` and an app role
- Daemon has only `User.Read.All` + `GroupMember.ReadWrite.All`, consented
- Client-credentials token decoded; `roles` claim screenshotted
- No secret in any file or commit (`git log -p | Select-String secret` is clean)
- `apps/app-inventory.csv` lists every app with next credential expiry
- (Optional) one user provisioned via SCIM

## Challenge

IAM-4051: the provisioning job suddenly returns **403 Forbidden** on
`/users`. List the causes in order of likelihood: consent revoked, permission
removed, wrong tenant, token from a different app, a CA policy for workload
identities. How would the error differ if the *secret* had expired? (401, and
`AADSTS7000222` at the token endpoint.)

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `AADSTS7000215` invalid client secret | Wrong value — you copied the secret ID, not the value |
| `AADSTS7000222` | Secret expired |
| `403 Authorization_RequestDenied` | Permission missing or not consented |
| Token has `scp`, not `roles` | You used a delegated flow |

## GitHub assignment

`apps/Get-C90AppInventory.ps1`, a redacted `app-inventory.csv`, and
`docs/lab06-apps.md` with the registration-vs-enterprise-app table in your own words.

## Resume bullet

> Registered APIs and daemon apps in Entra ID with least-privilege Graph
> permissions, and built an inventory that flags high-risk app permissions and
> expiring client credentials across the tenant.

## Interview question

"A developer asks for `Directory.ReadWrite.All` for their app. What do you do?"
Ask what it actually calls, map each call to the narrowest permission, prefer a
certificate, set an owner and a review date.

## Homework

- Replace the daemon's secret with a self-signed certificate and re-test.
- Read Microsoft Learn: *Overview of permissions and consent in the Microsoft identity platform*.
