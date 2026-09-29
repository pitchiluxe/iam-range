# Lab 4 — Entra ID Foundations

**Days 22–28 · Phase 2: Entra ID & Cloud Identity · Repo:** `iam-entra-id-lab`

## Do this lab in the app

This lab uses your **real** Microsoft Entra ID tenant, reached from inside
IAM Range:

1. Click **Entra admin center** above. The app's **Browser** opens
   `entra.microsoft.com`; sign in with your Microsoft account (the sign-in page
   is Microsoft's own). No tenant yet? Click **Azure portal** and create a free
   Azure account first — it creates a tenant for you.
2. Do Part A and Part B below entirely in that Browser window.
3. Click **PowerShell (this PC)** for Part C. It is the real Windows PowerShell
   on your computer, inside the app. The first time, install the Graph modules:

```powershell
Install-Module Microsoft.Graph.Authentication, Microsoft.Graph.Users, Microsoft.Graph.Groups, Microsoft.Graph.Identity.DirectoryManagement -Scope CurrentUser -Force
Connect-MgGraph -Scopes 'User.ReadWrite.All','Group.ReadWrite.All','RoleManagement.Read.Directory'
Get-MgContext | Select-Object Account, TenantId
```

   `Connect-MgGraph` opens Microsoft's sign-in window; approve, and come back.
   When a script asks `Read-Host … -AsSecureString`, the app shows a masked box.
4. Save the Lab 2 CSV into `Documents\c90\new-hires.csv` (the console starts in
   Documents) and run the Part C script with `-CsvPath .\c90\new-hires.csv`.
5. Warm-up (optional): the app's **Cloud Identity** window simulates Entra ID
   sync against your `omari.test` users — try `Connect-Entra` and
   `Get-CloudUser -Provider entra -Upn alex.rivera@omari.test` in **Terminal** to
   compare a simulated tenant with the real one.

## Career objective

Administer cloud identities in Microsoft Entra ID the way you administer AD:
users, groups, admin roles, and the Microsoft Graph PowerShell SDK — and be
able to explain exactly where the two directories differ.

## Quick review

1. Entra ID has no OUs. What replaces them for delegation? (Hint: administrative units.)
2. What is the difference between a *member* and a *guest* user?
3. What are Security defaults, and why do they block Conditional Access?
4. Why is *Global Administrator* the wrong role for a help-desk analyst?
5. What is a tenant ID, and where do you find it?

## Scenario

TechnoBiz is moving to the cloud: Sales and Engineering are moving
to Microsoft 365. Create their cloud identities and groups, give the help desk
the *least* privileged role that lets them reset passwords, and script it so
it can be repeated.

## Concept — AD vs Entra ID

| Active Directory | Entra ID |
|---|---|
| Domain `corp.technobiz.local` | Tenant `<tenant>.onmicrosoft.com` |
| OU + delegation | Administrative units + scoped roles |
| Kerberos / NTLM | OAuth 2.0 / OIDC / SAML |
| GPO | Conditional Access, Intune |
| `Get-ADUser` | `Get-MgUser` (Microsoft Graph) |
| Domain Admins | Global Administrator (use sparingly) |

## Licensing plan for the next five weeks — read this first

Conditional Access, dynamic groups, sign-in logs through Graph and SCIM
provisioning need **Entra ID P1**; PIM and access reviews need **P2**. A free
tenant gives you neither. Plan:

- **This week (Lab 4):** Entra ID Free is enough.
- **Day 29 (start of Lab 5):** activate the free **Microsoft Entra ID P2 trial**
  (Entra admin center → *Billing → Licenses → All products → Try/Buy*). It lasts
  about 30 days — it covers Labs 5–8 (days 29–56). Don't start it early.

## Hands-on lab

### Part A — tenant

1. Create a tenant with a free Azure account, or from an existing account:
   *Entra admin center → Identity → Overview → Manage tenants → Create*.
2. Record the tenant ID and primary domain in `docs/tenant.md` (these are not
   secrets).
3. Protect the account you're using: register MFA on it now.

### Part B — portal work (do it by hand once)

1. **Users → New user → Create new user:** `alex.rivera@<tenant>.onmicrosoft.com`,
   Department *Sales*, Usage location *United States*. Tick *Require password change*.
2. **Groups → New group:** Security, *Assigned*, `Sales-Team`. Add Alex.
3. **Users → New user:** `helpdesk.tech`. Then **Roles and administrators →
   Helpdesk Administrator → Add assignments →** helpdesk.tech.
4. Sign in as `helpdesk.tech` in a private window. Reset Alex's password: it
   works. Try to reset a Global Administrator's password: it fails. That
   difference *is* least privilege.
5. **Overview → Properties → Manage security defaults:** note that it is on.
   You will switch it off on day 29, just before creating Conditional Access.

### Part C — Microsoft Graph PowerShell

```powershell
Install-Module Microsoft.Graph.Authentication, Microsoft.Graph.Users, Microsoft.Graph.Groups, `
    Microsoft.Graph.Identity.DirectoryManagement -Scope CurrentUser

Connect-MgGraph -TenantId '<tenant-id>' -Scopes 'User.ReadWrite.All','Group.ReadWrite.All','RoleManagement.Read.Directory'
Get-MgContext | Select-Object Account, TenantId, Scopes
```

`scripts/New-C90CloudUsers.ps1` — the Lab 2 CSV, now to the cloud:

```powershell
param(
    [Parameter(Mandatory)][string]$CsvPath,
    [Parameter(Mandatory)][string]$Domain,          # <tenant>.onmicrosoft.com
    [Parameter(Mandatory)][securestring]$TemporaryPassword
)
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($TemporaryPassword))

foreach ($row in Import-Csv $CsvPath) {
    $upn = "$($row.SamAccountName)@$Domain"
    $existing = Get-MgUser -Filter "userPrincipalName eq '$upn'" -ErrorAction SilentlyContinue
    if ($existing) { [pscustomobject]@{ User = $upn; Status = 'Skipped' }; continue }
    try {
        $u = New-MgUser -DisplayName "$($row.FirstName) $($row.LastName)" -GivenName $row.FirstName `
            -Surname $row.LastName -UserPrincipalName $upn -MailNickname $row.SamAccountName `
            -Department $row.Department -JobTitle $row.Title -UsageLocation 'US' -AccountEnabled `
            -PasswordProfile @{ Password = $plain; ForceChangePasswordNextSignIn = $true } -ErrorAction Stop

        $groupName = "$($row.Department)-Team"
        $g = Get-MgGroup -Filter "displayName eq '$groupName'"
        if (-not $g) {
            $g = New-MgGroup -DisplayName $groupName -MailEnabled:$false -MailNickname $groupName -SecurityEnabled
        }
        New-MgGroupMember -GroupId $g.Id -DirectoryObjectId $u.Id
        [pscustomobject]@{ User = $upn; Status = 'Created'; Group = $groupName }
    } catch {
        [pscustomobject]@{ User = $upn; Status = 'Failed'; Group = $_.Exception.Message }
    }
}
```

```powershell
$pw = Read-Host 'Temporary password' -AsSecureString
.\scripts\New-C90CloudUsers.ps1 -CsvPath ..\iam-ad-enterprise-lab\automation\data\new-hires.csv `
    -Domain '<tenant>.onmicrosoft.com' -TemporaryPassword $pw | Format-Table

# Who holds which admin role?
Get-MgDirectoryRole | ForEach-Object {
    $role = $_.DisplayName
    Get-MgDirectoryRoleMember -DirectoryRoleId $_.Id |
        ForEach-Object { [pscustomobject]@{ Role = $role; Member = $_.AdditionalProperties.userPrincipalName } }
}
```

### Part D — logs

Sign in as Alex once. Then look at **Monitoring → Sign-in logs** and **Audit
logs**: find Alex's sign-in, your user creations, and the Helpdesk role
assignment. On Entra ID Free you get 7 days of history in the portal only.

## Validation checklist

- Tenant ID and domain recorded in `docs/tenant.md`
- Five cloud users created by script; re-running reports `Skipped`
- Department groups exist and contain the right users
- `helpdesk.tech` can reset a user's password but not an admin's
- Role-membership report saved to `reports/roles.csv`
- One sign-in and one audit event screenshotted

## Challenge

Answer Lab 3's IAM-2038 now: an on-prem `Sales-Team` does not exist in Entra ID
unless something syncs it. List the two ways the group can reach the cloud and
what each one costs you operationally.

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `Insufficient privileges to complete the operation` | Scope not consented | Reconnect with the right `-Scopes` and consent |
| `Property usageLocation is required` when licensing | Not set | Set `-UsageLocation` at creation |
| `Another object with the same value for property userPrincipalName already exists` | Deleted user still in recycle bin | *Users → Deleted users*, restore or permanently delete |
| `Get-MgUser` returns nothing for a filter | UPN typo or wrong tenant | `Get-MgContext` to confirm the tenant |

## GitHub assignment

```
iam-entra-id-lab/
├── README.md
├── docs/lab04-entra-foundations.md
├── docs/tenant.md                 tenant ID + domain only
├── scripts/New-C90CloudUsers.ps1
└── reports/roles.csv
```

## Resume bullet

> Administered a Microsoft Entra ID tenant: provisioned users and security
> groups with the Microsoft Graph PowerShell SDK and applied least-privilege
> admin roles (Helpdesk Administrator instead of Global Administrator).

## Interview question

"What's the difference between Active Directory and Entra ID?" Give protocols,
structure (OUs vs flat + AUs), management (GPO vs CA/Intune) and where they meet
(Entra Connect sync).

## Homework

- Read Microsoft Learn: *Least privileged roles by task in Microsoft Entra ID*.
- Write down which three labs you'll finish while the P2 trial is running.
