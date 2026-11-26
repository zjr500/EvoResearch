/**
 * Real embedding provider entry for semantic search.
 * Tonight no local embedding model is available and downloading models is not
 * authorized, so the default state is "unconfigured": the search endpoint then
 * answers 4009 honestly instead of falling back to keyword matching.
 * Configure a local Ollama-compatible endpoint to activate:
 *   EVORESEARCH_EMBEDDING_BASE=http://127.0.0.1:11434
 *   EVORESEARCH_EMBEDDING_MODEL=bge-m3
 */
export interface EmbeddingProvider {
  readonly name: string;
  /** Vector dimension produced by this provider; a change forces an index rebuild. */
  dim(): Promise<number>;
  embed(texts: string[]): Promise<number[][]>;
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly name: string;
  constructor(private base: string, private model: string) {
    const url = new URL(base);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Embedding base must be HTTP(S)');
    this.name = `ollama:${model}`;
  }
  private async request(path: string, body: unknown, timeoutMs = 30000): Promise<any> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(new URL(path, this.base.endsWith('/') ? this.base : this.base + '/'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`embedding provider HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }
  async dim(): Promise<number> {
    const out = await this.embed(['dimension probe']);
    return out[0].length;
  }
  async embed(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];
    if (texts.some((t) => typeof t !== 'string' || !t.trim())) throw new Error('embedding input must be non-empty text');
    const out = await this.request('api/embed', { model: this.model, input: texts });
    if (!out || !Array.isArray(out.embeddings) || out.embeddings.length !== texts.length)
      throw new Error('embedding provider returned an unexpected shape');
    return out.embeddings;
  }
}

/** Returns the configured provider, or null when embedding is not set up. */
export function configuredEmbeddingProvider(env: NodeJS.ProcessEnv = process.env): EmbeddingProvider | null {
  const base = env.EVORESEARCH_EMBEDDING_BASE?.trim();
  const model = env.EVORESEARCH_EMBEDDING_MODEL?.trim();
  if (!base && !model) return null;
  if (!base || !model) throw new Error('EVORESEARCH_EMBEDDING_BASE and EVORESEARCH_EMBEDDING_MODEL must be set together');
  return new OllamaEmbeddingProvider(base, model);
}
