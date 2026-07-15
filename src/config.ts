import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_IDLE_GAP_MINUTES = 25;

export interface Config {
  /** Minutes of inactivity between lines that forces a new episode boundary (spec §4). */
  idleGapMinutes: number;
  /** Path to the SQLite database file (spec §7). */
  dbPath: string;
  /** Directory where daily markdown briefs are written (spec §8). */
  briefsDir: string;
}

function defaultConfig(): Config {
  const home = homedir();
  return {
    idleGapMinutes: DEFAULT_IDLE_GAP_MINUTES,
    dbPath: join(home, '.pensieve', 'pensieve.db'),
    briefsDir: join(home, '.pensieve', 'briefs'),
  };
}

function envConfig(): Partial<Config> {
  const env: Partial<Config> = {};

  if (process.env.PENSIEVE_IDLE_GAP_MINUTES) {
    const parsed = parseInt(process.env.PENSIEVE_IDLE_GAP_MINUTES, 10);
    if (!isNaN(parsed) && parsed > 0) {
      env.idleGapMinutes = parsed;
    }
  }

  return env;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  return {
    ...defaultConfig(),
    ...envConfig(),
    ...overrides,
  };
}
