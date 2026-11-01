import { z } from 'zod';
import { defineComponent } from '../../define';
import { GENERAL_PURPOSE_INSTANCES } from '../../presets';

export default defineComponent({
  id: 'security.bastion',
  name: 'Bastion / VPN',
  category: 'security',
  tags: ['bastion', 'vpn', 'admin-access', 'jump-host', 'control:bastion', 'control:vpn'],
  icon: 'door-closed-locked',
  providerNames: {
    aws: 'Systems Manager Session Manager',
    gcp: 'Identity-Aware Proxy',
    azure: 'Azure Bastion',
  },
  ports: [
    { id: 'in', direction: 'in', protocols: ['http2', 'http1', 'tls13', 'udp', 'tcp'] },
    {
      id: 'targets',
      direction: 'out',
      protocols: [
        'postgres-wire',
        'mysql-wire',
        'resp',
        'mongodb-wire',
        'cql',
        'http1',
        'tls13',
        'tcp',
      ],
    },
  ],
  configSchema: z.object({
    access: z
      .enum(['bastion', 'vpn'])
      .describe(
        'Bastion: one hardened jump host per session. VPN: an encrypted tunnel into the network',
      ),
    requireMfa: z.boolean().describe('Operators authenticate with SSO + MFA before connecting'),
    sessionRecording: z
      .boolean()
      .describe('Record and audit every admin session')
      .meta({ advanced: true }),
  }),
  defaults: { access: 'bastion', requireMfa: true, sessionRecording: true },
  instanceTypes: [...GENERAL_PURPOSE_INSTANCES],
  perf: {
    serviceTimeMs: { read: 1, write: 1 },
    maxConcurrencyPerInstance: 200,
    scaleCurve: 'linear',
    saturationBehavior: 'reject',
  },
  docs: {
    summary:
      'The only way for people to reach private servers and databases: operators connect to the bastion (or VPN) with SSO + MFA, so SSH, RDP and database ports never face the internet.',
    howItWorks:
      'The bastion lives in the DMZ and is the single allowed source in the private and data security groups for admin ports (22, 3389, 5432…). Managed variants (Session Manager, IAP, Azure Bastion) need no open inbound port at all: the agent dials out and sessions are brokered over HTTPS, authorised by IAM and recorded. A VPN instead extends the private network to the operator’s laptop over an encrypted tunnel (IPsec/WireGuard).',
    tradeoffs: [
      'One audited entry point instead of many open ports — but it is a high-value target and a single point of failure for operations.',
      'VPNs give broad network access once connected; zero-trust proxies authorise per application.',
    ],
    interviewTips: [
      'Never expose SSH/RDP or database ports to 0.0.0.0/0: allow them only from the bastion’s security group.',
      'Prefer managed session brokers (no inbound port, IAM + MFA, recordings).',
    ],
  },
  security: {
    defaultPorts: [22, 443],
    threats: ['Bastion itself open to the internet on SSH', 'Shared keys between operators'],
    controls: ['SSO + MFA', 'Session recording', 'No inbound port with managed brokers'],
  },
});
