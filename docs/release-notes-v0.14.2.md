# IAM Range v0.14.2

- Accept -Identity as an alias for -Trustee in Grant-SharePermission and Revoke-SharePermission, including case-insensitive parameter names. Reject conflicting aliases.
- Show complete share-permission examples when required parameters are missing, and document the alias in Get-Help.
- Explain the correct net use syntax when a learner types map Network Drive.
- Verify granting permission, checking effective access, mapping a drive and revoking access on a simulated remote workstation. The shared shell applies these fixes to both desktops.
