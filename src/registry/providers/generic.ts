import { defineProvider } from '../define';

export default defineProvider({
  id: 'generic',
  name: 'Generic cloud',
  shortName: 'Generic',
  regions: [
    { id: 'us-east', name: 'US East (Virginia)', lat: 38.9, lon: -77.4 },
    { id: 'us-west', name: 'US West (Oregon)', lat: 45.6, lon: -121.2 },
    { id: 'sa-east', name: 'South America (São Paulo)', lat: -23.5, lon: -46.6 },
    { id: 'eu-west', name: 'Europe West (Ireland)', lat: 53.3, lon: -6.3 },
    { id: 'eu-central', name: 'Europe Central (Frankfurt)', lat: 50.1, lon: 8.7 },
    { id: 'me-central', name: 'Middle East (UAE)', lat: 25.2, lon: 55.3 },
    { id: 'af-south', name: 'Africa (Cape Town)', lat: -33.9, lon: 18.4 },
    { id: 'ap-south', name: 'Asia Pacific (Mumbai)', lat: 19.1, lon: 72.9 },
    { id: 'ap-southeast', name: 'Asia Pacific (Singapore)', lat: 1.35, lon: 103.8 },
    { id: 'ap-northeast', name: 'Asia Pacific (Tokyo)', lat: 35.7, lon: 139.7 },
    { id: 'au-east', name: 'Australia East (Sydney)', lat: -33.9, lon: 151.2 },
  ],
  defaultRegionId: 'us-east',
  pricing: {
    instancePriceMultiplier: 1,
    egressUsdPerGb: 0.09,
    storageUsdPerGbMonth: 0.023,
    requestsUsdPerMillion: 0.4,
  },
  docs: {
    summary:
      'A vendor-neutral cloud with typical list prices and a spread of regions, so you can learn the shape of a design before picking AWS, GCP or Azure.',
    howItWorks:
      'Components keep their generic names (Load Balancer, Object Storage, SQL Database). Prices are averages of the big three providers, and regions sit where most providers have one, so latency between them is realistic.',
    tradeoffs: [
      'Good for interviews, where the interviewer cares about building blocks rather than product names.',
      'Hides provider-specific limits (e.g. per-partition throughput caps) that matter in a real deployment.',
    ],
  },
});
