/**
 * security — public API.
 * Other modules may import ONLY from this file (enforced by eslint-plugin-boundaries).
 * See ./README.md.
 */
// Zone model (pure helpers shared with registry rules and the engine; they live in the registry).
export {
  SECURITY_ZONES,
  SECURITY_CONTROLS,
  CONTROL_LABEL,
  ZONE_LABEL,
  ZONE_HELP,
  ZONE_TRUST,
  EXPOSURES,
  EXPOSURE_LABEL,
  ADMIN_PORTS,
  controlsOf,
  isDataStore,
  ownZone,
  zoneGroup,
  groupZone,
  nodeZone,
  nodeExposure,
  edgeEncryption,
  edgePort,
  encryptedStack,
  evaluateIngress,
  zoneCrossings,
  type SecurityControl,
  type ZoneOrInternet,
  type Exposure,
  type NodeExposure,
  type EdgeEncryption,
  type GuardVerdict,
  type ZoneCrossing,
  type SecurityLookups,
  type FixPlan,
  type FixStep,
} from '@/registry';
export {
  reviewSecurity,
  securityFix,
  securityRules,
  ruleContext,
  findingKey,
  SEVERITY_RANK,
  type SecurityFinding,
  type SecurityReviewInput,
} from './review';
export {
  securityOverlay,
  type SecurityOverlay,
  type NodeSecurityView,
  type EdgeSecurityView,
} from './overlay';
export { ATTACKS, type AttackInfo } from './attacks';
