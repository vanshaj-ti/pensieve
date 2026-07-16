import { describe, it, expect, beforeEach, vi } from 'vitest';
import { embedText } from '../src/extract/embeddings.js';
import { type Config } from '../src/config.js';

describe('embedText', () => {
  const defaultConfig: Config = {
    idleGapMinutes: 25,
    dbPath: ':memory:',
    briefsDir: '/tmp',
    embeddingsBaseUrl: 'https://api.example.com',
    embeddingsApiKey: 'test-key',
    embeddingsModel: 'text-embedding-3-small',
    embeddingsAuthHeader: 'Authorization',
    embeddingsAuthScheme: 'Bearer',
    embeddingsExtraHeaders: {},
    embeddingsPath: '/v1/embeddings',
    recurrenceSimilarityThreshold: 0.90,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null if embeddings not configured', async () => {
    const config: Config = { ...defaultConfig, embeddingsBaseUrl: null };
    const result = await embedText('test', config);
    expect(result).toBeNull();
  });

  it('builds correct URL and headers for default OpenAI-style config', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await embedText('test text', defaultConfig);

    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe('https://api.example.com/v1/embeddings');
    expect(call[1]?.headers).toMatchObject({
      Authorization: 'Bearer test-key',
      'Content-Type': 'application/json',
    });
  });

  it('handles custom path and headers', async () => {
    const config: Config = {
      ...defaultConfig,
      embeddingsPath: '/embeddings',
      embeddingsAuthHeader: 'X-API-Key',
      embeddingsAuthScheme: '',
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ embedding: [0.1], index: 0 }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await embedText('test', config);

    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe('https://api.example.com/embeddings');
    expect(call[1]?.headers).toMatchObject({
      'X-API-Key': 'test-key',
    });
  });

  it('merges extra headers', async () => {
    const config: Config = {
      ...defaultConfig,
      embeddingsExtraHeaders: { 'X-Custom': 'value' },
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ embedding: [0.1], index: 0 }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await embedText('test', config);

    const headers = fetchMock.mock.calls[0][1]?.headers;
    expect(headers).toMatchObject({
      'X-Custom': 'value',
      'Content-Type': 'application/json',
    });
  });

  it('returns embedding vector on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await embedText('test', defaultConfig);
    expect(result).toEqual([0.1, 0.2, 0.3]);
  });

  it('returns null on non-2xx response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await embedText('test', defaultConfig);
    expect(result).toBeNull();
  });

  it('returns null on malformed response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await embedText('test', defaultConfig);
    expect(result).toBeNull();
  });

  it('returns null on fetch error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('Network error'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await embedText('test', defaultConfig);
    expect(result).toBeNull();
  });

  it('sends correct body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ embedding: [0.1], index: 0 }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await embedText('test input', defaultConfig);

    const body = fetchMock.mock.calls[0][1]?.body;
    expect(JSON.parse(body as string)).toEqual({
      model: 'text-embedding-3-small',
      input: 'test input',
    });
  });
});
