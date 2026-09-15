# Help desk endpoint labs

Identity work is half of an IT support job. The other half is the call that says
"my printer is broken", "Outlook will not open", "the Wi-Fi says no internet". These
labs put that work in the queue and make the learner fix it the way a service desk
does: read the ticket, connect to the user's computer with Remote Desktop, diagnose,
fix, note what was done, and close the ticket from the queue.

## Learning outcomes

By the end of these labs you will be able to:

- Connect to an end user's computer with Remote Desktop using your own admin account.
- Tell a printer problem that is the spooler from one that is the queue, the default
  printer, or a printer set to offline.
- Recover Outlook from a corrupt profile, Work Offline, a full mailbox and a stale
  cached credential.
- Diagnose network faults with `ipconfig`, `ping` and `nslookup`, and fix them with
  `ipconfig /renew`, `ipconfig /flushdns`, enabling an adapter or joining the right
  Wi-Fi network.
- Restore a missing mapped drive, and recognise when "access denied" is an identity
  problem rather than a drive problem.
- Renew an expired VPN certificate, install approved software, and free disk space.
- Write a work note a colleague could pick the ticket up from.

## The workflow every ticket follows

1. **Read the ticket** in the Ticket Queue. It names the user and their computer
   (`WKS-<USERNAME>`).
2. **Connect**: open Remote Desktop, choose *Help a user*, pick the computer, and sign
   in with your own admin account. You land on the user's desktop.
3. **Keep the ticket beside you**: the 🎫 button on the session's taskbar opens the
   ticket panel, so the details are on screen without switching back.
4. **Diagnose before you fix**: reproduce the symptom, then use the tools on that
   computer — Settings, Outlook, This PC, the terminal — to find the cause.
5. **Fix it** on that computer, in the GUI or the terminal. Every repair is written to
   the audit log against the computer name.
6. **Add a work note** from the ticket panel: symptom, cause, fix.
7. **Close the session and resolve the ticket** from the main Ticket Queue. Resolving is
   gated: the reviewer checks the computer's real state, not the claim.

Most repairs can also be run from the admin's own terminal with `-ComputerName
WKS-<USERNAME>`, the way a remote PowerShell fix is done at work. Remote Desktop is the
path the labs teach first because it is how most tier-1 desks work.

## Issue catalogue

| Ticket kind | Issue | What the user sees | Cause staged on the computer | Fix |
|---|---|---|---|---|
| printer-issue | `printer-spooler-stopped` | Documents never print | Print Spooler service stopped | Restart the Spooler service |
| printer-issue | `printer-queue-stuck` | Everything queues behind one job | A failed job blocks the queue | Clear the print queue |
| printer-issue | `printer-wrong-default` | Prints "vanish" | Default printer is Microsoft Print to PDF | Set the office printer as default |
| printer-issue | `printer-offline` | Printer shows Offline | "Use printer offline" is on | Turn it back online |
| email-issue | `outlook-profile-corrupt` | Outlook will not open | Corrupt mail profile | Create a new profile / repair |
| email-issue | `outlook-work-offline` | Outlook says Disconnected | Work Offline is on | Turn Work Offline off |
| email-issue | `outlook-mailbox-full` | Cannot send; mailbox full | Mailbox at quota | Empty Deleted Items / archive |
| email-issue | `outlook-password-loop` | Password prompt keeps coming back | Stale cached Office credential | Remove it from Credential Manager |
| network-issue | `network-wifi-wrong` | "Connected, no internet" | Joined the guest Wi-Fi | Connect to the corporate Wi-Fi |
| network-issue | `network-apipa` | No network, 169.254 address | DHCP lease failed | `ipconfig /release` then `/renew` |
| network-issue | `network-dns-stale` | Intranet by name fails, by IP works | Stale DNS cache entry | `ipconfig /flushdns` |
| network-issue | `network-adapter-disabled` | No network at all | Adapter disabled | Enable the adapter |
| drive-mapping | `drive-missing` | S: drive gone | Drive mapping missing | Map S: to the department share |
| drive-mapping | `drive-access-denied` | S: says Access denied | User lost access to the share | Restore access in AD, then map |
| vpn-issue | `vpn-cert-expired` | VPN will not connect from home | VPN certificate expired | Renew the certificate, reconnect |
| software-request | `software-missing` | Needs an application | Approved app not installed | Install it from Software Center |
| performance-issue | `disk-full` | Computer very slow | C: almost full of temp files | Run Disk Cleanup |

`drive-access-denied` is deliberately the one that crosses into identity: the drive is
fine, the permission is not, and mapping it again changes nothing until the access is
restored.

## How the lab is built

- **Endpoints** (`services/mockEndpoints.ts`): one computer per staff account, with
  real state — services, printers and their queues, network adapter and Wi-Fi, DNS
  cache, Outlook profile and mailbox, stored credentials, mapped drives, VPN
  certificate, installed software, disk. Faults are applied to that state; repairs
  change it; checks read it.
- **Capabilities** (`services/capabilities.ts`): every repair is a capability, so the
  terminal and the ticket drift guard see it like any identity action.
- **Generator** (`vm/ticketGenerator.ts`): once the domain has staff, help-desk
  scenarios join the queue. The scenario and its fault are chosen by code and applied
  before the ticket is raised; Ollama only rewrites the wording, and must keep the
  user and computer names.
- **Review** (`vm/ticketReview.ts`): resolving checks the computer's state for the
  staged issue. A ticket closed without the fix is refused.

## Interview skills demonstrated

- "Walk me through a printer ticket." — spooler vs queue vs default vs offline, and
  how you told them apart.
- "A user says Outlook keeps asking for a password after a reset." — cached
  credentials, and why resetting the password again does not help.
- "What does a 169.254 address tell you?" — DHCP failed; the adapter is up.
- "The intranet works by IP but not by name." — DNS, and the cache on the client.
- "A user lost their S: drive." — mapping versus permission, and how to prove which.
- "How do you document a ticket?" — symptom, cause, fix, verification.
