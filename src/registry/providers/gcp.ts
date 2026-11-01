import { defineProvider } from '../define';

/**
 * Google Cloud. Prices: approximate on-demand list prices in us-central1 (Iowa), no free tier,
 * sustained-use or committed-use discounts, compiled for the `asOf` date (from published list prices, not re-checked live; verify before quoting) — orders of magnitude only.
 */
export default defineProvider({
  id: 'gcp',
  name: 'Google Cloud',
  shortName: 'GCP',
  regions: [
    { id: 'us-east4', name: 'N. Virginia (us-east4)', lat: 39.0, lon: -77.5, genericId: 'us-east' },
    { id: 'us-east1', name: 'S. Carolina (us-east1)', lat: 33.2, lon: -80.0 },
    {
      id: 'us-central1',
      name: 'Iowa (us-central1)',
      lat: 41.3,
      lon: -95.9,
      genericId: 'us-central',
    },
    { id: 'us-south1', name: 'Dallas (us-south1)', lat: 32.8, lon: -96.8, genericId: 'us-south' },
    { id: 'us-west1', name: 'Oregon (us-west1)', lat: 45.6, lon: -121.2, genericId: 'us-west' },
    { id: 'us-west2', name: 'Los Angeles (us-west2)', lat: 34.05, lon: -118.2 },
    {
      id: 'northamerica-northeast1',
      name: 'Montréal',
      lat: 45.5,
      lon: -73.6,
      genericId: 'ca-central',
    },
    {
      id: 'northamerica-south1',
      name: 'Querétaro',
      lat: 20.6,
      lon: -100.4,
      genericId: 'mx-central',
    },
    { id: 'southamerica-east1', name: 'São Paulo', lat: -23.5, lon: -46.6, genericId: 'sa-east' },
    { id: 'southamerica-west1', name: 'Santiago', lat: -33.4, lon: -70.6, genericId: 'sa-west' },
    { id: 'europe-west1', name: 'Belgium (europe-west1)', lat: 50.45, lon: 3.8 },
    {
      id: 'europe-west2',
      name: 'London (europe-west2)',
      lat: 51.5,
      lon: -0.1,
      genericId: 'uk-south',
    },
    {
      id: 'europe-west3',
      name: 'Frankfurt (europe-west3)',
      lat: 50.1,
      lon: 8.7,
      genericId: 'eu-central',
    },
    { id: 'europe-west4', name: 'Netherlands (europe-west4)', lat: 53.4, lon: 6.8 },
    {
      id: 'europe-west8',
      name: 'Milan (europe-west8)',
      lat: 45.5,
      lon: 9.2,
      genericId: 'eu-south',
    },
    { id: 'europe-north1', name: 'Finland (europe-north1)', lat: 60.6, lon: 27.2 },
    { id: 'me-west1', name: 'Tel Aviv (me-west1)', lat: 32.1, lon: 34.8, genericId: 'me-west' },
    { id: 'me-central1', name: 'Doha (me-central1)', lat: 25.3, lon: 51.5 },
    { id: 'africa-south1', name: 'Johannesburg (africa-south1)', lat: -26.2, lon: 28.0 },
    {
      id: 'asia-south1',
      name: 'Mumbai (asia-south1)',
      lat: 19.1,
      lon: 72.9,
      genericId: 'ap-south',
    },
    { id: 'asia-south2', name: 'Delhi (asia-south2)', lat: 28.6, lon: 77.2 },
    {
      id: 'asia-southeast1',
      name: 'Singapore (asia-southeast1)',
      lat: 1.35,
      lon: 103.8,
      genericId: 'ap-southeast',
    },
    {
      id: 'asia-southeast2',
      name: 'Jakarta (asia-southeast2)',
      lat: -6.2,
      lon: 106.8,
      genericId: 'ap-southeast-2',
    },
    {
      id: 'asia-east2',
      name: 'Hong Kong (asia-east2)',
      lat: 22.3,
      lon: 114.2,
      genericId: 'ap-east',
    },
    { id: 'asia-east1', name: 'Taiwan (asia-east1)', lat: 24.0, lon: 120.5 },
    {
      id: 'asia-northeast1',
      name: 'Tokyo (asia-northeast1)',
      lat: 35.7,
      lon: 139.7,
      genericId: 'ap-northeast',
    },
    {
      id: 'asia-northeast3',
      name: 'Seoul (asia-northeast3)',
      lat: 37.6,
      lon: 127.0,
      genericId: 'ap-northeast-2',
    },
    { id: 'australia-southeast1', name: 'Sydney', lat: -33.9, lon: 151.2, genericId: 'au-east' },
    {
      id: 'australia-southeast2',
      name: 'Melbourne',
      lat: -37.8,
      lon: 145.0,
      genericId: 'au-southeast',
    },
  ],
  defaultRegionId: 'us-central1',
  pricing: {
    asOf: '2026-10-01',
    region: 'us-central1',
    instancePriceMultiplier: 1,
    egressUsdPerGb: 0.12, // Premium tier internet egress, first TB
    storageUsdPerGbMonth: 0.02, // Cloud Storage Standard, regional
    requestsUsdPerMillion: 0.4,
  },
  instanceFamilies: [
    {
      id: 'general',
      name: 'General purpose (N2 standard)',
      sizes: [
        { size: 'small', name: 'n2-standard-2', vCpu: 2, memGb: 8, costUsdPerHour: 0.0971 },
        { size: 'medium', name: 'n2-standard-4', vCpu: 4, memGb: 16, costUsdPerHour: 0.1942 },
        { size: 'large', name: 'n2-standard-8', vCpu: 8, memGb: 32, costUsdPerHour: 0.3885 },
        { size: 'xlarge', name: 'n2-standard-16', vCpu: 16, memGb: 64, costUsdPerHour: 0.7769 },
      ],
    },
    {
      id: 'memory',
      name: 'Memory optimised (N2 highmem)',
      sizes: [
        { size: 'mem-medium', name: 'n2-highmem-4', vCpu: 4, memGb: 32, costUsdPerHour: 0.262 },
        { size: 'mem-large', name: 'n2-highmem-8', vCpu: 8, memGb: 64, costUsdPerHour: 0.5241 },
        { size: 'mem-xlarge', name: 'n2-highmem-16', vCpu: 16, memGb: 128, costUsdPerHour: 1.0481 },
      ],
    },
  ],
  services: {
    'compute.app-server': {
      icon: 'server',
      limits: [
        {
          id: 'gce-n2-cpus',
          label: 'N2 CPUs per region (typical default quota)',
          value: 24,
          unit: 'vCPUs',
          adjustable: true,
        },
      ],
    },
    'compute.serverless-function': {
      icon: 'square-function',
      // $0.000024 per vCPU-s + $0.0000025 per GiB-s, at the vCPU share of each size.
      instancePrices: {
        '512mb': { name: '512 MiB (per busy hour)', costUsdPerHour: 0.033 },
        '1024mb': { name: '1 GiB (per busy hour)', costUsdPerHour: 0.0594 },
        '2048mb': { name: '2 GiB (per busy hour)', costUsdPerHour: 0.119 },
        '4096mb': { name: '4 GiB (per busy hour)', costUsdPerHour: 0.237 },
      },
      limits: [
        {
          id: 'run-max-instances',
          label: 'Max instances per function (default)',
          value: 100,
          unit: 'instances',
          adjustable: true,
          check: { kind: 'config', field: 'concurrencyLimit' },
          note: 'With 1 request per instance (the functions default) this caps concurrent invocations; raise max instances or per-instance concurrency.',
        },
      ],
    },
    'network.load-balancer': {
      icon: 'split',
      instancePrices: {
        standard: { name: 'forwarding rule (hourly, data extra)', costUsdPerHour: 0.025 },
      },
    },
    'network.api-gateway': { icon: 'door-open', requestsUsdPerMillion: 3.0 },
    'network.cdn': { icon: 'cloud-lightning', requestsUsdPerMillion: 0.75 },
    'network.dns': {
      icon: 'signpost',
      requestsUsdPerMillion: 0.4,
      instancePrices: { managed: { name: 'managed zone', costUsdPerHour: 0.000274 } },
    },
    'database.sql': {
      icon: 'database',
      instanceNamePrefix: 'db-custom ≈ ',
      instancePriceMultiplier: 1.45, // $0.0413/vCPU-h + $0.007/GB-h
      storageUsdPerGbMonth: 0.17, // SSD
      limits: [
        {
          id: 'cloudsql-read-replicas',
          label: 'Read replicas per primary',
          value: 10,
          unit: 'replicas',
          adjustable: false,
          check: { kind: 'config', field: 'readReplicas' },
        },
        {
          id: 'cloudsql-storage',
          label: 'Maximum storage per instance',
          value: 65536,
          unit: 'GB',
          adjustable: false,
          check: { kind: 'config', field: 'storageGb' },
        },
      ],
    },
    'database.spanner': {
      icon: 'globe-lock',
      storageUsdPerGbMonth: 0.3,
      nearest: 'database.sql',
      limits: [
        {
          id: 'spanner-node-reads',
          label: 'Reads per node (regional guidance)',
          value: 22500,
          unit: 'reads/s',
          adjustable: false,
          check: { kind: 'rps', metric: 'read', per: 'shard' },
        },
        {
          id: 'spanner-node-writes',
          label: 'Writes per node (regional guidance)',
          value: 3500,
          unit: 'writes/s',
          adjustable: false,
          check: { kind: 'rps', metric: 'write', per: 'shard' },
        },
        {
          id: 'spanner-nodes',
          label: 'Nodes per instance (default quota)',
          value: 100,
          unit: 'nodes',
          adjustable: true,
          check: { kind: 'config', field: 'nodes' },
        },
      ],
      note: 'Multi-region configurations cost about 3× per node and add a cross-region quorum to writes.',
    },
    'database.nosql': {
      icon: 'table-2',
      // Bigtable: $0.65 per node-hour; generic size → number of nodes by vCPU.
      instancePrices: {
        small: { name: 'Bigtable, 1 node', costUsdPerHour: 0.65 },
        medium: { name: 'Bigtable, 2 nodes', costUsdPerHour: 1.3 },
        large: { name: 'Bigtable, 4 nodes', costUsdPerHour: 2.6 },
        xlarge: { name: 'Bigtable, 8 nodes', costUsdPerHour: 5.2 },
        'mem-medium': { name: 'Bigtable, 2 nodes', costUsdPerHour: 1.3 },
        'mem-large': { name: 'Bigtable, 4 nodes', costUsdPerHour: 2.6 },
        'mem-xlarge': { name: 'Bigtable, 8 nodes', costUsdPerHour: 5.2 },
      },
      storageUsdPerGbMonth: 0.17, // SSD, per replica cluster
      limits: [
        {
          id: 'bigtable-node-throughput',
          label: 'Rows read or written per node (SSD guidance)',
          value: 10000,
          unit: 'rows/s',
          adjustable: false,
          check: { kind: 'rps', metric: 'total', per: 'shard' },
          note: 'Bigtable rebalances tablets across nodes, but one hot row range still hits one node.',
        },
      ],
    },
    'cache.in-memory': {
      icon: 'memory-stick',
      instancePrices: {
        'mem-medium': { name: 'Memorystore Redis, Standard ≈ 30 GB', costUsdPerHour: 0.42 },
        'mem-large': { name: 'Memorystore Redis, Standard ≈ 60 GB', costUsdPerHour: 0.84 },
        'mem-xlarge': { name: 'Memorystore Redis, Standard ≈ 120 GB', costUsdPerHour: 1.68 },
      },
      limits: [
        {
          id: 'memorystore-shards',
          label: 'Shards per Memorystore for Redis Cluster instance',
          value: 250,
          unit: 'shards',
          adjustable: false,
          check: { kind: 'config', field: 'shards' },
        },
      ],
    },
    'messaging.queue': {
      icon: 'inbox',
      requestsUsdPerMillion: 0.08, // ≈ $40/TiB × 1 KB minimum, publish + deliver
      limits: [
        { id: 'pubsub-message', label: 'Message size', value: 10, unit: 'MB', adjustable: false },
        {
          id: 'pubsub-retention',
          label: 'Subscription message retention',
          value: 744,
          unit: 'hours',
          adjustable: false,
          check: { kind: 'config', field: 'retentionHours' },
        },
      ],
    },
    'messaging.topic': {
      icon: 'megaphone',
      requestsUsdPerMillion: 0.08,
      limits: [
        { id: 'pubsub-message', label: 'Message size', value: 10, unit: 'MB', adjustable: false },
      ],
    },
    'messaging.stream': {
      icon: 'waves',
      // Managed Kafka: $0.09 per vCPU-hour + $0.0118 per GiB-hour of broker capacity.
      instanceNamePrefix: 'Kafka capacity ≈ ',
      instancePriceMultiplier: 2.8,
      limits: [
        {
          id: 'kafka-partition-writes',
          label: 'Writes per partition (practical guidance)',
          value: 5000,
          unit: 'records/s',
          adjustable: false,
          check: { kind: 'rps', metric: 'write', per: 'shard' },
        },
      ],
    },
    'storage.object': {
      icon: 'package',
      storageUsdPerGbMonth: 0.02,
      requestsUsdPerMillion: 0.4, // Class B; Class A (writes) is $5 per million
      limits: [
        {
          id: 'gcs-bucket-reads',
          label: 'Reads per bucket before auto-scaling ramps up',
          value: 5000,
          unit: 'requests/s',
          adjustable: true,
          check: { kind: 'rps', metric: 'read', per: 'node' },
          note: 'Cloud Storage doubles capacity about every 20 minutes under sustained load.',
        },
        {
          id: 'gcs-bucket-writes',
          label: 'Writes per bucket before auto-scaling ramps up',
          value: 1000,
          unit: 'requests/s',
          adjustable: true,
          check: { kind: 'rps', metric: 'write', per: 'node' },
        },
      ],
    },
  },
  docs: {
    summary:
      'Google Cloud: Compute Engine, Cloud Run, Cloud Storage, Bigtable, Spanner and Pub/Sub on Google’s private backbone. Prices are approximate us-central1 list prices.',
    howItWorks:
      'Generic components become their Google Cloud products (Object Storage → Cloud Storage, NoSQL → Bigtable). Instance sizes map to N2 standard / highmem machine types; Spanner is available only on GCP boards. Limits such as Cloud SQL read replicas and Bigtable per-node throughput are checked by the simulation.',
    tradeoffs: [
      'Global load balancing and Spanner make multi-region designs simpler, but there are fewer regions than AWS or Azure.',
      'Egress on the Premium network tier costs more than on other clouds.',
    ],
  },
});
