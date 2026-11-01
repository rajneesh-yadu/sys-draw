import { defineProvider } from '../define';

/**
 * Amazon Web Services. Prices: approximate on-demand list prices in us-east-1, Linux, no free tier
 * or discounts, compiled for the `asOf` date (from published list prices, not re-checked live; verify before quoting) — good for orders of magnitude, not for a quote.
 * Limits: default quotas (adjustable via Service Quotas) and hard service limits.
 */
export default defineProvider({
  id: 'aws',
  name: 'Amazon Web Services',
  shortName: 'AWS',
  regions: [
    { id: 'us-east-1', name: 'US East (N. Virginia)', lat: 38.9, lon: -77.4, genericId: 'us-east' },
    { id: 'us-east-2', name: 'US East (Ohio)', lat: 40.0, lon: -83.0 },
    {
      id: 'us-west-1',
      name: 'US West (N. California)',
      lat: 37.4,
      lon: -121.9,
      genericId: 'us-west-2',
    },
    { id: 'us-west-2', name: 'US West (Oregon)', lat: 45.6, lon: -121.2, genericId: 'us-west' },
    {
      id: 'ca-central-1',
      name: 'Canada (Central)',
      lat: 45.5,
      lon: -73.6,
      genericId: 'ca-central',
    },
    {
      id: 'mx-central-1',
      name: 'Mexico (Central)',
      lat: 20.6,
      lon: -100.4,
      genericId: 'mx-central',
    },
    {
      id: 'sa-east-1',
      name: 'South America (São Paulo)',
      lat: -23.5,
      lon: -46.6,
      genericId: 'sa-east',
    },
    { id: 'eu-west-1', name: 'Europe (Ireland)', lat: 53.3, lon: -6.3, genericId: 'eu-west' },
    { id: 'eu-west-2', name: 'Europe (London)', lat: 51.5, lon: -0.1, genericId: 'uk-south' },
    { id: 'eu-west-3', name: 'Europe (Paris)', lat: 48.9, lon: 2.4 },
    {
      id: 'eu-central-1',
      name: 'Europe (Frankfurt)',
      lat: 50.1,
      lon: 8.7,
      genericId: 'eu-central',
    },
    { id: 'eu-north-1', name: 'Europe (Stockholm)', lat: 59.3, lon: 18.1, genericId: 'eu-north' },
    { id: 'eu-south-1', name: 'Europe (Milan)', lat: 45.5, lon: 9.2, genericId: 'eu-south' },
    { id: 'il-central-1', name: 'Israel (Tel Aviv)', lat: 32.1, lon: 34.8, genericId: 'me-west' },
    {
      id: 'me-central-1',
      name: 'Middle East (UAE)',
      lat: 25.2,
      lon: 55.3,
      genericId: 'me-central',
    },
    { id: 'af-south-1', name: 'Africa (Cape Town)', lat: -33.9, lon: 18.4, genericId: 'af-south' },
    {
      id: 'ap-south-1',
      name: 'Asia Pacific (Mumbai)',
      lat: 19.1,
      lon: 72.9,
      genericId: 'ap-south',
    },
    {
      id: 'ap-south-2',
      name: 'Asia Pacific (Hyderabad)',
      lat: 17.4,
      lon: 78.5,
      genericId: 'ap-south-2',
    },
    {
      id: 'ap-southeast-1',
      name: 'Asia Pacific (Singapore)',
      lat: 1.35,
      lon: 103.8,
      genericId: 'ap-southeast',
    },
    {
      id: 'ap-southeast-3',
      name: 'Asia Pacific (Jakarta)',
      lat: -6.2,
      lon: 106.8,
      genericId: 'ap-southeast-2',
    },
    {
      id: 'ap-east-1',
      name: 'Asia Pacific (Hong Kong)',
      lat: 22.3,
      lon: 114.2,
      genericId: 'ap-east',
    },
    {
      id: 'ap-northeast-1',
      name: 'Asia Pacific (Tokyo)',
      lat: 35.7,
      lon: 139.7,
      genericId: 'ap-northeast',
    },
    {
      id: 'ap-northeast-2',
      name: 'Asia Pacific (Seoul)',
      lat: 37.6,
      lon: 127.0,
      genericId: 'ap-northeast-2',
    },
    {
      id: 'ap-southeast-2',
      name: 'Asia Pacific (Sydney)',
      lat: -33.9,
      lon: 151.2,
      genericId: 'au-east',
    },
    {
      id: 'ap-southeast-4',
      name: 'Asia Pacific (Melbourne)',
      lat: -37.8,
      lon: 145.0,
      genericId: 'au-southeast',
    },
  ],
  defaultRegionId: 'us-east-1',
  pricing: {
    asOf: '2026-10-01',
    region: 'us-east-1',
    instancePriceMultiplier: 1,
    egressUsdPerGb: 0.09, // internet egress, first 10 TB/month
    storageUsdPerGbMonth: 0.023, // S3 Standard, first 50 TB
    requestsUsdPerMillion: 0.4, // SQS standard
  },
  instanceFamilies: [
    {
      id: 'general',
      name: 'General purpose (M7i)',
      sizes: [
        { size: 'small', name: 'm7i.large', vCpu: 2, memGb: 8, costUsdPerHour: 0.1008 },
        { size: 'medium', name: 'm7i.xlarge', vCpu: 4, memGb: 16, costUsdPerHour: 0.2016 },
        { size: 'large', name: 'm7i.2xlarge', vCpu: 8, memGb: 32, costUsdPerHour: 0.4032 },
        { size: 'xlarge', name: 'm7i.4xlarge', vCpu: 16, memGb: 64, costUsdPerHour: 0.8064 },
      ],
    },
    {
      id: 'memory',
      name: 'Memory optimised (R7i)',
      sizes: [
        { size: 'mem-medium', name: 'r7i.xlarge', vCpu: 4, memGb: 32, costUsdPerHour: 0.2646 },
        { size: 'mem-large', name: 'r7i.2xlarge', vCpu: 8, memGb: 64, costUsdPerHour: 0.5292 },
        { size: 'mem-xlarge', name: 'r7i.4xlarge', vCpu: 16, memGb: 128, costUsdPerHour: 1.0584 },
      ],
    },
  ],
  services: {
    'compute.app-server': {
      icon: 'server-cog',
      limits: [
        {
          id: 'ec2-vcpu-quota',
          label: 'Running On-Demand Standard instances (vCPUs per region, typical default)',
          value: 64,
          unit: 'vCPUs',
          adjustable: true,
          note: 'New accounts often start lower; request an increase before a launch.',
        },
      ],
    },
    'compute.serverless-function': {
      icon: 'square-function',
      instancePrices: {
        '512mb': { name: 'Lambda 512 MB (per busy hour)', costUsdPerHour: 0.03 },
        '1024mb': { name: 'Lambda 1 GB (per busy hour)', costUsdPerHour: 0.06 },
        '2048mb': { name: 'Lambda 2 GB (per busy hour)', costUsdPerHour: 0.12 },
        '4096mb': { name: 'Lambda 4 GB (per busy hour)', costUsdPerHour: 0.24 },
      },
      limits: [
        {
          id: 'lambda-concurrency',
          label: 'Concurrent executions per region (default quota)',
          value: 1000,
          unit: 'executions',
          adjustable: true,
          check: { kind: 'config', field: 'concurrencyLimit' },
          note: 'Shared by every function in the account and region; extra invocations are throttled (429).',
        },
        {
          id: 'lambda-timeout',
          label: 'Maximum run time',
          value: 900,
          unit: 's',
          adjustable: false,
          check: { kind: 'config', field: 'timeoutSec' },
        },
        {
          id: 'lambda-memory',
          label: 'Maximum memory',
          value: 10240,
          unit: 'MB',
          adjustable: false,
          check: { kind: 'config', field: 'memoryMb' },
        },
      ],
      note: 'Requests also cost $0.20 per million (not in the estimate).',
    },
    'network.load-balancer': {
      icon: 'split',
      instancePrices: { standard: { name: 'ALB (hourly, LCUs extra)', costUsdPerHour: 0.0225 } },
    },
    'network.api-gateway': {
      icon: 'door-open',
      requestsUsdPerMillion: 3.5, // REST API, first 333 M/month
      limits: [
        {
          id: 'apigw-throttle',
          label: 'Account throttle per region (default quota)',
          value: 10000,
          unit: 'requests/s',
          adjustable: true,
          check: { kind: 'rps', metric: 'total', per: 'node' },
        },
        {
          id: 'apigw-timeout',
          label: 'Integration timeout (default)',
          value: 29000,
          unit: 'ms',
          adjustable: true,
          check: { kind: 'config', field: 'timeoutMs' },
        },
      ],
    },
    'network.cdn': {
      icon: 'cloud-lightning',
      requestsUsdPerMillion: 1.0, // HTTPS requests, North America
      limits: [
        {
          id: 'cloudfront-rps',
          label: 'Requests per second per distribution (default quota)',
          value: 250000,
          unit: 'requests/s',
          adjustable: true,
          check: { kind: 'rps', metric: 'total', per: 'node' },
        },
      ],
    },
    'network.dns': { icon: 'signpost', requestsUsdPerMillion: 0.4 },
    'database.sql': {
      icon: 'database',
      storageUsdPerGbMonth: 0.115, // gp3
      instancePrices: {
        small: { name: 'db.m6i.large', costUsdPerHour: 0.171 },
        medium: { name: 'db.m6i.xlarge', costUsdPerHour: 0.342 },
        large: { name: 'db.m6i.2xlarge', costUsdPerHour: 0.684 },
        xlarge: { name: 'db.m6i.4xlarge', costUsdPerHour: 1.368 },
        'mem-medium': { name: 'db.r6i.xlarge', costUsdPerHour: 0.48 },
        'mem-large': { name: 'db.r6i.2xlarge', costUsdPerHour: 0.96 },
        'mem-xlarge': { name: 'db.r6i.4xlarge', costUsdPerHour: 1.92 },
      },
      limits: [
        {
          id: 'rds-read-replicas',
          label: 'Read replicas per source (PostgreSQL / MySQL)',
          value: 15,
          unit: 'replicas',
          adjustable: false,
          check: { kind: 'config', field: 'readReplicas' },
        },
        {
          id: 'rds-storage',
          label: 'Maximum storage per instance',
          value: 65536,
          unit: 'GB',
          adjustable: false,
          check: { kind: 'config', field: 'storageGb' },
        },
      ],
    },
    'database.aurora': {
      icon: 'database-zap',
      storageUsdPerGbMonth: 0.1, // Aurora Standard; I/O $0.20 per million extra
      nearest: 'database.sql',
      limits: [
        {
          id: 'aurora-replicas',
          label: 'Aurora Replicas per cluster',
          value: 15,
          unit: 'replicas',
          adjustable: false,
          check: { kind: 'config', field: 'readReplicas' },
        },
        {
          id: 'aurora-storage',
          label: 'Cluster volume size',
          value: 131072,
          unit: 'GB',
          adjustable: false,
          check: { kind: 'config', field: 'storageGb' },
        },
      ],
      note: 'Shared cluster volume: replicas add no storage cost.',
    },
    'database.nosql': {
      icon: 'table-2',
      // On-demand: $0.125 per million reads, $0.625 per million writes → blended ≈ $0.25.
      instancePrices: {
        small: { name: 'on-demand capacity', costUsdPerHour: 0 },
        medium: { name: 'on-demand capacity', costUsdPerHour: 0 },
        large: { name: 'on-demand capacity', costUsdPerHour: 0 },
        xlarge: { name: 'on-demand capacity', costUsdPerHour: 0 },
        'mem-medium': { name: 'on-demand capacity', costUsdPerHour: 0 },
        'mem-large': { name: 'on-demand capacity', costUsdPerHour: 0 },
        'mem-xlarge': { name: 'on-demand capacity', costUsdPerHour: 0 },
      },
      requestsUsdPerMillion: 0.25,
      storageUsdPerGbMonth: 0.0833, // $0.25/GB-month covers 3 copies → per copy
      limits: [
        {
          id: 'dynamodb-partition-reads',
          label: 'Reads per partition (strongly consistent, ≤ 4 KB)',
          value: 3000,
          unit: 'reads/s',
          adjustable: false,
          check: { kind: 'rps', metric: 'read', per: 'shard' },
          note: '3,000 RCU per partition; a hot key cannot go faster however much capacity the table has.',
        },
        {
          id: 'dynamodb-partition-writes',
          label: 'Writes per partition (≤ 1 KB)',
          value: 1000,
          unit: 'writes/s',
          adjustable: false,
          check: { kind: 'rps', metric: 'write', per: 'shard' },
        },
        {
          id: 'dynamodb-table-throughput',
          label: 'On-demand throughput per table (default quota)',
          value: 40000,
          unit: 'requests/s',
          adjustable: true,
          check: { kind: 'rps', metric: 'total', per: 'node' },
        },
        { id: 'dynamodb-item', label: 'Item size', value: 400, unit: 'KB', adjustable: false },
      ],
      note: 'Billed per request, not per instance; the instance size only sets the simulated speed.',
    },
    'cache.in-memory': {
      icon: 'memory-stick',
      instancePrices: {
        'mem-medium': { name: 'cache.r6g.xlarge', costUsdPerHour: 0.411 },
        'mem-large': { name: 'cache.r6g.2xlarge', costUsdPerHour: 0.821 },
        'mem-xlarge': { name: 'cache.r6g.4xlarge', costUsdPerHour: 1.642 },
      },
      limits: [
        {
          id: 'elasticache-shards',
          label: 'Shards per cluster (cluster mode)',
          value: 500,
          unit: 'shards',
          adjustable: true,
          check: { kind: 'config', field: 'shards' },
        },
      ],
    },
    'messaging.queue': {
      icon: 'inbox',
      requestsUsdPerMillion: 0.4,
      limits: [
        {
          id: 'sqs-fifo-throughput',
          label: 'FIFO queue throughput (with batching, default mode)',
          value: 3000,
          unit: 'messages/s',
          adjustable: true,
          when: { field: 'ordering', equals: 'fifo' },
          check: { kind: 'rps', metric: 'total', per: 'node' },
          note: 'High-throughput FIFO mode raises this; standard queues are nearly unlimited.',
        },
        {
          id: 'sqs-retention',
          label: 'Message retention',
          value: 336,
          unit: 'hours',
          adjustable: false,
          check: { kind: 'config', field: 'retentionHours' },
        },
        { id: 'sqs-message', label: 'Message size', value: 256, unit: 'KB', adjustable: false },
      ],
    },
    'messaging.topic': {
      icon: 'megaphone',
      requestsUsdPerMillion: 0.5,
      limits: [
        {
          id: 'sns-publish',
          label: 'Publish rate per account (us-east-1 default quota)',
          value: 30000,
          unit: 'messages/s',
          adjustable: true,
          check: { kind: 'rps', metric: 'total', per: 'node' },
        },
      ],
    },
    'messaging.stream': {
      icon: 'waves',
      instancePrices: {
        small: { name: 'provisioned shard', costUsdPerHour: 0.015 },
        medium: { name: 'provisioned shard', costUsdPerHour: 0.015 },
        large: { name: 'provisioned shard', costUsdPerHour: 0.015 },
        xlarge: { name: 'provisioned shard', costUsdPerHour: 0.015 },
      },
      limits: [
        {
          id: 'kinesis-shard-writes',
          label: 'Writes per shard',
          value: 1000,
          unit: 'records/s',
          adjustable: false,
          check: { kind: 'rps', metric: 'write', per: 'shard' },
          note: 'Also 1 MB/s per shard; reads are capped at 2 MB/s per shard (shared by consumers).',
        },
        {
          id: 'kinesis-retention',
          label: 'Retention',
          value: 8760,
          unit: 'hours',
          adjustable: false,
          check: { kind: 'config', field: 'retentionHours' },
        },
      ],
      note: 'One partition = one Kinesis shard; PUT payload units ($0.014 per million) are extra.',
    },
    'storage.object': {
      icon: 'package',
      storageUsdPerGbMonth: 0.023,
      requestsUsdPerMillion: 0.4, // GET; PUT is $5 per million
      limits: [
        {
          id: 's3-prefix-reads',
          label: 'GET/HEAD per prefix',
          value: 5500,
          unit: 'requests/s',
          adjustable: false,
          check: { kind: 'rps', metric: 'read', per: 'node' },
          note: 'Per key prefix: spread keys over prefixes to go higher.',
        },
        {
          id: 's3-prefix-writes',
          label: 'PUT/COPY/POST/DELETE per prefix',
          value: 3500,
          unit: 'requests/s',
          adjustable: false,
          check: { kind: 'rps', metric: 'write', per: 'node' },
        },
      ],
    },
  },
  docs: {
    summary:
      'Amazon Web Services: the largest cloud, with EC2, Lambda, S3, DynamoDB, Aurora, SQS/SNS and Kinesis. Prices are approximate us-east-1 list prices.',
    howItWorks:
      'Generic components become their AWS products (Object Storage → S3, NoSQL → DynamoDB). Instance sizes map to M7i / R7i (EC2), db.m6i / db.r6i (RDS) and cache.r6g (ElastiCache); managed services are priced per request. Service limits such as Lambda concurrency and DynamoDB per-partition throughput are checked by the simulation.',
    tradeoffs: [
      'Widest service catalogue and most regions, but many overlapping options (ALB vs NLB, SQS vs Kinesis).',
      'Per-partition and per-account quotas bite at scale; plan quota increases ahead of launch.',
    ],
  },
});
