# OMARI Technologies — real-VM build package

This directory contains the optional, real Hyper-V build for the OMARI
Technologies four-year IAM career lab. It is **not used by the simulated**
`IAM Range` application and it does **not** create anything automatically unless
you explicitly run these scripts on a Windows host with Hyper-V.

## What this is

- `00-HOST-VALIDATION/` — check the host before doing anything.
- `01-NETWORK/` — create the private Hyper-V virtual switch.
- `02-DOMAIN-CONTROLLER/` — build the `OMARI-DC01` Windows Server domain
  controller.
- `03-HELPDESK-CLIENT/` — build the `OMARI-HD01` Windows client and join it to
  the domain.
- `04-FILE-SERVER/` — build the optional `OMARI-FS01` file server.
- `05-CONFIGURATION/` — AD structure, DNS, DHCP, GPO and service accounts.
- `06-CHECKPOINTS/` — save and restore Hyper-V checkpoints between sessions.
- `99-TESTS/` — validation tests that prove each phase actually worked.

## Prerequisites

- Windows 10/11 Pro, Enterprise or Education, or Windows Server 2016+.
- Hyper-V enabled (`dism /online /Enable-Feature /FeatureName:Microsoft-Hyper-V-All`).
- At least 16 GB RAM and 150 GB free disk space.
- An evaluation ISO for Windows Server and an ISO for Windows 11.
- A separate physical or logical private network that does not conflict with
  `10.10.10.0/24`, or the willingness to edit the addresses in
  `01-NETWORK/New-OmariVSwitch.ps1`.

## Usage

1. Open an elevated PowerShell prompt in this folder.
2. Run `00-HOST-VALIDATION/Test-HostReadiness.ps1`.
3. Run the scripts in order, one phase at a time.
4. Run the phase validation in `99-TESTS/Invoke-OmariValidation.ps1` before
   moving on.

## Safety rules

- No passwords, keys, tokens or real personal information are stored in these
  scripts. Prompts ask for the values they need.
- Every script supports `-WhatIf` and is idempotent where possible.
- Nothing in this package is run by the IAM Range application.
