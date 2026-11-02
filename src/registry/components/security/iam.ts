import { z } from 'zod';
import { defineComponent } from '../../define';
import { managedPerRequest, scalingHelp } from '../../scaling-help';

export default defineComponent({
  id: 'security.iam',
  name: 'IAM (roles and policies)',
  category: 'security',
  tags: ['iam', 'roles', 'least-privilege', 'workload-identity', 'managed', 'control:iam'],
  icon: 'id-card',
  providerNames: { aws: 'IAM', gcp: 'Cloud IAM', azure: 'Microsoft Entra ID (RBAC)' },
  ports: [{ id: 'in', direction: 'in', protocols: ['http1', 'http2', 'tls13', 'tcp'] }],
  configSchema: z
    .object({
      leastPrivilege: z
        .boolean()
        .describe('Each service role can touch only its own tables/buckets (no wildcards)'),
      mfaForHumans: z
        .boolean()
        .describe('People need MFA (and short sessions) for console/CLI access'),
      accessAnalyzer: z
        .boolean()
        .describe('Continuously flag unused or public permissions')
        .meta({ advanced: true }),
    })
    .meta(scalingHelp(managedPerRequest('IAM service'))),
  defaults: { leastPrivilege: true, mfaForHumans: true, accessAnalyzer: true },
  instanceTypes: [{ id: 'managed', vCpu: 2, memGb: 4, netGbps: 10, costUsdPerHour: 0 }],
  perf: {
    serviceTimeMs: { read: 2, write: 2 },
    maxConcurrencyPerInstance: 100_000,
    scaleCurve: 'linear',
    saturationBehavior: 'reject',
  },
  docs: {
    summary:
      'Gives every service and person an identity and a policy saying exactly what it may do. With least privilege, a compromised service can only reach its own data — exfiltration stops at the policy.',
    howItWorks:
      'Services run with a role (instance profile, workload identity) instead of long-lived keys; the platform hands out short-lived credentials signed per request. Every API call (read this table, decrypt with this key) is checked against the policies attached to the role and the resource. Policies should name specific resources and actions; wildcards ("s3:*" on "*") are what turn one bug into a data breach.',
    tradeoffs: [
      'Least privilege takes work to write and maintain; broad policies are fast but turn any compromise into full access.',
      'Short-lived credentials remove key rotation chores but need the platform’s metadata service.',
    ],
    interviewTips: [
      'One role per service, scoped to its own resources; no shared admin keys.',
      'Mention blast radius: what can an attacker do with this service’s credentials?',
    ],
  },
  security: {
    defaultPorts: [443],
    threats: ['Wildcard policies', 'Long-lived access keys in code'],
    controls: ['Role per service', 'Access analyzer / unused-permission reports'],
  },
});
