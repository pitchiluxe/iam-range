# Lab 8 — Microsoft Graph & OAuth Deep Dive

**Days 50–56 · Phase 2: Entra ID & Cloud Identity · Repo:** `iam-graph-automation`

## Do this lab in the app

1. **Entra admin center** (Browser): add `AuditLog.Read.All` to the Lab 6
   daemon app and grant consent.
2. **PowerShell (this PC)**: set the three `$env:C90_*` variables (Part A),
   save the module as `Documents\c90\C90.Graph.psm1`, then:

```powershell
Import-Module .\c90\C90.Graph.psm1 -Force
$t = Get-C90GraphToken
Invoke-C90Graph -Token $t -Uri '/organization' | Select-Object displayName, id
```

   Environment variables last only as long as this console session — click
   **New session** and they are gone, which is the point.
3. **Graph Explorer** and **jwt.ms** above: Part D's delegated-vs-app token
   comparison.

## Career objective

Call Microsoft Graph directly over REST with OAuth 2.0 — acquire tokens, page
through results, survive throttling, and build a stale-account report — so the
SDK stops being magic and every 401/403/429 is something you can explain.

## Quick review

1. Name three OAuth 2.0 grant types and when each is used.
2. What do `aud`, `scp`, `roles` and `exp` mean in an access token?
3. What does `@odata.nextLink` tell you?
4. What should a client do on HTTP 429?
5. Why must a user have `usageLocation` before you assign a licence?

## Scenario

IAM wants three unattended jobs: add HR's new hires to their department group,
report accounts with no sign-in for 30 days, and do it all with an app identity
— no human session, no secret in a file.

## Concept — the flows

| Flow | Who | Token carries | Use |
|---|---|---|---|
| Authorization code + PKCE | User in a browser app | `scp` (delegated) | Web / SPA / mobile |
| Device code | User on a CLI | `scp` | Scripts run by a person |
| Client credentials | The app itself | `roles` (application) | Daemons, schedulers |

## Hands-on lab

### Part A — app identity

Reuse `C90 Provisioning Job` from Lab 6. Add application permission
`AuditLog.Read.All` (for `signInActivity`, needs P1) and consent. Store the
secret in an environment variable for this session only:

```powershell
$env:C90_TENANT_ID = '<tenant-id>'
$env:C90_CLIENT_ID = '<client-id>'
$env:C90_CLIENT_SECRET = Read-Host 'Client secret'   # session only; never in a file
```

### Part B — the module (`C90.Graph.psm1`)

```powershell
function Get-C90GraphToken {
    $body = @{
        client_id = $env:C90_CLIENT_ID; client_secret = $env:C90_CLIENT_SECRET
        grant_type = 'client_credentials'; scope = 'https://graph.microsoft.com/.default'
    }
    (Invoke-RestMethod -Method Post -Body $body `
        -Uri "https://login.microsoftonline.com/$($env:C90_TENANT_ID)/oauth2/v2.0/token").access_token
}

function Invoke-C90Graph {
    param(
        [Parameter(Mandatory)][string]$Token,
        [Parameter(Mandatory)][string]$Uri,
        [string]$Method = 'GET',
        $Body,
        [switch]$All   # follow @odata.nextLink
    )
    if ($Uri -notmatch '^https://') { $Uri = "https://graph.microsoft.com/v1.0$Uri" }
    $headers = @{ Authorization = "Bearer $Token"; ConsistencyLevel = 'eventual' }
    do {
        for ($attempt = 1; ; $attempt++) {
            try {
                $req = @{ Method = $Method; Uri = $Uri; Headers = $headers; ErrorAction = 'Stop' }
                if ($null -ne $Body) { $req.Body = ($Body | ConvertTo-Json -Depth 10); $req.ContentType = 'application/json' }
                $resp = Invoke-RestMethod @req
                break
            } catch {
                $status = $_.Exception.Response.StatusCode.value__
                if ($status -in 429, 503, 504 -and $attempt -lt 5) {
                    $wait = [int]($_.Exception.Response.Headers['Retry-After'] | Select-Object -First 1)
                    if (-not $wait) { $wait = [math]::Pow(2, $attempt) }
                    Write-Warning "HTTP $status — retrying in $wait s"; Start-Sleep -Seconds $wait
                } else { throw }
            }
        }
        if ($resp.PSObject.Properties.Name -contains 'value') { $resp.value } else { $resp }
        $Uri = if ($All) { $resp.'@odata.nextLink' } else { $null }
    } while ($Uri)
}

function Add-C90GroupMember {
    param([string]$Token, [string]$GroupId, [string]$UserId)
    # POST /groups/{id}/members/$ref with an @odata.id body — not /members/{userId}/$ref
    Invoke-C90Graph -Token $Token -Method POST -Uri "/groups/$GroupId/members/`$ref" `
        -Body @{ '@odata.id' = "https://graph.microsoft.com/v1.0/directoryObjects/$UserId" }
}

function Set-C90License {
    param([string]$Token, [string]$UserId, [string]$SkuPartNumber)
    $sku = Invoke-C90Graph -Token $Token -Uri '/subscribedSkus' | Where-Object skuPartNumber -eq $SkuPartNumber
    if (-not $sku) { throw "SKU $SkuPartNumber not in this tenant" }
    if (($sku.prepaidUnits.enabled - $sku.consumedUnits) -lt 1) { throw "No free $SkuPartNumber licences" }
    Invoke-C90Graph -Token $Token -Method PATCH -Uri "/users/$UserId" -Body @{ usageLocation = 'US' }
    Invoke-C90Graph -Token $Token -Method POST -Uri "/users/$UserId/assignLicense" `
        -Body @{ addLicenses = @(@{ skuId = $sku.skuId }); removeLicenses = @() }   # skuId is a GUID
}

function Get-C90StaleUsers {
    param([string]$Token, [int]$Days = 30)
    $cutoff = (Get-Date).AddDays(-$Days)
    Invoke-C90Graph -Token $Token -All -Uri '/users?$select=displayName,userPrincipalName,accountEnabled,createdDateTime,signInActivity&$top=100' |
        ForEach-Object {
            $last = $_.signInActivity.lastSignInDateTime
            if (-not $last -or [datetime]$last -lt $cutoff) {
                [pscustomobject]@{
                    User = $_.userPrincipalName; Enabled = $_.accountEnabled
                    LastSignIn = $last; Created = $_.createdDateTime
                }
            }
        }
}

Export-ModuleMember -Function Get-C90GraphToken, Invoke-C90Graph, Add-C90GroupMember, Set-C90License, Get-C90StaleUsers
```

### Part C — run it

```powershell
Import-Module .\C90.Graph.psm1 -Force
$t = Get-C90GraphToken

# 1. Department groups for new hires
$groups = @{}
Invoke-C90Graph -Token $t -All -Uri "/groups?`$filter=endswith(displayName,'-Team')&`$count=true" |
    ForEach-Object { $groups[$_.displayName] = $_.id }
foreach ($row in Import-Csv .\data\new-hires.csv) {
    $u = Invoke-C90Graph -Token $t -Uri "/users/$($row.SamAccountName)@<tenant>.onmicrosoft.com"
    try { Add-C90GroupMember -Token $t -GroupId $groups["$($row.Department)-Team"] -UserId $u.id; "added $($row.SamAccountName)" }
    catch { if ($_.ErrorDetails.Message -match 'already exist') { "already $($row.SamAccountName)" } else { throw } }
}

# 2. Stale accounts
Get-C90StaleUsers -Token $t -Days 30 | Export-Csv .\reports\stale-users.csv -NoTypeInformation

# 3. Licensing (only if your tenant has a SKU — list them first)
Invoke-C90Graph -Token $t -Uri '/subscribedSkus' | Select-Object skuPartNumber, skuId, consumedUnits
```

### Part D — see a delegated token

Open <https://developer.microsoft.com/graph/graph-explorer>, sign in as Alex,
run `GET https://graph.microsoft.com/v1.0/me`, then open the **Access token**
tab and paste it into <https://jwt.ms>. Compare with the app-only token from
Lab 6: `scp` vs `roles`, `upn` present vs absent.

## Validation checklist

- No secret in any file; `git grep -i secret` shows only variable names
- Group-add is idempotent (second run says "already")
- `reports/stale-users.csv` produced from `signInActivity`
- You forced a 429 or read the retry code path and can explain it
- Delegated and app-only tokens decoded side by side (screenshots, redacted)

## Challenge

IAM-6072: the licence script "succeeds" but Engineering users have no licence.
Candidates: `usageLocation` missing, `skuId` given as a part number instead of
a GUID, no free units, group-based licensing conflict, the script swallowing
the error. Which of these does `Set-C90License` above already defend against?

## Troubleshooting

| Status | Meaning | Fix |
|---|---|---|
| 400 | Bad request body / filter | Read `error.message`; `$filter` on some properties needs `ConsistencyLevel: eventual` + `$count=true` |
| 401 | Token missing/expired/wrong audience | New token; `aud` must be Graph |
| 403 | Permission not granted | Add + consent the application permission |
| 404 | Wrong ID / UPN | Check the tenant domain |
| 429 | Throttled | Honour `Retry-After` |

## GitHub assignment

Repo `iam-graph-automation`: `C90.Graph.psm1`, `run.ps1`, a redacted
`stale-users.csv`, `docs/oauth-flows.md` with your token comparison.

## Resume bullet

> Automated Entra ID operations over the Microsoft Graph REST API using the
> OAuth 2.0 client-credentials flow, with paging, 429 retry handling, licence
> validation and a 30-day stale-account report from `signInActivity`.

## Interview question

"Explain OAuth 2.0 to a non-technical manager, then tell me which flow a
nightly script should use and why." (Valet key analogy → client credentials,
certificate over secret, least-privilege application permissions.)

## Homework

- Replace the secret with a certificate (`Get-C90GraphToken` with a signed client assertion) — stretch.
- Day 56: your P2 trial ends soon. Export anything you still need from CA and sign-in logs.
