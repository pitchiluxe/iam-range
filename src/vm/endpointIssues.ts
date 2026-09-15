/**
 * vm/endpointIssues.ts — the help-desk issue catalogue.
 *
 * One entry per fault the endpoint service can stage. Each says which queue
 * the ticket lands in, how the user would describe it, and the hint ladder the
 * tutor climbs (nudge, question, approach, solution).
 *
 * The ticket describes the symptom, never the cause. "Outlook keeps asking for
 * my password" is what arrives at a real service desk; "stale credential in
 * Credential Manager" is what the technician is paid to work out.
 */
import type { EndpointIssueId, EndpointTicketKind, TicketPriority } from '@/domain';
import {
  CORP_WIFI,
  INTRANET_HOST,
  OFFICE_PRINTER,
  SHARE_DRIVE,
  sharePath,
} from '@/services/mockEndpoints';

export interface IssueStory {
  /** Who is affected, for the wording. */
  display: string;
  username: string;
  computer: string;
  department: string;
  /** The department share, for drive tickets. */
  share: string;
  /** The application asked for, for software tickets. */
  software?: string;
}

export interface EndpointIssueSpec {
  id: EndpointIssueId;
  kind: EndpointTicketKind;
  priority: TicketPriority;
  /** Short name for menus and the tutor. */
  title: string;
  subject(s: IssueStory): string;
  body(s: IssueStory): string;
  /** Tutor ladder: nudge, question, approach, solution. */
  hints(s: IssueStory): readonly [string, string, string, string];
}

const where = (s: IssueStory): string => `Computer: ${s.computer}. User: ${s.username} (${s.department}).`;

export const ENDPOINT_ISSUES: Record<EndpointIssueId, EndpointIssueSpec> = {
  'printer-spooler-stopped': {
    id: 'printer-spooler-stopped',
    kind: 'printer-issue',
    priority: 'high',
    title: 'Nothing prints (spooler)',
    subject: (s) => `${s.display}: nothing prints at all`,
    body: (s) =>
      `${s.display} says nothing they send to the printer comes out, from any application, and ` +
      `the print queue window will not even open. Colleagues on the same floor can print to ` +
      `${OFFICE_PRINTER} fine. ${where(s)}`,
    hints: () => [
      'Other people can print to the same printer. What does that rule out?',
      'If the queue window will not open on this one computer, which Windows service would you check first?',
      'Look at the services on their computer (Get-Service Spooler, or Settings > Printers). Is the Print Spooler running?',
      'Restart-Service Spooler on the computer, then print a test page to prove it.',
    ],
  },
  'printer-queue-stuck': {
    id: 'printer-queue-stuck',
    kind: 'printer-issue',
    priority: 'normal',
    title: 'Print queue stuck',
    subject: (s) => `${s.display}: print jobs stuck in the queue`,
    body: (s) =>
      `${s.display} sent a spreadsheet to ${OFFICE_PRINTER} this morning. Nothing has printed ` +
      `since, and every document they send just sits there. ${where(s)}`,
    hints: () => [
      'Everything after one particular document is waiting. What does that suggest?',
      'Where would you see the jobs waiting, and their status?',
      'Open the printer queue on their computer (Settings > Printers & scanners, or Get-PrintJob). Is one job in Error?',
      'Clear the queue (Cancel all, or Remove-PrintJob -All), then print a test page.',
    ],
  },
  'printer-wrong-default': {
    id: 'printer-wrong-default',
    kind: 'printer-issue',
    priority: 'low',
    title: 'Wrong default printer',
    subject: (s) => `${s.display}: printing opens a "save as" box`,
    body: (s) =>
      `When ${s.display} presses Print, a window asks where to save a file instead of ` +
      `printing. They think it started after an update last week. ${where(s)}`,
    hints: () => [
      'A save dialog instead of paper. Which kind of "printer" saves files?',
      'Which printer does their computer send jobs to when nobody picks one?',
      `Check the default printer in Settings > Printers & scanners, or Get-Printer. Is it ${OFFICE_PRINTER}?`,
      `Set ${OFFICE_PRINTER} as the default (Set-DefaultPrinter), then print a test page.`,
    ],
  },
  'printer-offline': {
    id: 'printer-offline',
    kind: 'printer-issue',
    priority: 'normal',
    title: 'Printer shows Offline',
    subject: (s) => `${s.display}: printer says Offline`,
    body: (s) =>
      `${s.display}'s computer shows ${OFFICE_PRINTER} as Offline. The printer is on, has ` +
      `paper, and prints for everyone else. ${where(s)}`,
    hints: () => [
      'The printer works for everyone else. Is the problem the printer, or how this computer sees it?',
      'Is there a setting on a Windows computer that marks a printer offline on purpose?',
      'Open the printer on their computer. Is "Use printer offline" ticked?',
      'Turn "Use printer offline" off (Set-PrinterOnline), then print a test page.',
    ],
  },
  'outlook-profile-corrupt': {
    id: 'outlook-profile-corrupt',
    kind: 'email-issue',
    priority: 'high',
    title: 'Outlook will not open',
    subject: (s) => `${s.display}: Outlook will not open`,
    body: (s) =>
      `${s.display} gets "Cannot start Microsoft Outlook. The set of folders cannot be opened." ` +
      `every time. Webmail works for them. ${where(s)}`,
    hints: () => [
      'Webmail works. What does that tell you about the mailbox itself?',
      'If the mailbox is fine, what on the computer holds Outlook\'s connection settings?',
      'The mail profile on the computer is suspect. Look at it through Outlook\'s account settings (or Get-OutlookStatus).',
      'Create a new Outlook profile (Repair-OutlookProfile), open Outlook and confirm it connects.',
    ],
  },
  'outlook-work-offline': {
    id: 'outlook-work-offline',
    kind: 'email-issue',
    priority: 'normal',
    title: 'Outlook disconnected',
    subject: (s) => `${s.display}: Outlook not getting new email`,
    body: (s) =>
      `${s.display} has had no new email since yesterday afternoon, and colleagues say their ` +
      `replies are not arriving. Teams and the internet work. ${where(s)}`,
    hints: () => [
      'The network works. Where in Outlook would it tell you whether it is connected?',
      'Look at the bottom status bar in Outlook. What does it say?',
      'Is Outlook set to Work Offline (Send / Receive tab, or Get-OutlookStatus)?',
      'Turn Work Offline off (Set-OutlookWorkOffline -Enabled false) and watch the status change to Connected.',
    ],
  },
  'outlook-mailbox-full': {
    id: 'outlook-mailbox-full',
    kind: 'email-issue',
    priority: 'high',
    title: 'Mailbox full',
    subject: (s) => `${s.display}: cannot send email`,
    body: (s) =>
      `${s.display} gets a warning that they cannot send messages. They can still receive some ` +
      `mail. ${where(s)}`,
    hints: () => [
      'Receiving works and sending does not. What limit behaves like that?',
      'Where would you see how much of the mailbox is used?',
      'Check the mailbox size against its quota (Outlook mailbox cleanup, or Get-OutlookStatus). What is taking the space?',
      'Empty Deleted Items (Clear-DeletedItems), confirm the mailbox is under 90%, and tell the user about archiving.',
    ],
  },
  'outlook-password-loop': {
    id: 'outlook-password-loop',
    kind: 'email-issue',
    priority: 'high',
    title: 'Outlook password prompt loop',
    subject: (s) => `${s.display}: Outlook keeps asking for password`,
    body: (s) =>
      `${s.display} changed their password on Monday. Since then Outlook asks for it over and ` +
      `over, even when they type it correctly. They can sign in to everything else. ${where(s)}`,
    hints: () => [
      'It started with a password change, and only Outlook is affected. What might still hold the old one?',
      'Where does Windows keep passwords that applications saved?',
      'Look in Credential Manager on their computer (cmdkey /list, or Control Panel). Is there an Office entry saved before the change?',
      'Delete the stale Office credential (Remove-StoredCredential or cmdkey /delete), reopen Outlook and let it save the new password. Resetting the password again will not help.',
    ],
  },
  'network-wifi-wrong': {
    id: 'network-wifi-wrong',
    kind: 'network-issue',
    priority: 'high',
    title: 'Connected, no intranet',
    subject: (s) => `${s.display}: Wi-Fi connected but nothing works`,
    body: (s) =>
      `${s.display} says the Wi-Fi icon shows connected and websites load, but the intranet, ` +
      `the S: drive and Outlook do not work. ${where(s)}`,
    hints: () => [
      'The internet works and nothing internal does. Which network are they actually on?',
      'What would the IP address tell you about which network handed it out?',
      'Run ipconfig on their computer and look at the address and the Wi-Fi network name. Is it the corporate network?',
      `Connect to ${CORP_WIFI} (Settings > Network, or netsh wlan connect name=${CORP_WIFI}), then check ipconfig and ping the intranet.`,
    ],
  },
  'network-apipa': {
    id: 'network-apipa',
    kind: 'network-issue',
    priority: 'urgent',
    title: 'No network (169.254 address)',
    subject: (s) => `${s.display}: no internet or network`,
    body: (s) =>
      `${s.display} has no network at all since they came back from lunch. The Wi-Fi icon has a ` +
      `yellow warning. The person next to them is fine. ${where(s)}`,
    hints: () => [
      'The neighbour is fine, so the network is up. What does this one computer have that theirs does not?',
      'What is the first command you run to see a computer\'s network configuration?',
      'Run ipconfig. An address starting 169.254 means what about DHCP?',
      'ipconfig /release then ipconfig /renew, confirm a 10.20.x.x address, and ping the intranet.',
    ],
  },
  'network-dns-stale': {
    id: 'network-dns-stale',
    kind: 'network-issue',
    priority: 'normal',
    title: 'Intranet by name fails',
    subject: (s) => `${s.display}: intranet site will not load`,
    body: (s) =>
      `${s.display} cannot open ${INTRANET_HOST}. Other websites work, and colleagues can open ` +
      `the intranet. IT moved the intranet to a new server last night. ${where(s)}`,
    hints: () => [
      'The site moved servers last night and only this computer cannot reach it. What might this computer remember?',
      'How would you find out which address their computer thinks the name points to?',
      `Run nslookup ${INTRANET_HOST} or ping it by name on their computer. Does it match the new address, and is the answer from cache?`,
      'Clear the client DNS cache with ipconfig /flushdns, then ping the intranet by name again.',
    ],
  },
  'network-adapter-disabled': {
    id: 'network-adapter-disabled',
    kind: 'network-issue',
    priority: 'urgent',
    title: 'Network adapter disabled',
    subject: (s) => `${s.display}: laptop says no networks available`,
    body: (s) =>
      `${s.display}'s laptop shows no Wi-Fi networks at all, not even the guest one. It worked ` +
      `yesterday. ${where(s)}`,
    hints: () => [
      'No networks at all, not just the corporate one. Is the problem the networks or the laptop\'s radio?',
      'Where would you see whether the wireless adapter itself is on?',
      'Check the adapter status (Settings > Network & internet, or Get-NetAdapter). Is it Disabled?',
      'Enable the adapter (Enable-NetAdapter -Name Wi-Fi), confirm it joins the corporate network and gets an address.',
    ],
  },
  'drive-missing': {
    id: 'drive-missing',
    kind: 'drive-mapping',
    priority: 'normal',
    title: 'S: drive missing',
    subject: (s) => `${s.display}: S: drive has disappeared`,
    body: (s) =>
      `${s.display}'s S: drive is gone from This PC. They need the ${s.department} team files ` +
      `today. Colleagues in ${s.department} still have theirs. ${where(s)}`,
    hints: (s) => [
      'Colleagues still have the drive. Is the share gone, or just this computer\'s link to it?',
      'How would you list the drives mapped on their computer?',
      `Run net use on their computer. Is ${SHARE_DRIVE} there, and which share should it point at?`,
      `Map ${SHARE_DRIVE} to ${sharePath(s.share)} (This PC > Map network drive, or net use ${SHARE_DRIVE} ${sharePath(s.share)}), then open it.`,
    ],
  },
  'drive-access-denied': {
    id: 'drive-access-denied',
    kind: 'drive-mapping',
    priority: 'high',
    title: 'S: drive access denied',
    subject: (s) => `${s.display}: S: drive says access denied`,
    body: (s) =>
      `${s.display} cannot get to the ${s.department} team drive. Trying to connect it again ` +
      `gives "Access is denied". ${where(s)}`,
    hints: (s) => [
      '"Access is denied" is a sentence from a server. Is this a drive problem or a permission problem?',
      'Whose permission list decides who gets into a share?',
      `Check the effective access for ${s.username} on ${s.share} (Get-Share, Get-EffectiveAccess -Name ${s.share} -Identity ${s.username}). What do they have?`,
      `Restore their access (Grant-SharePermission on ${s.share}), then map ${SHARE_DRIVE} again. Mapping first will keep failing.`,
    ],
  },
  'vpn-cert-expired': {
    id: 'vpn-cert-expired',
    kind: 'vpn-issue',
    priority: 'high',
    title: 'VPN certificate expired',
    subject: (s) => `${s.display}: VPN will not connect`,
    body: (s) =>
      `${s.display} is working from home tomorrow and tested the VPN. It fails straight away ` +
      `with error 13801. It worked last month. ${where(s)}`,
    hints: () => [
      'It worked last month and fails immediately now. What expires on its own?',
      'What does error 13801 usually mean for a certificate-based VPN?',
      'Look at the VPN client on their computer (Get-VpnStatus). When does the certificate expire?',
      'Renew the VPN certificate (Update-VpnCertificate), then connect (Connect-Vpn) to prove it works.',
    ],
  },
  'software-missing': {
    id: 'software-missing',
    kind: 'software-request',
    priority: 'low',
    title: 'Software install request',
    subject: (s) => `${s.display}: needs ${s.software ?? 'an application'} installed`,
    body: (s) =>
      `${s.display} needs ${s.software ?? 'an approved application'} for their work and their ` +
      `manager has approved it. They do not have admin rights to install it. ${where(s)}`,
    hints: (s) => [
      'They are not an administrator. Is that the problem, or the control?',
      'Where do approved applications come from on a managed computer?',
      'Open Software Center on their computer (or Get-InstalledSoftware). Is the application offered?',
      `Install ${s.software ?? 'it'} from Software Center (Install-Software), then confirm it is listed as installed.`,
    ],
  },
  'disk-full': {
    id: 'disk-full',
    kind: 'performance-issue',
    priority: 'normal',
    title: 'Computer very slow',
    subject: (s) => `${s.display}: computer extremely slow`,
    body: (s) =>
      `${s.display}'s computer has become very slow, files will not save and an update keeps ` +
      `failing. ${where(s)}`,
    hints: () => [
      'Files will not save and updates fail. What do both of those need?',
      'Where would you check how much space is left on C:?',
      'Look at C: in This PC (or Get-DiskSpace). How much is free, and what is using it?',
      'Run Disk Cleanup (Clear-TempFiles) to remove temporary files, then confirm C: has at least 10 GB free.',
    ],
  },
};

export const ENDPOINT_ISSUE_IDS = Object.keys(ENDPOINT_ISSUES) as EndpointIssueId[];
