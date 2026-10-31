import { z } from 'zod';
import { defineComponent } from '../../define';

export default defineComponent({
  id: 'storage.object',
  name: 'Object Storage',
  category: 'storage',
  tags: ['storage', 'object', 'blob', 'media', 'durable', 'managed'],
  icon: 'archive',
  providerNames: { aws: 'S3', gcp: 'Cloud Storage', azure: 'Blob Storage' },
  ports: [{ id: 'in', direction: 'in', protocols: ['http1', 'http2'] }],
  configSchema: z.object({
    storageClass: z
      .enum(['standard', 'infrequent', 'archive'])
      .describe('Cheaper classes cost more per read and may take hours to retrieve (archive)'),
    storageGb: z.number().min(1).max(1e9).describe('Data stored'),
    publicAccess: z
      .boolean()
      .describe('Allow anonymous reads (normally off — serve via CDN instead)'),
    versioning: z
      .boolean()
      .describe('Keep previous versions of overwritten objects')
      .meta({ advanced: true }),
    encryptionAtRest: z.boolean().describe('Server-side encryption').meta({ advanced: true }),
    lifecycleDays: z
      .number()
      .int()
      .min(0)
      .max(3650)
      .describe('Move objects to a colder class after N days (0 = never)')
      .meta({ advanced: true }),
  }),
  defaults: {
    storageClass: 'standard',
    storageGb: 1000,
    publicAccess: false,
    versioning: false,
    encryptionAtRest: true,
    lifecycleDays: 0,
  },
  instanceTypes: [{ id: 'managed', vCpu: 1, memGb: 1, netGbps: 100, costUsdPerHour: 0 }],
  perf: {
    serviceTimeMs: { read: 20, write: 40 },
    maxConcurrencyPerInstance: 5500,
    scaleCurve: 'linear',
    saturationBehavior: 'reject',
  },
  docs: {
    summary:
      'Practically unlimited, highly durable storage for files (images, video, backups, logs) addressed by key over HTTP.',
    howItWorks:
      'Objects are stored whole and replicated across several data centres (11 nines of durability). Each GET or PUT is an HTTP request with tens of milliseconds to first byte, and throughput scales by spreading keys across prefixes. You pay per GB-month stored, per request and per GB transferred out. Large uploads use multipart; clients can upload directly with pre-signed URLs.',
    tradeoffs: [
      'Cheap and durable for big blobs, but too slow for small, frequent reads — put a CDN or cache in front.',
      'Objects are replaced, not edited; no partial updates or queries.',
      'Egress (data out) is often the largest cost for media apps.',
    ],
    interviewTips: [
      'Store media in object storage and only the metadata (key, owner, size) in the database.',
      'Use pre-signed URLs so clients upload directly, keeping large files off your app servers.',
      'Serve downloads through a CDN to cut latency and egress cost.',
    ],
  },
  security: {
    defaultPorts: [443],
    threats: [
      'Public buckets leaking private data',
      'Over-permissive bucket policies',
      'Long-lived pre-signed URLs being shared',
    ],
    controls: [
      'Block public access by default',
      'Least-privilege bucket policies',
      'Encryption at rest',
      'Short-expiry pre-signed URLs',
      'Access logging',
    ],
  },
});
