import { defineProvider } from '../define';

export default defineProvider({
  id: 'generic',
  name: 'Generic cloud',
  shortName: 'Generic',
  // ~25 regions where the big three all have one; ids are generic, coordinates the metro area.
  regions: [
    { id: 'us-east', name: 'US East (Virginia)', lat: 38.9, lon: -77.4 },
    { id: 'us-central', name: 'US Central (Iowa)', lat: 41.3, lon: -95.9 },
    { id: 'us-south', name: 'US South (Texas)', lat: 32.8, lon: -96.8 },
    { id: 'us-west', name: 'US West (Oregon)', lat: 45.6, lon: -121.2 },
    { id: 'us-west-2', name: 'US West (N. California)', lat: 37.4, lon: -121.9 },
    { id: 'ca-central', name: 'Canada Central (Montréal)', lat: 45.5, lon: -73.6 },
    { id: 'mx-central', name: 'Mexico Central (Querétaro)', lat: 20.6, lon: -100.4 },
    { id: 'sa-east', name: 'South America (São Paulo)', lat: -23.5, lon: -46.6 },
    { id: 'sa-west', name: 'South America (Santiago)', lat: -33.4, lon: -70.6 },
    { id: 'eu-west', name: 'Europe West (Ireland)', lat: 53.3, lon: -6.3 },
    { id: 'uk-south', name: 'UK South (London)', lat: 51.5, lon: -0.1 },
    { id: 'eu-central', name: 'Europe Central (Frankfurt)', lat: 50.1, lon: 8.7 },
    { id: 'eu-north', name: 'Europe North (Stockholm)', lat: 59.3, lon: 18.1 },
    { id: 'eu-south', name: 'Europe South (Milan)', lat: 45.5, lon: 9.2 },
    { id: 'me-west', name: 'Middle East (Tel Aviv)', lat: 32.1, lon: 34.8 },
    { id: 'me-central', name: 'Middle East (UAE)', lat: 25.2, lon: 55.3 },
    { id: 'af-south', name: 'Africa (Cape Town)', lat: -33.9, lon: 18.4 },
    { id: 'ap-south', name: 'Asia Pacific (Mumbai)', lat: 19.1, lon: 72.9 },
    { id: 'ap-south-2', name: 'Asia Pacific (Hyderabad)', lat: 17.4, lon: 78.5 },
    { id: 'ap-southeast', name: 'Asia Pacific (Singapore)', lat: 1.35, lon: 103.8 },
    { id: 'ap-southeast-2', name: 'Asia Pacific (Jakarta)', lat: -6.2, lon: 106.8 },
    { id: 'ap-east', name: 'Asia Pacific (Hong Kong)', lat: 22.3, lon: 114.2 },
    { id: 'ap-northeast', name: 'Asia Pacific (Tokyo)', lat: 35.7, lon: 139.7 },
    { id: 'ap-northeast-2', name: 'Asia Pacific (Seoul)', lat: 37.6, lon: 127.0 },
    { id: 'au-east', name: 'Australia East (Sydney)', lat: -33.9, lon: 151.2 },
    { id: 'au-southeast', name: 'Australia Southeast (Melbourne)', lat: -37.8, lon: 145.0 },
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
