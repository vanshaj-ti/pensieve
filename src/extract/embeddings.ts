import { Config } from '../config.js';
import { EmbeddingResponseSchema } from '../types.js';

let warnedAboutDisabled = false;

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
      console.error(`Embeddings HTTP error ${resp.status} from ${url}`);
      return null;
    }

    const data = await resp.json();
    const parsed = EmbeddingResponseSchema.safeParse(data);

    if (!parsed.success) {
      console.error('Embeddings response schema validation failed', parsed.error);
      return null;
    }

    return parsed.data.data[0].embedding;
  } catch (err) {
    console.error('Embeddings fetch error:', err instanceof Error ? err.message : String(err));
    return null;
  }
}
