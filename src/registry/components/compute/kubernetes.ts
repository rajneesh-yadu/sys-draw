import { z } from 'zod';
import { defineComponent } from '../../define';
import { GENERAL_PURPOSE_INSTANCES, MEMORY_OPTIMISED_INSTANCES } from '../../presets';

export default defineComponent({
  id: 'compute.kubernetes',
  name: 'Kubernetes Cluster',
  category: 'compute',
  tags: ['kubernetes', 'k8s', 'containers', 'pods', 'orchestration', 'cluster', 'autoscaling'],
  icon: 'container',
  providerNames: { aws: 'EKS', gcp: 'GKE', azure: 'AKS' },
  ports: [
    { id: 'in', direction: 'in', protocols: ['http1', 'http2', 'grpc', 'websocket', 'tcp'] },
    {
      id: 'out',
      direction: 'out',
      protocols: [
        'http1',
        'http2',
        'grpc',
        'tcp',
        'postgres-wire',
        'mysql-wire',
        'resp',
        'memcache',
        'kafka-wire',
        'amqp',
        'cql',
        'mongodb-wire',
        'dns',
      ],
    },
  ],
  configSchema: z.object({
    podCpuRequest: z
      .number()
      .min(0.05)
      .max(64)
      .describe('vCPU each pod requests (sets how many pods fit per node)'),
    podMemoryGb: z.number().min(0.05).max(512).describe('Memory each pod requests'),
    concurrencyPerPod: z
      .number()
      .int()
      .min(1)
      .max(10_000)
      .describe('Requests one pod handles at once (threads / event loop)'),
    maxPodsPerNode: z
      .number()
      .int()
      .min(1)
      .max(250)
      .describe('Kubelet / CNI limit on pods per node')
      .meta({ advanced: true }),
    serviceRouting: z
      .enum(['iptables', 'ipvs', 'ebpf'])
      .describe('How kube-proxy (or Cilium) sends Service traffic to pods')
      .meta({
        advanced: true,
        perfEffect: {
          iptables: {
            readAddMs: 0.05,
            writeAddMs: 0.05,
            why: 'linear iptables rule chains grow with the number of Services',
          },
        },
      }),
  }),
  defaults: {
    podCpuRequest: 0.5,
    podMemoryGb: 1,
    concurrencyPerPod: 4,
    maxPodsPerNode: 110,
    serviceRouting: 'iptables',
  },
  instanceTypes: [...GENERAL_PURPOSE_INSTANCES, ...MEMORY_OPTIMISED_INSTANCES],
  perf: {
    serviceTimeMs: { read: 10, write: 15 },
    maxConcurrencyPerInstance: 4,
    scaleCurve: 'linear',
    saturationBehavior: 'queue',
  },
  behaviors: ['podPacking', 'configPerf'],
  docs: {
    summary:
      'A managed container cluster that schedules your service as pods onto a pool of worker nodes, restarts them, scales them and routes traffic to them.',
    howItWorks:
      'You declare a Deployment (image, replicas, CPU/memory requests); the scheduler bin-packs pods onto worker nodes that have room for their requests, after the kubelet and system daemons take their share. A Service gives the pods one virtual IP and spreads requests over ready pods (kube-proxy / eBPF). The Horizontal Pod Autoscaler adds pods on CPU or custom metrics, and the cluster autoscaler adds nodes when pods are Pending. In this component the replicas are worker NODES: capacity = nodes × pods per node × requests per pod, and a bigger node fits more pods rather than making each faster.',
    tradeoffs: [
      'Portable, self-healing and dense packing of many services — but a steep operational learning curve (networking, upgrades, RBAC).',
      'Requests set packing and cost; too high wastes nodes, too low causes CPU throttling and noisy neighbours.',
      'Scaling has two layers and two delays: pods in seconds, nodes in minutes.',
    ],
    interviewTips: [
      'Say how many pods per node and nodes per zone, and how HPA + cluster autoscaler react to a spike.',
      'Spread replicas across zones (topology spread constraints) and set PodDisruptionBudgets.',
      'Mention readiness probes and graceful shutdown so deploys do not drop requests.',
    ],
  },
  security: {
    defaultPorts: [443, 6443, 10250],
    threats: [
      'Public API server endpoint with weak RBAC',
      'Privileged pods escaping to the node',
      'Secrets readable by any pod in the namespace',
    ],
    controls: [
      'Private control plane endpoint, least-privilege RBAC, workload identity',
      'Pod Security Standards (restricted), NetworkPolicies default-deny',
      'Encrypt Secrets with KMS; image signing and scanning',
    ],
  },
});
