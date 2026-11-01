import { z } from 'zod';
import { defineComponent } from '../../define';

export default defineComponent({
  id: 'security.secrets-manager',
  name: 'Secrets Manager',
  category: 'security',
  tags: ['secrets', 'credentials', 'rotation', 'managed', 'control:secrets'],
  icon: 'key-round',
  providerNames: { aws: 'Secrets Manager', gcp: 'Secret Manager', azure: 'Key Vault Secrets' },
  ports: [{ id: 'in', direction: 'in', protocols: ['http1', 'http2', 'tls13', 'tcp'] }],
  configSchema: z.object({
    rotationDays: z
      .number()
      .int()
      .min(0)
      .max(365)
      .describe('Rotate database passwords and keys automatically every N days (0 = never)'),
    cacheTtlSec: z
      .number()
      .int()
      .min(0)
      .max(86_400)
      .describe('Clients cache a secret this long (fewer calls, slower to pick up a rotation)')
      .meta({ advanced: true }),
  }),
  defaults: { rotationDays: 30, cacheTtlSec: 300 },
  // ~$0.40 per secret-month for a handful of secrets; $0.05 per 10k calls not modelled.
  instanceTypes: [{ id: 'managed', vCpu: 2, memGb: 4, netGbps: 10, costUsdPerHour: 0.003 }],
  perf: {
    serviceTimeMs: { read: 15, write: 30 },
    maxConcurrencyPerInstance: 10_000,
    scaleCurve: 'linear',
    saturationBehavior: 'reject',
  },
  docs: {
    summary:
      'Stores database passwords, API keys and certificates encrypted, hands them to services at runtime through IAM, and rotates them — so no secret lives in code, config or environment files.',
    howItWorks:
      'A service authenticates with its workload identity (IAM role), asks for a secret by name and gets it over TLS; the value is encrypted at rest with a KMS key and every read is audited. Rotation runs a function that creates a new password in the database and updates the secret, so leaked credentials expire. Clients cache secrets for a few minutes to keep calls cheap.',
    tradeoffs: [
      'Removes secrets from repos and images, adds a dependency at start-up (cache to survive an outage).',
      'Rotation needs apps that re-read secrets (or connection pools that reconnect).',
    ],
    interviewTips: [
      'Never put credentials in config or environment variables baked into images: fetch them at start-up via the service’s role.',
      'Mention rotation and audit logs; least-privilege access per secret.',
    ],
  },
  security: {
    defaultPorts: [443],
    threats: ['Over-broad read access to all secrets', 'Secrets logged by the application'],
    controls: ['Per-secret IAM policies', 'Rotation and audit trails'],
  },
});
