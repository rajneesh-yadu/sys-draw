import { z } from 'zod';
import { defineComponent } from '../../define';
import { GENERAL_PURPOSE_INSTANCES } from '../../presets';

export default defineComponent({
  id: 'security.auth-server',
  name: 'Auth Server (OAuth2 / OIDC)',
  category: 'security',
  tags: ['auth', 'oauth2', 'oidc', 'jwt', 'login', 'mfa', 'identity', 'control:auth'],
  icon: 'user-check',
  providerNames: {
    aws: 'Amazon Cognito',
    gcp: 'Identity Platform',
    azure: 'Microsoft Entra External ID',
  },
  ports: [
    { id: 'in', direction: 'in', protocols: ['http1', 'http2', 'grpc', 'tls13', 'tcp'] },
    {
      id: 'users-db',
      direction: 'out',
      protocols: ['postgres-wire', 'mysql-wire', 'resp', 'http1', 'http2', 'tls13', 'tcp'],
    },
  ],
  configSchema: z.object({
    tokenFormat: z
      .enum(['jwt', 'opaque'])
      .describe('JWT: services verify tokens locally. Opaque: every check calls the auth server'),
    accessTokenTtlMin: z
      .number()
      .int()
      .min(1)
      .max(1440)
      .describe('Access token lifetime (shorter = faster revocation, more refreshes)'),
    mfa: z
      .enum(['off', 'optional', 'required'])
      .describe('Second factor: stops logins with stolen passwords (credential stuffing)'),
    passwordHash: z
      .enum(['bcrypt', 'argon2id', 'scrypt'])
      .describe('Slow password hashing: each login costs tens of ms of CPU on purpose')
      .meta({ advanced: true }),
    lockoutAfterFailures: z
      .number()
      .int()
      .min(0)
      .max(100)
      .describe('Lock or challenge an account after N failed logins (0 = off)')
      .meta({ advanced: true }),
  }),
  defaults: {
    tokenFormat: 'jwt',
    accessTokenTtlMin: 15,
    mfa: 'optional',
    passwordHash: 'argon2id',
    lockoutAfterFailures: 5,
  },
  instanceTypes: [...GENERAL_PURPOSE_INSTANCES],
  perf: {
    // write = a login (slow password hash); read = token refresh / introspection
    serviceTimeMs: { read: 2, write: 60 },
    maxConcurrencyPerInstance: 16,
    scaleCurve: 'linear',
    saturationBehavior: 'queue',
  },
  docs: {
    summary:
      'Authenticates users (password + MFA, social login) and issues short-lived signed tokens (OAuth2 / OpenID Connect), so services and the API gateway can verify who is calling without seeing passwords.',
    howItWorks:
      'The client is redirected to the auth server (authorization code + PKCE), the user logs in, and the server returns an ID token and a short-lived access token (a signed JWT) plus a refresh token. Gateways and services verify the JWT signature with the server’s public keys (JWKS) — no call per request. Passwords are stored as slow hashes (argon2id/bcrypt), which is why a login costs tens of milliseconds of CPU and why credential-stuffing floods are expensive.',
    tradeoffs: [
      'JWTs scale (local verification) but cannot be revoked before they expire: keep them short and use refresh tokens.',
      'Building your own is risky; managed identity providers handle MFA, breach detection and compliance.',
    ],
    interviewTips: [
      'Gateway validates the JWT; services still check authorisation per object.',
      'Against credential stuffing: MFA, rate limits per account and IP, bot detection, breached-password checks.',
    ],
  },
  security: {
    defaultPorts: [443],
    threats: ['Credential stuffing', 'Token theft (XSS, logs)', 'Weak password storage'],
    controls: ['MFA', 'Short-lived tokens', 'argon2id / bcrypt', 'Account lockout and bot checks'],
  },
});
