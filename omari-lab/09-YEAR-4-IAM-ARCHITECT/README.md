# Year 4 · IAM Architect — real-VM lab

This lab is read-first and scenario-light. The Year 4 architect does not
need more objects; they need evidence to design the target-state architecture.

## What the scenario does

- `Set-Y4Scenario.ps1` (or `Get-Y4RiskReport.ps1`) gathers the evidence an
  architect needs: dormant accounts, privileged groups, stale passwords and
  weak policy.
- It exports `C:\\OmariLab\\Y4\\current-state.csv` and `risk-register.md`
  for the target-state, roadmap and executive-briefing artifacts.
- It creates a single test break-glass account if one is missing, so the
  resilience case has a concrete object to review.

## Files

- `Get-Y4RiskReport.ps1` — read-only risk and governance evidence.
- `Set-Y4Scenario.ps1` — optional: ensure the break-glass account exists.
- `README.md` — this file.

## Safety

- All report scripts are read-only. `Set-Y4Scenario.ps1` is write and
  supports `-WhatIf`.
- Run this in the `omari.test` domain on `OMARI-DC01` or a workstation with the RSAT tools.
- No production, no real passwords, no secrets are hard-coded.
