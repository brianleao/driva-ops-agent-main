import {
  CERTIFICATE_ENVIRONMENT,
  SYSTEM_ENVIRONMENT,
  pickEnv,
  type Environment,
} from './env.js';

const DEFAULT_TIMEOUT_MINUTES = 20;
const ATTEMPT_TIMEOUT_MARGIN_MS = 30_000;

export function communicationAttemptTimeoutMs(timeoutMs: number): number {
  const half = Math.floor(timeoutMs / 2);
  return half - Math.min(ATTEMPT_TIMEOUT_MARGIN_MS, Math.floor(half / 10));
}

export function communicationConfigFromEnv(env: Environment = process.env) {
  const minutes = Number(
    env.COMMUNICATION_TIMEOUT_MINUTES || DEFAULT_TIMEOUT_MINUTES,
  );
  const timeoutMs =
    (Number.isFinite(minutes) && minutes > 0
      ? minutes
      : DEFAULT_TIMEOUT_MINUTES) * 60_000;
  return {
    codexModel: env.COMMUNICATION_CODEX_MODEL || env.CODEX_MODEL || undefined,
    timeoutMs,
    attemptTimeoutMs: communicationAttemptTimeoutMs(timeoutMs),
    maxConcurrent: 2 as const,
    maxImages: 10 as const,
  };
}

export type CommunicationConfig = ReturnType<typeof communicationConfigFromEnv>;

export function communicationCodexEnvironment(
  env: Environment = process.env,
): Record<string, string> {
  return pickEnv(
    [
      ...SYSTEM_ENVIRONMENT,
      'GOROOT',
      ...CERTIFICATE_ENVIRONMENT,
      'CODEX_CA_CERTIFICATE',
      'CODEX_HOME',
      'CODEX_MODEL',
      'DRIVA_PROXY_API_KEY',
    ],
    env,
  );
}

export const COMMUNICATION_CONFIG = Symbol('COMMUNICATION_CONFIG');
