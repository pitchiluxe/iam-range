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
3. The template splits the list by department and creates accounts in `Users`, sets a
temporary password with `ChangePasswordAtLogon`, and adds each person to the right
group.
4. Run the script, then verify with:

   ```powershell
   Get-ADUser
   Get-ADPrincipalGroupMembership -Identity ana.smith
   ```

5. Fix any duplicate-name errors and re-run the affected lines.

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
