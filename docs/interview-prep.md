# IAM Analyst interview questions with sample answers

These questions come up in IAM analyst interviews. Each answer is tied to a
command or concept in IAM Range. Practise the command, then say the answer out
loud. If you can explain it in two minutes, you are ready.

## 1. What is the difference between an OU and a group?

**Answer:** An OU is an administrative container; a group is an access
container.

- OUs control **who can administer** what and which Group Policy applies.
- Groups control **what a person can access**.

A user can be in one OU and in many groups. In IAM Range, `New-ADOrganizationalUnit`
creates the structure and `New-ADGroup` creates the access roles.

## 2. What is privilege creep, and how do you fix it?

**Answer:** Privilege creep is when a person keeps access from an old role or
team after moving to a new one.

To fix it:

1. Find the user's current groups with `Get-ADPrincipalGroupMembership`.
2. Identify groups that do not match the current department or role.
3. Remove the old groups with `Remove-ADGroupMember`.
4. Add the new role groups with `Add-ADGroupMember`.
5. Document the change, because the access review will ask for proof.

## 3. What is the difference between a disabled and a locked account?

**Answer:** A locked account is a temporary, automatic state from too many
failed sign-ins. A disabled account is an intentional administrative action.

- `Unlock-ADAccount` clears a lockout.
- A disabled account needs `Enable-ADAccount` or to be re-created, and it must
  also be disabled in the cloud tenant.

In IAM Range, the lockout is triggered by the failed-attempt counter and
automatically clears after the lockout duration or an explicit unlock.

## 4. How do you enforce a strong password policy?

**Answer:** Use `Set-PasswordPolicy` to require a minimum length, complexity and
maximum age. In the lab, the target is:

```powershell
Set-PasswordPolicy -MinimumLength 14 -ComplexityEnabled $true -MaximumAge 90
```

Then verify with `Get-PasswordPolicy`. I also test it by trying to set a weak
password; the directory should reject it.

## 5. What would you do if a user cannot access a file share?

**Answer:** Check effective access, not the account itself.

1. Confirm the user with `Get-ADUser`.
2. Check group membership with `Get-ADPrincipalGroupMembership`.
3. Check the share permissions with `Get-Share`.
4. Run `Get-EffectiveAccess -Name <share> -Identity <user>` to see the
   resolved result.
5. Add the correct group or remove a blocking Deny.

The most common error is checking the account but not the group the account is
in.

## 6. What is Deny precedence, and why does it matter?

**Answer:** Deny takes precedence over Allow. If a user is in two groups, one
with Allow and one with Deny on the same share, the user is denied.

This matters because you can give a broad group a wide Allow, then use a small
Deny for sensitive data. In the lab, `grp-iam-admins` is denied from the `HR`
share even if its members are otherwise privileged.

## 7. How do you find dormant accounts?

**Answer:** Query the last sign-in timestamp. In the lab:

```powershell
Get-DormantAccount -Days 90
```

I look for never-used accounts and accounts with privileged groups. The risk
is that these accounts can be used without anyone noticing, especially service
and test accounts.

## 8. How do you know a directory sync worked?

**Answer:** Connect, run the sync, then verify a user in the cloud.

```powershell
Connect-Entra
Start-DirectorySync -Provider entra
Get-CloudUser -Provider entra -Upn ben.okafor@iamlab.com
```

A successful sync shows `Origin: synced`. If the user exists only in the cloud
with `Origin: cloud-only`, the sync either failed or the user was never
provisioned on-prem.

## 9. What is a standing privileged assignment, and why is it risky?

**Answer:** Standing privilege means a user always has admin rights instead of
requesting them when needed. It is risky because the account is always an
target.

The better model is PIM: eligibility plus activation with a reason and an
approval. In the lab, `Get-PimStandingPrivilege` shows standing assignments and
`Enable-PimRole` activates an eligible role for a time window.

## 10. What would an auditor ask for in an access review?

**Answer:** The auditor wants four things:

1. The population you reviewed.
2. The evidence you used.
3. The decision.
4. The trail of what you removed.

In IAM Range, the `Auditor evidence pack` template forces you to fill in the
control, scope, timestamps, actor, target, finding, remediation and
verification. That is the shape of a defensible answer.
