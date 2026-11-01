/**
 * registry — public API.
 * Other modules may import ONLY from this file (enforced by eslint-plugin-boundaries).
 * See ./README.md.
 */
import { createRegistry, type Registry } from './catalog';
import { discoverEntries } from './discover';
import { REGISTRY_SOURCES } from './sources';

export {
  defineComponent,
  defineProtocol,
  defineProvider,
  defineProblem,
  defineRule,
  defineLesson,
  registryKindOf,
  RegistryEntryError,
  REGISTRY_KINDS,
  type RegistryKind,
  type EntryByKind,
  type EntryInputByKind,
  type AnyRegistryEntry,
} from './define';
export {
  createRegistry,
  findUnresolvedReferences,
  type Registry,
  type ListFilter,
} from './catalog';
export {
  discoverEntries,
  RegistryLoadError,
  type SourceGroup,
  type DiscoveredEntry,
} from './discover';
export {
  ProviderDefinitionSchema,
  ProviderRegionSchema,
  RuleDefinitionSchema,
  RULE_CATEGORIES,
  LessonDefinitionSchema,
  RegistryProblemSchema,
  type ProviderDefinition,
  type ProviderRegion,
  ProviderServiceSchema,
  ServiceLimitSchema,
  LimitCheckSchema,
  ProviderInstanceFamilySchema,
  AsOfDateSchema,
  type ProviderService,
  type ServiceLimit,
  type LimitCheck,
  type ProviderInstanceFamily,
  type ProviderInstanceSize,
  type RuleDefinition,
  type RuleCategory,
  type RuleContext,
  type RuleCheck,
  type LessonDefinition,
  type RegistryProblemDefinition,
} from './schemas';
export {
  PROVIDER_ONLY_TAG,
  isProviderOnly,
  isAvailableOn,
  componentDisplayName,
  componentIcon,
  providerService,
  instancePrice,
  servicePricing,
  serviceLimits,
  mapRegion,
  mapRegionId,
  planProviderSwitch,
  type RegionMapping,
  type InstancePrice,
  type ProviderSwitchPlan,
  type SwitchRelabel,
  type SwitchWarning,
  type SwitchRegion,
} from './provider-tools';
export { matchScore, suggestedStacks, type StackSuggestion } from './protocol-tools';
export { USER_REGIONS, UserRegionSchema, userRegion, type UserRegion } from './geo/user-regions';

/** The app's registry: every entry auto-discovered from src/registry/*, validated at import time. */
export const registry: Registry = createRegistry(discoverEntries(REGISTRY_SOURCES));
