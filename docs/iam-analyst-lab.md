# IAM Analyst hands-on lab

This capstone walks the same job description used in the IAM Range manual: build an
enterprise directory, bulk-provision users, enforce role-based access, audit the
eesult, resolve helpdesk calls, and document the work as an auditor would expect.

## Learning outcomes

By the end of this lab you will be able to:

- Design OUs and security groups before accounts exist.
- Bulk-provision accounts from a CSV-style list and verify placement.
- Apply least-privilege group membership and remove stale access.
- Read an audit log, find a privilege-creep finding, and remediate it.
- Unlock an account and fix an access-denied report.
- Write an offboarding SOP and a password training guide.

## Phase 1 — Prepare the environment

1. Open **Active Directory Users and Computers**.
2. Create a `Corp` OU.
3. Under `Corp`, create `HR`, `IT`, `Finance`, `Sales`, `Help Desk`, `Users` and `Groups` OUs.
4. List the OUs to confirm the tree.

Why: creating accounts into missing OUs is the commonest first-day error. A good
analyst checks the container before creating the object.

## Phase 2 — Bulk-provision from a list

1. Open the **PowerShell ISE**.
2. Load the **Bulk onboarding from a CSV list** script template.
3. Open **File Explorer → Documents**. The app supplies [new-hires.csv](new-hires.csv)
   and [bulk-provision-new-hires.ps1](bulk-provision-new-hires.ps1) in
   `C:\Users\admin\Documents`. The CSV contains ten fictional employees and their
   roles. The script uses `Import-Csv`, creates accounts in `OU=Users,OU=Corp`, sets
   a temporary lab password with `ChangePasswordAtLogon`, and assigns each role group.
4. Run the script, then verify with:

   ```powershell
   Get-ADUser
   Get-ADPrincipalGroupMembership -Identity ana.smith
   ```

5. Fix any duplicate-name errors and re-run the affected lines. `ana.smith` exists
   only after provisioning succeeds; a membership query does not create the account.

You can also run the supplied file from **Terminal** after completing Phase 1:

```powershell
Import-Csv -Path "C:\Users\admin\Documents\new-hires.csv" | Select-Object SamAccountName,Department,Group
& "C:\Users\admin\Documents\bulk-provision-new-hires.ps1"
Get-ADPrincipalGroupMembership -Identity ana.smith
```

In PowerShell ISE, **New** starts a script, **Save** creates or updates its `.ps1`
file in `C:\Users\admin\Scripts` (or the full path you enter), and **Open** loads
that file. **Import .ps1** loads a file from your computer; **Export .ps1** keeps a
copy outside the lab. F5 or Ctrl+Enter runs; Ctrl+S saves. Saved scripts also appear
in **My scripts** and File Explorer.

**IAM Range directory** runs supported lab cmdlets, scalar variables, arrays,
`foreach`, and CSV record properties against the simulated directory. For functions,
modules and the full PowerShell language, choose **Windows PowerShell on this PC**;
review the transferred script and click **Run script**. That mode uses the real
computer, its files and installed modules. Export virtual files and use their
actual paths before running them there; it does not administer the simulated AD.

## Phase 3 — Enforce RBAC

1. Create role groups such as `grp-hr-managers`, `grp-hr-readers`, `grp-iam-admins`.
2. Place each group in the `Groups` OU.
3. Add the correct people and remove any old groups they no longer need.
4. Verify with `Get-ADPrincipalGroupMembership` for a sample of users.

Remember: removing the old access is the half people forget. That is how privilege
creeps.

## Phase 4 — Audit and report

1. Open **Log Search** and look for failed sign-in attempts, or run:

   ```powershell
   Get-IamAuditLog -Last 40
   ```

2. Find a user whose group membership does not match their department.
3. Remove the unexpected group with `Remove-ADGroupMember`.
4. Open **Writer** and start an **Access Review summary** from the templates.
5. Document the user, the unexpected group, the evidence, and the remedial action.

## Phase 5 — Helpdesk scenarios

1. **Locked out account**
   - Locate the account with `Get-ADUser`.
   - Check the recent audit log for the lockout pattern.
   - Unlock with `Unlock-ADAccount -Identity <username>`.

2. **Access denied**
   - Read the user's groups with `Get-ADPrincipalGroupMembership`.
   - Add or remove the group that fixes the share or application access.
   - Re-check the groups to confirm the change.

## Phase 6 — Documentation

1. Open **Writer**.
2. Start the **IAM Analyst offboarding SOP** template.
3. Fill in each section: steps, evidence checks, escalation path.
4. Start the **New-hire password training guide** template.
5. Save both documents.

## Verification checklist

- [ ] `Get-ADOrganizationalUnit` shows all department and group OUs.
- [ ] `Get-ADUser` lists at least ten new accounts.
- [ ] `Get-ADPrincipalGroupMembership` for a sample shows the right department group.
- [ ] One unexpected group has been removed and logged in the audit trail.
- [ ] One locked account was unlocked.
- [ ] The offboarding SOP and password guide are saved in Writer.

## Common mistakes to avoid

- Creating users before the OUs and groups exist.
- Adding new groups without removing the old ones.
- Unlocking an account without reading the failed-sign-in evidence first.
- Writing a report that states a finding without naming the account, group, and
  remediation.
