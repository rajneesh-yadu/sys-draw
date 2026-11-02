import { z } from 'zod';
import { defineComponent } from '../../define';
import { managedHourly, scalingHelp } from '../../scaling-help';

export default defineComponent({
  id: 'security.kms',
  name: 'Key Management Service',
  category: 'security',
  tags: ['kms', 'encryption-at-rest', 'envelope-encryption', 'hsm', 'managed', 'control:kms'],
  icon: 'lock-keyhole',
  providerNames: { aws: 'AWS KMS', gcp: 'Cloud KMS', azure: 'Key Vault Keys' },
  ports: [{ id: 'in', direction: 'in', protocols: ['http1', 'http2', 'tls13', 'tcp'] }],
  configSchema: z
    .object({
      keyType: z
        .enum(['provider-managed', 'customer-managed', 'hsm'])
        .describe(
          'Who controls the key (and its policy, rotation, deletion); HSM = FIPS 140-3 level 3',
        ),
      autoRotate: z
        .boolean()
        .describe('Rotate the key material yearly (old versions still decrypt)'),
    })
    .meta(scalingHelp(managedHourly('key management service'))),
  defaults: { keyType: 'customer-managed', autoRotate: true },
  // $1 per customer-managed key per month; $0.03 per 10k requests not modelled.
  instanceTypes: [{ id: 'managed', vCpu: 2, memGb: 4, netGbps: 10, costUsdPerHour: 0.0014 }],
  perf: {
    serviceTimeMs: { read: 5, write: 5 },
    maxConcurrencyPerInstance: 10_000,
    scaleCurve: 'linear',
    saturationBehavior: 'reject',
  },
  docs: {
    summary:
      'Holds the master keys that encrypt your data at rest. Databases and storage ask it to wrap their data keys, so stolen disks or snapshots are unreadable without the key and its policy.',
    howItWorks:
      'Envelope encryption: a database encrypts data with a local data key, and KMS encrypts (wraps) that data key with a master key that never leaves its HSMs. To read, the service asks KMS to unwrap the data key; the key policy and IAM decide who may, and every use is logged. Disabling the key makes all data under it unreadable at once (crypto-shredding).',
    tradeoffs: [
      'Encryption at rest is nearly free with managed services, but a key policy mistake can lock you out of your own data.',
      'Each unwrap is a network call (~5 ms): data keys are cached by the client.',
      'Per-request quotas (thousands/s) matter if every object uses its own key.',
    ],
    interviewTips: [
      'Say "encrypted at rest with customer-managed KMS keys, in transit with TLS".',
      'Explain envelope encryption and separation of duties (key admins ≠ data users).',
    ],
  },
  security: {
    defaultPorts: [443],
    threats: ['Key policy grants decrypt to everyone in the account'],
    controls: ['Least-privilege key policies', 'CloudTrail/audit of key use'],
  },
});
