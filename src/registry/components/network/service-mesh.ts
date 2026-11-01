import { z } from 'zod';
import { defineComponent } from '../../define';
import { GENERAL_PURPOSE_INSTANCES } from '../../presets';

export default defineComponent({
  id: 'network.service-mesh',
  name: 'Service Mesh',
  category: 'network',
  tags: [
    'service-mesh',
    'istio',
    'linkerd',
    'envoy',
    'mtls',
    'sidecar',
    'kubernetes',
    'observability',
    'control:mtls',
  ],
  icon: 'share-2',
  providerNames: {
    aws: 'VPC Lattice',
    gcp: 'Cloud Service Mesh',
    azure: 'Istio-based service mesh add-on for AKS',
  },
  ports: [
    { id: 'in', direction: 'in', protocols: ['http1', 'http2', 'grpc', 'tcp', 'tls13'] },
    { id: 'services', direction: 'out', protocols: ['http1', 'http2', 'grpc', 'tcp', 'tls13'] },
  ],
  configSchema: z.object({
    dataPlane: z
      .enum(['sidecar', 'ambient'])
      .describe(
        'A proxy next to every pod (Envoy sidecar) or a shared per-node proxy (ambient / ztunnel)',
      )
      .meta({
        perfEffect: {
          sidecar: {
            read: 1.5,
            write: 1.5,
            readAddMs: 0.6,
            writeAddMs: 0.6,
            why: 'two Envoy hops per call (client-side and server-side sidecars), each parsing HTTP',
          },
          ambient: {
            readAddMs: 0.2,
            writeAddMs: 0.2,
            why: 'L4 ztunnel per node; L7 features only through optional waypoint proxies',
          },
        },
      }),
    mtls: z
      .enum(['strict', 'permissive', 'off'])
      .describe('Mutual TLS between services: strict rejects plaintext')
      .meta({
        perfEffect: {
          strict: { read: 1.2, write: 1.2, why: 'encrypting every hop with workload certificates' },
          permissive: { read: 1.2, write: 1.2, why: 'mTLS where both sides support it' },
        },
      }),
    algorithm: z
      .enum(['round-robin', 'least-connections', 'consistent-hash', 'random'])
      .describe('Client-side balancing over the destination pods'),
    retries: z
      .number()
      .int()
      .min(0)
      .max(10)
      .describe('Mesh retry policy (set the edge retries to simulate them)')
      .meta({ advanced: true }),
    healthCheckIntervalSec: z
      .number()
      .int()
      .min(1)
      .max(300)
      .describe('Outlier detection interval')
      .meta({ advanced: true }),
    unhealthyThreshold: z
      .number()
      .int()
      .min(1)
      .max(10)
      .describe('Consecutive errors before a pod is ejected')
      .meta({ advanced: true }),
  }),
  defaults: {
    dataPlane: 'sidecar',
    mtls: 'strict',
    algorithm: 'least-connections',
    retries: 2,
    healthCheckIntervalSec: 10,
    unhealthyThreshold: 5,
  },
  instanceTypes: [...GENERAL_PURPOSE_INSTANCES],
  perf: {
    // one proxy traversal; dataPlane / mtls effects scale it
    serviceTimeMs: { read: 0.15, write: 0.15 },
    maxConcurrencyPerInstance: 64,
    scaleCurve: 'linear',
    saturationBehavior: 'reject',
  },
  behaviors: ['loadBalancer', 'configPerf'],
  docs: {
    summary:
      'An infrastructure layer of proxies that carries service-to-service traffic, adding mTLS identity, retries, timeouts, traffic splitting and uniform telemetry without changing application code.',
    howItWorks:
      'A control plane (istiod, Linkerd destination) issues workload certificates and pushes routing config to the data plane. In sidecar mode every pod gets an Envoy proxy that intercepts its traffic, so each call passes two proxies; ambient mode replaces sidecars with a per-node L4 tunnel plus optional L7 waypoints. Proxies pick a healthy destination pod (least request), apply retries/timeouts/circuit breaking, encrypt with mTLS and emit metrics and traces. Place this node between callers and the services they call; its CPU and added milliseconds are the mesh tax.',
    tradeoffs: [
      'Zero-trust mTLS, traffic management and golden metrics everywhere — at the price of ~1 ms and extra CPU/memory per hop, plus a complex control plane.',
      'Sidecars are mature but multiply proxies; ambient mode is lighter but newer.',
      'Retries in both the mesh and the app multiply load (retry storms); configure them in one place.',
    ],
    interviewTips: [
      'Bring it up for many microservices needing mTLS, canary releases (traffic splitting) and consistent observability.',
      'Quantify the cost: two proxy hops per call; for a 10-hop call chain that is milliseconds of p99.',
      'For a handful of services, a library or an API gateway is often enough.',
    ],
  },
  security: {
    defaultPorts: [15001, 15006, 15008, 15012],
    threats: [
      'Permissive mode silently accepting plaintext traffic',
      'Over-broad authorization policies (any service can call any service)',
      'Compromised control plane issuing certificates',
    ],
    controls: [
      'STRICT mTLS and default-deny AuthorizationPolicies',
      'Short-lived workload certificates (SPIFFE identities)',
      'Harden and isolate the control plane; audit config changes',
    ],
  },
});
