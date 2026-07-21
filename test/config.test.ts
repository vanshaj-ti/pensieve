import { describe, it, expect, afterEach } from 'vitest';
import { loadConfig, DEFAULT_IDLE_GAP_MINUTES } from '../src/config.js';

describe('loadConfig', () => {
  afterEach(() => {
    delete process.env.PENSIEVE_IDLE_GAP_MINUTES;
    delete process.env.PENSIEVE_RECURRENCE_SIMILARITY_THRESHOLD;
    delete process.env.PENSIEVE_DEDUPE_SIMILARITY_THRESHOLD;
    delete process.env.PENSIEVE_RECENT_HISTORY_DAYS;
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

  it('rejects decimal string "1.5" (not a whole number)', () => {
    process.env.PENSIEVE_IDLE_GAP_MINUTES = '1.5';
    const config = loadConfig();
    expect(config.idleGapMinutes).toBe(DEFAULT_IDLE_GAP_MINUTES);
  });

  it('rejects "45minutes" (trailing text after number)', () => {
    process.env.PENSIEVE_IDLE_GAP_MINUTES = '45minutes';
    const config = loadConfig();
    expect(config.idleGapMinutes).toBe(DEFAULT_IDLE_GAP_MINUTES);
  });

  it('rejects non-numeric, zero, and negative values', () => {
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

  it('reads PENSIEVE_RECENT_HISTORY_DAYS from environment', () => {
    process.env.PENSIEVE_RECENT_HISTORY_DAYS = '14';
    const config = loadConfig();
    expect(config.recentHistoryDays).toBe(14);
  });

  it('recentHistoryDays: rejects decimal, zero, negative, non-integer', () => {
    process.env.PENSIEVE_RECENT_HISTORY_DAYS = '3.5';
    let config = loadConfig();
    expect(config.recentHistoryDays).toBe(7); // Default

    process.env.PENSIEVE_RECENT_HISTORY_DAYS = '0';
    config = loadConfig();
    expect(config.recentHistoryDays).toBe(7);

    process.env.PENSIEVE_RECENT_HISTORY_DAYS = '-5';
    config = loadConfig();
    expect(config.recentHistoryDays).toBe(7);
  });

  it('reads similarity thresholds independently', () => {
    process.env.PENSIEVE_RECURRENCE_SIMILARITY_THRESHOLD = '0.85';
    process.env.PENSIEVE_DEDUPE_SIMILARITY_THRESHOLD = '0.92';
    const config = loadConfig();
    expect(config.recurrenceSimilarityThreshold).toBe(0.85);
    expect(config.dedupeSimilarityThreshold).toBe(0.92);
  });
});
