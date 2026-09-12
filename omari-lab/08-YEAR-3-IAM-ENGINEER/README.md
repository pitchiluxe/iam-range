# Year 3 · IAM Engineer — real-VM lab

This lab extends the same OMARI Active Directory environment with the
engineering, automation, API, IGA, PAM and incident-response cases the
Year 3 student works through.

## What the scenario does

- `Set-Y3Scenario.ps1` creates privileged role groups and an eligibility/activation
  workflow using AD groups as the on-prem stand-in for PIM.
- It leaves a deliberately stale service account with an expired-style password.
- It exports a `C:\\OmariLab\\Y3\\membership-audit.csv` file for the IGA case.
- It sets up a disabled break-glass account for the incident-response case.

## Files

- `Set-Y3Scenario.ps1` — seed the Year 3 environment.
- `Reset-Y3Scenario.ps1` — remove the Year 3 objects for a fresh run.
- `README.md` — this file.

## Safety

- Run this in the `omari.test` domain on `OMARI-DC01` or a workstation with the RSAT tools.
- The script supports `-WhatIf`. Review every change before running.
- No production, no real passwords, no secrets are hard-coded.
