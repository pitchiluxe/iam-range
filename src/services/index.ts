/**
 * services/index.ts — public re-exports.
 *
 * FaultService and OllamaSupervisor are deliberately not here: fault injection
 * and AI-graded scoring belong to the lab, not to a standing workstation.
 */
export { MockAuditLog } from './mockAuditLog';
export { MockDirectory } from './mockDirectory';
export { MockIdP } from './mockIdP';
export type { IdPConditionalPolicy, PasswordResolver } from './mockIdP';
export { MockAppServer } from './mockAppServer';
export type { AppLoginResult } from './mockAppServer';
export { MockTicketQueue } from './mockTicketQueue';
export type { NewTicket } from './mockTicketQueue';
export { MockAccessReviews } from './mockAccessReviews';
export { MockIncidents } from './mockIncidents';
export { MockPim } from './mockPim';
export type {
  PimAssignment,
  AssignmentState,
  PrivilegedRoleSettings,
  PimResult,
} from './mockPim';
export { MockCloudTenant, VENDORS } from './mockCloudTenant';
export type {
  CloudVendor,
  CloudUser,
  CloudApp,
  CloudOrigin,
  CloudResult,
  SyncDelta,
  SyncResult,
  VendorProfile,
} from './mockCloudTenant';
export {
  CAPABILITIES,
  CAPABILITY_BY_ID,
  CAPABILITY_BY_CMDLET,
  capabilitiesForSection,
  capabilitiesResolving,
} from './capabilities';
export type {
  IamCapability,
  CapabilityContext,
  CapabilityParam,
  CapabilityResult,
  ConsoleSection,
} from './capabilities';
