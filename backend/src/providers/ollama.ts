const host = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';

export async function listModels(): Promise<string[]> {
  const r = await fetch(`${host}/api/tags`);
  if (!r.ok) throw new Error(`ollama tags ${r.status}`);
  const j: any = await r.json();
  return Array.isArray(j?.models) ? j.models.map((m: any) => m?.name).filter(Boolean) : [];
}

export async function generate(
  opts: { model: string; prompt: string; stream?: boolean; options?: Record<string, any> },
  options?: { timeoutMs?: number }
) {
  const timeoutMs = options?.timeoutMs ?? 120_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(`${host}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: opts.model,
        prompt: opts.prompt,
        stream: !!opts.stream,
        options: opts.options || undefined
      }),
      signal: controller.signal
    });
    return r;
  } finally {
    clearTimeout(timer);
  }
}
