import { Config } from '../config.js';
import { EmbeddingResponseSchema } from '../types.js';

const WARN_INTERVAL_MS = 5 * 60 * 1000;

let lastWarnedDisabledAt = 0;
let lastWarnedHttpErrorAt = 0;
let lastWarnedParseErrorAt = 0;
let lastWarnedFetchErrorAt = 0;

function shouldWarn(lastWarnedAt: number): boolean {
  return lastWarnedAt === 0 || Date.now() - lastWarnedAt >= WARN_INTERVAL_MS;
}

export async function embedText(text: string, config: Config): Promise<number[] | null> {
  if (!config.embeddingsBaseUrl || !config.embeddingsApiKey) {
    if (shouldWarn(lastWarnedDisabledAt)) {
      console.warn(
        'Embeddings not configured (PENSIEVE_EMBEDDINGS_BASE_URL/PENSIEVE_EMBEDDINGS_API_KEY unset); falling back to prompt-stuffing recurrence detection',
      );
      lastWarnedDisabledAt = Date.now();
    }
    return null;
  }

  const url = `${config.embeddingsBaseUrl}${config.embeddingsPath}`;
  const authValue = config.embeddingsAuthScheme
    ? `${config.embeddingsAuthScheme} ${config.embeddingsApiKey}`
    : config.embeddingsApiKey;

  const headers: Record<string, string> = {
    [config.embeddingsAuthHeader]: authValue,
    'Content-Type': 'application/json',
    ...config.embeddingsExtraHeaders,
  };

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.embeddingsModel,
        input: text,
      }),
    });

    if (!resp.ok) {
      if (shouldWarn(lastWarnedHttpErrorAt)) {
        console.error(
          `Embeddings HTTP error ${resp.status} from ${url} (further embeddings HTTP errors within the next 5 minutes will be suppressed)`,
        );
        lastWarnedHttpErrorAt = Date.now();
      }
      return null;
    }

    const data = await resp.json();
    const parsed = EmbeddingResponseSchema.safeParse(data);

    if (!parsed.success) {
      if (shouldWarn(lastWarnedParseErrorAt)) {
        console.error(
          'Embeddings response schema validation failed (further parse errors within the next 5 minutes will be suppressed)',
          parsed.error,
        );
        lastWarnedParseErrorAt = Date.now();
      }
      return null;
    }

    return parsed.data.data[0].embedding;
  } catch (err) {
    if (shouldWarn(lastWarnedFetchErrorAt)) {
      console.error(
        'Embeddings fetch error (further fetch errors within the next 5 minutes will be suppressed):',
        err instanceof Error ? err.message : String(err),
      );
      lastWarnedFetchErrorAt = Date.now();
    }
    return null;
  }
}

export function __resetEmbeddingsWarnStateForTests(): void {
  lastWarnedDisabledAt = 0;
  lastWarnedHttpErrorAt = 0;
  lastWarnedParseErrorAt = 0;
  lastWarnedFetchErrorAt = 0;
}
