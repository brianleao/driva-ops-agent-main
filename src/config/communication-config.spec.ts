import { describe, expect, it } from 'vitest';
import {
  communicationAttemptTimeoutMs,
  communicationCodexEnvironment,
  communicationConfigFromEnv,
} from './communication-config.js';

describe('communicationConfigFromEnv', () => {
  it('applies defaults', () => {
    expect(communicationConfigFromEnv({})).toEqual({
      codexModel: undefined,
      timeoutMs: 20 * 60_000,
      attemptTimeoutMs: 570_000,
      maxConcurrent: 2,
      maxImages: 10,
    });
  });

  it('prefers the communication model over CODEX_MODEL', () => {
    expect(
      communicationConfigFromEnv({
        CODEX_MODEL: 'base',
        COMMUNICATION_CODEX_MODEL: 'special',
      }).codexModel,
    ).toBe('special');
    expect(communicationConfigFromEnv({ CODEX_MODEL: 'base' }).codexModel).toBe(
      'base',
    );
  });

  it('converts timeout minutes and falls back on invalid values', () => {
    const timeout = (value: string) =>
      communicationConfigFromEnv({
        COMMUNICATION_TIMEOUT_MINUTES: value,
      }).timeoutMs;
    expect(timeout('5')).toBe(300_000);
    expect(timeout('abc')).toBe(1_200_000);
    expect(timeout('-3')).toBe(1_200_000);
  });
});

describe('communicationAttemptTimeoutMs', () => {
  it('gives each Codex attempt less than half of the runner budget', () => {
    expect(communicationAttemptTimeoutMs(20 * 60_000)).toBe(570_000);
    expect(communicationAttemptTimeoutMs(60_000)).toBe(27_000);
    for (const budget of [60_000, 300_000, 1_200_000, 3_600_000])
      expect(2 * communicationAttemptTimeoutMs(budget)).toBeLessThan(budget);
  });
});

describe('communicationCodexEnvironment', () => {
  it('passes only the Codex allowlist', () => {
    const result = communicationCodexEnvironment({
      DRIVA_PROXY_API_KEY: 'key',
      CODEX_HOME: '/codex',
      SALES_POSTGRESQL_PASSWORD: 'x',
      CLICKHOUSE_PASSWORD: 'x',
      CLICKUP_API_TOKEN: 'x',
      GH_TOKEN: 'x',
    });
    expect(result.DRIVA_PROXY_API_KEY).toBe('key');
    expect(result.CODEX_HOME).toBe('/codex');
    for (const name of [
      'SALES_POSTGRESQL_PASSWORD',
      'CLICKHOUSE_PASSWORD',
      'CLICKUP_API_TOKEN',
      'GH_TOKEN',
    ])
      expect(result).not.toHaveProperty(name);
  });
});
