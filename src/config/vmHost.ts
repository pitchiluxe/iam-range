/**
 * config/vmHost.ts — identity of the simulated workstation the VM represents.
 *
 * One definition, because the Settings app and the terminal both describe this
 * machine and had drifted: Settings called it APEX-OPS-01 running "Apex OS 11",
 * while `hostname` and `systeminfo` reported NW-IT-WS01 running Windows 11.
 * A learner checking the same fact two ways got two answers.
 *
 * These are deliberately fictional and describe the *simulated* host, never the
 * real machine the app runs on — reporting the learner's actual hostname, IP or
 * MAC would be both wrong for a lab and a privacy problem.
 */
export const VM_HOST = {
  /** NetBIOS-style machine name. */
  name: 'IAMLAB-WS01',
  domain: 'iamlab.com',
  /** Short domain name, as Windows shows it in DOMAIN\user. */
  netbiosDomain: 'IAMLAB',
  /** The operator account the learner is signed in as. */
  user: 'erickomari',
  displayName: 'Erick Omari',
  email: 'eomari@iamlab.com',

  os: 'Microsoft Windows 11 Enterprise',
  osVersion: '10.0.22631',
  osBuild: '22631.4317',
  edition: 'Windows 11 Enterprise',
  systemType: '64-bit operating system, x64-based processor',
  processor: 'Intel(R) Core(TM) i7-1265U @ 2.70GHz',
  ram: '16.0 GB',

  ip: '10.20.4.31',
  gateway: '10.20.4.1',
  dns: '10.20.1.10',
  mac: '00-15-5D-2A-7C-04',
  domainController: 'IAMLAB-DC01',
} as const;

/** `DOMAIN\user`, the form Windows shows for a signed-in account. */
export const VM_ACCOUNT = `${VM_HOST.netbiosDomain}\\${VM_HOST.user}`;
