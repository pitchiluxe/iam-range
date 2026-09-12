# Year 2 · IAM Analyst — real-VM lab

This lab is applied on top of the OMARI Technologies baseline built in `05-CONFIGURATION`.
It does **not** build a new VM; it seeds the directory with the exact identity and access
problems the Year 2 student investigates.

## What the scenario does

- `Set-Y2Scenario.ps1` creates department OUs, role groups and a set of staff users.
- It intentionally plants privilege-creep cases:
  - one user in two role groups they should not be in,
  - one user missing a required group for a recent transfer,
  - one contractor whose account still exists after their end date.
- It sets the OMARI password and lockout policy to match the analyst SOP.
- It leaves an access-request trail in `C:\\OmariLab\\Y2\\access-request.csv`.

## Files

- `Set-Y2Scenario.ps1` — seed the Year 2 environment.
- `Reset-Y2Scenario.ps1` — remove the seeded users and groups for a fresh run.
- `README.md` — this file.

## Safety

- Run this in the `omari.test` domain on `OMARI-DC01` or a workstation with the RSAT tools.
- The script supports `-WhatIf`. Review every change before running.
- No production, no real passwords, no secrets are hard-coded.
