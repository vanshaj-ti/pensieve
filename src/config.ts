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
  /** Base URL for embeddings API (null = feature disabled). */
  embeddingsBaseUrl: string | null;
  /** API key for embeddings endpoint. */
  embeddingsApiKey: string | null;
  /** Model name for embeddings (default 'text-embedding-3-small'). */
  embeddingsModel: string;
  /** Header name for auth token (default 'Authorization'). */
  embeddingsAuthHeader: string;
  /** Auth scheme prefix (e.g. 'Bearer', empty string for raw key). */
  embeddingsAuthScheme: string;
  /** Extra headers for embeddings requests. */
  embeddingsExtraHeaders: Record<string, string>;
  /** Path component of embeddings endpoint (default '/v1/embeddings'). */
  embeddingsPath: string;
  /** Cosine similarity threshold for detecting cross-day recurrence (0-1, default 0.90). */
  recurrenceSimilarityThreshold: number;
  /** Cosine similarity threshold for same-batch duplicate collapsing (0-1, default 0.95). */
  dedupeSimilarityThreshold: number;
  /** Days of history to look back for recent insights (default 7). */
  recentHistoryDays: number;
}

function defaultConfig(): Config {
  const home = homedir();
  return {
    idleGapMinutes: DEFAULT_IDLE_GAP_MINUTES,
    dbPath: join(home, '.pensieve', 'pensieve.db'),
    briefsDir: join(home, '.pensieve', 'briefs'),
    embeddingsBaseUrl: null,
    embeddingsApiKey: null,
    embeddingsModel: 'text-embedding-3-small',
    embeddingsAuthHeader: 'Authorization',
    embeddingsAuthScheme: 'Bearer',
    embeddingsExtraHeaders: {},
    embeddingsPath: '/v1/embeddings',
    recurrenceSimilarityThreshold: 0.9,
    dedupeSimilarityThreshold: 0.95,
    recentHistoryDays: 7,
  };
}

function envConfig(): Partial<Config> {
  const env: Partial<Config> = {};

  if (process.env.PENSIEVE_IDLE_GAP_MINUTES) {
    const value = process.env.PENSIEVE_IDLE_GAP_MINUTES.trim();
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) {
      env.idleGapMinutes = parsed;
    }
  }

  if (process.env.PENSIEVE_EMBEDDINGS_BASE_URL) {
    const value = process.env.PENSIEVE_EMBEDDINGS_BASE_URL.trim();
    if (value) {
      env.embeddingsBaseUrl = value;
    }
  }

  if (process.env.PENSIEVE_EMBEDDINGS_API_KEY) {
    const value = process.env.PENSIEVE_EMBEDDINGS_API_KEY.trim();
    if (value) {
      env.embeddingsApiKey = value;
    }
  }

  if (process.env.PENSIEVE_EMBEDDINGS_MODEL) {
    const value = process.env.PENSIEVE_EMBEDDINGS_MODEL.trim();
    if (value) {
      env.embeddingsModel = value;
    }
  }

  if (process.env.PENSIEVE_EMBEDDINGS_AUTH_HEADER) {
    const value = process.env.PENSIEVE_EMBEDDINGS_AUTH_HEADER.trim();
    if (value) {
      env.embeddingsAuthHeader = value;
    }
  }

  if (process.env.PENSIEVE_EMBEDDINGS_AUTH_SCHEME !== undefined) {
    env.embeddingsAuthScheme = process.env.PENSIEVE_EMBEDDINGS_AUTH_SCHEME;
  }

  if (process.env.PENSIEVE_EMBEDDINGS_EXTRA_HEADERS) {
    try {
      const parsed = JSON.parse(process.env.PENSIEVE_EMBEDDINGS_EXTRA_HEADERS);
      if (typeof parsed === 'object' && !Array.isArray(parsed)) {
        const valid: Record<string, string> = {};
        let hasInvalid = false;
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === 'string') {
            valid[k] = v;
          } else {
            hasInvalid = true;
            break;
          }
        }
        if (!hasInvalid) {
          env.embeddingsExtraHeaders = valid;
        }
      }
    } catch {
      // Silently ignore parse/shape failure
    }
  }

  if (process.env.PENSIEVE_EMBEDDINGS_PATH) {
    const value = process.env.PENSIEVE_EMBEDDINGS_PATH.trim();
    if (value && value.startsWith('/')) {
      env.embeddingsPath = value;
    }
  }

  if (process.env.PENSIEVE_RECURRENCE_SIMILARITY_THRESHOLD) {
    const value = process.env.PENSIEVE_RECURRENCE_SIMILARITY_THRESHOLD.trim();
    const parsed = Number(value);
    if (!Number.isNaN(parsed) && parsed > 0 && parsed <= 1) {
      env.recurrenceSimilarityThreshold = parsed;
    }
  }

  if (process.env.PENSIEVE_DEDUPE_SIMILARITY_THRESHOLD) {
    const value = process.env.PENSIEVE_DEDUPE_SIMILARITY_THRESHOLD.trim();
    const parsed = Number(value);
    if (!Number.isNaN(parsed) && parsed > 0 && parsed <= 1) {
      env.dedupeSimilarityThreshold = parsed;
    }
  }

  if (process.env.PENSIEVE_RECENT_HISTORY_DAYS) {
    const value = process.env.PENSIEVE_RECENT_HISTORY_DAYS.trim();
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) {
      env.recentHistoryDays = parsed;
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
