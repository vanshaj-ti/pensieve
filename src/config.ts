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

export function loadConfig(overrides: Partial<Config> = {}): Config {
  return {
    ...defaultConfig(),
    ...overrides,
  };
}
