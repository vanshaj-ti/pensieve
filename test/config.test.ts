import { describe, it, expect, afterEach } from 'vitest';
import { loadConfig, DEFAULT_IDLE_GAP_MINUTES } from '../src/config.js';

describe('loadConfig', () => {
  afterEach(() => {
    delete process.env.PENSIEVE_IDLE_GAP_MINUTES;
  });

  it('returns defaults when no env or overrides set', () => {
    const config = loadConfig();
    expect(config.idleGapMinutes).toBe(DEFAULT_IDLE_GAP_MINUTES);
    expect(config.idleGapMinutes).toBe(25);
  });

  it('reads PENSIEVE_IDLE_GAP_MINUTES from environment', () => {
    process.env.PENSIEVE_IDLE_GAP_MINUTES = '45';
    const config = loadConfig();
    expect(config.idleGapMinutes).toBe(45);
  });

  it('prefers explicit overrides over env vars', () => {
    process.env.PENSIEVE_IDLE_GAP_MINUTES = '45';
    const config = loadConfig({ idleGapMinutes: 60 });
    expect(config.idleGapMinutes).toBe(60);
  });

  it('ignores invalid PENSIEVE_IDLE_GAP_MINUTES (non-numeric, zero, negative)', () => {
    process.env.PENSIEVE_IDLE_GAP_MINUTES = 'not-a-number';
    let config = loadConfig();
    expect(config.idleGapMinutes).toBe(DEFAULT_IDLE_GAP_MINUTES);

    process.env.PENSIEVE_IDLE_GAP_MINUTES = '0';
    config = loadConfig();
    expect(config.idleGapMinutes).toBe(DEFAULT_IDLE_GAP_MINUTES);

    process.env.PENSIEVE_IDLE_GAP_MINUTES = '-10';
    config = loadConfig();
    expect(config.idleGapMinutes).toBe(DEFAULT_IDLE_GAP_MINUTES);
  });

  it('preserves dbPath and briefsDir defaults', () => {
    const config = loadConfig();
    expect(config.dbPath).toMatch(/\.pensieve\/pensieve\.db$/);
    expect(config.briefsDir).toMatch(/\.pensieve\/briefs$/);
  });
});
