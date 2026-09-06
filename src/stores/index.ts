/**
 * stores/index.ts — the stores the standalone VM keeps.
 *
 * The 3D lab also carries labStore, evidenceStore, scoreStore, tutorStore,
 * progressStore, faultStore and generatedLabsStore. All of those exist to
 * serve labs, scoring and the tutor; this app is an always-on sandbox, so they
 * are deliberately absent rather than stubbed — a stub would invite window code
 * to keep depending on a concept this app does not have.
 */
export { auditStore } from './auditStore';
export { ticketStore } from './ticketStore';
export { errorStore } from './errorStore';
