import { defineProvider } from '../define';

/**
 * Microsoft Azure. Prices: approximate pay-as-you-go list prices in East US, Linux, no reserved or
 * savings-plan discounts, compiled for the `asOf` date (from published list prices, not re-checked live; verify before quoting) — orders of magnitude only.
 */
export default defineProvider({
  id: 'azure',
  name: 'Microsoft Azure',
  shortName: 'Azure',
  regions: [
    { id: 'eastus', name: 'East US (Virginia)', lat: 37.4, lon: -79.4, genericId: 'us-east' },
    { id: 'eastus2', name: 'East US 2 (Virginia)', lat: 36.7, lon: -78.4 },
    { id: 'centralus', name: 'Central US (Iowa)', lat: 41.6, lon: -93.6, genericId: 'us-central' },
    {
      id: 'southcentralus',
      name: 'South Central US (Texas)',
      lat: 29.4,
      lon: -98.5,
      genericId: 'us-south',
    },
    { id: 'westus2', name: 'West US 2 (Washington)', lat: 47.2, lon: -119.9, genericId: 'us-west' },
    { id: 'westus', name: 'West US (California)', lat: 37.8, lon: -122.4, genericId: 'us-west-2' },
    {
      id: 'canadacentral',
      name: 'Canada Central (Toronto)',
      lat: 43.65,
      lon: -79.4,
      genericId: 'ca-central',
    },
    {
      id: 'mexicocentral',
      name: 'Mexico Central (Querétaro)',
      lat: 20.6,
      lon: -100.4,
      genericId: 'mx-central',
    },
    {
      id: 'brazilsouth',
      name: 'Brazil South (São Paulo)',
      lat: -23.5,
      lon: -46.6,
      genericId: 'sa-east',
    },
    {
      id: 'chilecentral',
      name: 'Chile Central (Santiago)',
      lat: -33.4,
      lon: -70.6,
      genericId: 'sa-west',
    },
    {
      id: 'northeurope',
      name: 'North Europe (Ireland)',
      lat: 53.3,
      lon: -6.3,
      genericId: 'eu-west',
    },
    { id: 'westeurope', name: 'West Europe (Netherlands)', lat: 52.4, lon: 4.9 },
    { id: 'uksouth', name: 'UK South (London)', lat: 51.5, lon: -0.1, genericId: 'uk-south' },
    {
      id: 'germanywestcentral',
      name: 'Germany West Central (Frankfurt)',
      lat: 50.1,
      lon: 8.7,
      genericId: 'eu-central',
    },
    {
      id: 'swedencentral',
      name: 'Sweden Central (Gävle)',
      lat: 60.7,
      lon: 17.1,
      genericId: 'eu-north',
    },
    { id: 'italynorth', name: 'Italy North (Milan)', lat: 45.5, lon: 9.2, genericId: 'eu-south' },
    { id: 'israelcentral', name: 'Israel Central', lat: 32.1, lon: 34.8, genericId: 'me-west' },
    { id: 'uaenorth', name: 'UAE North (Dubai)', lat: 25.2, lon: 55.3, genericId: 'me-central' },
    { id: 'southafricanorth', name: 'South Africa North (Johannesburg)', lat: -26.2, lon: 28.0 },
    {
      id: 'centralindia',
      name: 'Central India (Pune)',
      lat: 18.5,
      lon: 73.9,
      genericId: 'ap-south',
    },
    { id: 'southindia', name: 'South India (Chennai)', lat: 13.1, lon: 80.3 },
    {
      id: 'southeastasia',
      name: 'Southeast Asia (Singapore)',
      lat: 1.35,
      lon: 103.8,
      genericId: 'ap-southeast',
    },
    {
      id: 'indonesiacentral',
      name: 'Indonesia Central (Jakarta)',
      lat: -6.2,
      lon: 106.8,
      genericId: 'ap-southeast-2',
    },
    { id: 'eastasia', name: 'East Asia (Hong Kong)', lat: 22.3, lon: 114.2, genericId: 'ap-east' },
    {
      id: 'japaneast',
      name: 'Japan East (Tokyo)',
      lat: 35.7,
      lon: 139.7,
      genericId: 'ap-northeast',
    },
    {
      id: 'koreacentral',
      name: 'Korea Central (Seoul)',
      lat: 37.6,
      lon: 127.0,
      genericId: 'ap-northeast-2',
    },
    {
      id: 'australiaeast',
      name: 'Australia East (Sydney)',
      lat: -33.9,
      lon: 151.2,
      genericId: 'au-east',
    },
    {
      id: 'australiasoutheast',
      name: 'Australia Southeast (Melbourne)',
      lat: -37.8,
      lon: 145.0,
      genericId: 'au-southeast',
    },
  ],
  defaultRegionId: 'eastus',
  pricing: {
    asOf: '2026-10-01',
    region: 'eastus',
    instancePriceMultiplier: 1,
    egressUsdPerGb: 0.087, // internet egress, first 10 TB
    storageUsdPerGbMonth: 0.018, // Blob hot, LRS
    requestsUsdPerMillion: 0.4,
  },
  instanceFamilies: [
    {
      id: 'general',
      name: 'General purpose (Dsv5)',
      sizes: [
        { size: 'small', name: 'D2s v5', vCpu: 2, memGb: 8, costUsdPerHour: 0.096 },
        { size: 'medium', name: 'D4s v5', vCpu: 4, memGb: 16, costUsdPerHour: 0.192 },
        { size: 'large', name: 'D8s v5', vCpu: 8, memGb: 32, costUsdPerHour: 0.384 },
        { size: 'xlarge', name: 'D16s v5', vCpu: 16, memGb: 64, costUsdPerHour: 0.768 },
      ],
    },
    {
      id: 'memory',
      name: 'Memory optimised (Esv5)',
      sizes: [
        { size: 'mem-medium', name: 'E4s v5', vCpu: 4, memGb: 32, costUsdPerHour: 0.252 },
        { size: 'mem-large', name: 'E8s v5', vCpu: 8, memGb: 64, costUsdPerHour: 0.504 },
        { size: 'mem-xlarge', name: 'E16s v5', vCpu: 16, memGb: 128, costUsdPerHour: 1.008 },
      ],
    },
  ],
  services: {
    'compute.app-server': {
      icon: 'monitor-cog',
      limits: [
        {
          id: 'azure-dsv5-cores',
          label: 'DSv5 family vCPUs per region (typical default quota)',
          value: 100,
          unit: 'vCPUs',
          adjustable: true,
        },
      ],
    },
    'compute.serverless-function': {
      icon: 'square-function',
      // Flex Consumption: ≈ $0.000026 per GB-s on demand.
      instancePrices: {
        '512mb': { name: 'Flex Consumption 512 MB (per busy hour)', costUsdPerHour: 0.0468 },
        '1024mb': { name: 'Flex Consumption 1 GB (per busy hour)', costUsdPerHour: 0.0936 },
        '2048mb': { name: 'Flex Consumption 2 GB (per busy hour)', costUsdPerHour: 0.187 },
        '4096mb': { name: 'Flex Consumption 4 GB (per busy hour)', costUsdPerHour: 0.374 },
      },
      limits: [
        {
          id: 'functions-flex-instances',
          label: 'Maximum instances per app (Flex Consumption)',
          value: 1000,
          unit: 'instances',
          adjustable: false,
          check: { kind: 'config', field: 'concurrencyLimit' },
          note: 'An instance can run several invocations at once, so this is a conservative check.',
        },
      ],
    },
    'network.load-balancer': {
      icon: 'split',
      instancePrices: {
        standard: { name: 'Standard Load Balancer (first 5 rules)', costUsdPerHour: 0.025 },
      },
    },
    'network.api-gateway': { icon: 'door-open', requestsUsdPerMillion: 4.2 }, // Consumption tier
    'network.cdn': { icon: 'cloud-lightning', requestsUsdPerMillion: 1.0 },
    'network.dns': {
      icon: 'signpost',
      requestsUsdPerMillion: 0.4,
      instancePrices: { managed: { name: 'DNS zone', costUsdPerHour: 0.000685 } },
    },
    'database.sql': {
      icon: 'database',
      instanceNamePrefix: 'Flexible Server ≈ ',
      instancePriceMultiplier: 1.3,
      storageUsdPerGbMonth: 0.115,
      limits: [
        {
          id: 'azure-pg-read-replicas',
          label: 'Read replicas per primary (Flexible Server)',
          value: 5,
          unit: 'replicas',
          adjustable: false,
          check: { kind: 'config', field: 'readReplicas' },
        },
        {
          id: 'azure-pg-storage',
          label: 'Maximum storage per server',
          value: 32768,
          unit: 'GB',
          adjustable: false,
          check: { kind: 'config', field: 'storageGb' },
        },
      ],
    },
    'database.nosql': {
      icon: 'orbit',
      // Serverless / autoscale blend: point read ≈ 1 RU, write ≈ 5 RU.
      instancePrices: {
        small: { name: 'request units', costUsdPerHour: 0 },
        medium: { name: 'request units', costUsdPerHour: 0 },
        large: { name: 'request units', costUsdPerHour: 0 },
        xlarge: { name: 'request units', costUsdPerHour: 0 },
        'mem-medium': { name: 'request units', costUsdPerHour: 0 },
        'mem-large': { name: 'request units', costUsdPerHour: 0 },
        'mem-xlarge': { name: 'request units', costUsdPerHour: 0 },
      },
      requestsUsdPerMillion: 0.5,
      storageUsdPerGbMonth: 0.0833, // $0.25/GB-month per region covers its replicas → per copy
      limits: [
        {
          id: 'cosmos-partition-ru',
          label: 'Reads per physical partition (10,000 RU/s, 1 RU per point read)',
          value: 10000,
          unit: 'reads/s',
          adjustable: false,
          check: { kind: 'rps', metric: 'read', per: 'shard' },
        },
        {
          id: 'cosmos-partition-writes',
          label: 'Writes per physical partition (≈ 5 RU per 1 KB write)',
          value: 2000,
          unit: 'writes/s',
          adjustable: false,
          check: { kind: 'rps', metric: 'write', per: 'shard' },
        },
        {
          id: 'cosmos-logical-partition',
          label: 'Data per logical partition key',
          value: 20,
          unit: 'GB',
          adjustable: false,
        },
      ],
      note: 'Cosmos DB also offers multi-region writes and five consistency levels.',
    },
    'cache.in-memory': {
      icon: 'memory-stick',
      instancePrices: {
        'mem-medium': { name: 'Premium P2 (13 GB) ≈', costUsdPerHour: 1.1 },
        'mem-large': { name: 'Premium P3 (26 GB) ≈', costUsdPerHour: 2.2 },
        'mem-xlarge': { name: 'Premium P4 (53 GB) ≈', costUsdPerHour: 4.4 },
      },
      limits: [
        {
          id: 'azure-redis-shards',
          label: 'Shards per Premium cache',
          value: 30,
          unit: 'shards',
          adjustable: false,
          check: { kind: 'config', field: 'shards' },
        },
      ],
    },
    'messaging.queue': {
      icon: 'inbox',
      requestsUsdPerMillion: 0.8, // Standard tier operations
      limits: [
        {
          id: 'servicebus-message',
          label: 'Message size (Standard tier)',
          value: 256,
          unit: 'KB',
          adjustable: false,
        },
      ],
    },
    'messaging.topic': { icon: 'megaphone', requestsUsdPerMillion: 0.6 },
    'messaging.stream': {
      icon: 'waves',
      instancePrices: {
        small: { name: 'Standard throughput unit', costUsdPerHour: 0.03 },
        medium: { name: 'Standard throughput unit', costUsdPerHour: 0.03 },
        large: { name: 'Standard throughput unit', costUsdPerHour: 0.03 },
        xlarge: { name: 'Standard throughput unit', costUsdPerHour: 0.03 },
      },
      limits: [
        {
          id: 'eventhubs-partition-ingress',
          label: 'Ingress per partition (≈ 1 MB/s)',
          value: 1000,
          unit: 'events/s',
          adjustable: false,
          check: { kind: 'rps', metric: 'write', per: 'shard' },
        },
        {
          id: 'eventhubs-partitions',
          label: 'Partitions per event hub (Standard)',
          value: 32,
          unit: 'partitions',
          adjustable: false,
          check: { kind: 'config', field: 'partitions' },
        },
        {
          id: 'eventhubs-retention',
          label: 'Retention (Standard)',
          value: 168,
          unit: 'hours',
          adjustable: false,
          check: { kind: 'config', field: 'retentionHours' },
        },
      ],
      note: 'One partition ≈ one throughput unit here (1 MB/s or 1,000 events/s in).',
    },
    'storage.object': {
      icon: 'hard-drive',
      storageUsdPerGbMonth: 0.018,
      requestsUsdPerMillion: 0.5, // reads; writes ≈ $6.50 per million
      limits: [
        {
          id: 'blob-account-rps',
          label: 'Requests per storage account (default)',
          value: 20000,
          unit: 'requests/s',
          adjustable: true,
          check: { kind: 'rps', metric: 'total', per: 'node' },
        },
      ],
    },
  },
  docs: {
    summary:
      'Microsoft Azure: Virtual Machines, Functions, Blob Storage, Cosmos DB, Service Bus and Event Hubs. Prices are approximate East US pay-as-you-go list prices.',
    howItWorks:
      'Generic components become their Azure products (Object Storage → Blob Storage, NoSQL → Cosmos DB, Event Stream → Event Hubs). Instance sizes map to Dsv5 / Esv5 VMs. Limits such as Cosmos DB per-partition request units and Event Hubs partition ingress are checked by the simulation.',
    tradeoffs: [
      'Strong enterprise and Microsoft-stack integration (Entra ID, .NET), many regions.',
      'Some services differ by tier (Standard vs Premium) more than on other clouds; check the tier your limits assume.',
    ],
  },
});
