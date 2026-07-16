import { Config } from '../config.js';
import { EmbeddingResponseSchema } from '../types.js';

let warnedAboutDisabled = false;
let warnedAboutHttpError = false;
let warnedAboutParseError = false;
let warnedAboutFetchError = false;

export async function embedText(text: string, config: Config): Promise<number[] | null> {
  if (!config.embeddingsBaseUrl || !config.embeddingsApiKey) {
    if (!warnedAboutDisabled) {
      console.warn('Embeddings not configured (PENSIEVE_EMBEDDINGS_BASE_URL/PENSIEVE_EMBEDDINGS_API_KEY unset); falling back to prompt-stuffing recurrence detection');
      warnedAboutDisabled = true;
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
      if (!warnedAboutHttpError) {
        console.error(`Embeddings HTTP error ${resp.status} from ${url} (further embeddings HTTP errors this run will be suppressed)`);
        warnedAboutHttpError = true;
      }
      return null;
    }

    const data = await resp.json();
    const parsed = EmbeddingResponseSchema.safeParse(data);

    if (!parsed.success) {
      if (!warnedAboutParseError) {
        console.error('Embeddings response schema validation failed (further parse errors this run will be suppressed)', parsed.error);
        warnedAboutParseError = true;
      }
      return null;
    }

    return parsed.data.data[0].embedding;
  } catch (err) {
    if (!warnedAboutFetchError) {
      console.error('Embeddings fetch error (further fetch errors this run will be suppressed):', err instanceof Error ? err.message : String(err));
      warnedAboutFetchError = true;
    }
    return null;
  }
}
