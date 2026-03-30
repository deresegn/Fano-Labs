import { invoke } from '@tauri-apps/api/core';

export type AIProvider = 'ollama' | 'openai' | 'anthropic' | 'gemini';
export type WorkspaceNode = {
  name: string;
  path: string;
  is_dir: boolean;
  children: WorkspaceNode[];
};
export type ProviderStatus = {
  id: AIProvider;
  enabled: boolean;
  configured?: boolean;
  reachable?: boolean | null;
  detail?: string;
};
type GenReq = { prompt: string; model?: string; language?: string; context?: string };
type GenRes = { code: string; error?: string };

const USE_OLLAMA = String((import.meta as any).env?.VITE_USE_OLLAMA ?? 'false') === 'true';
const OLLAMA_URL =
  (import.meta as any).env?.VITE_OLLAMA_URL ?? 'http://localhost:11434';
const BACKEND_URL =
  (import.meta as any).env?.VITE_BACKEND_URL ?? 'http://localhost:3001';

const backend = BACKEND_URL.replace(/\/$/, '');
const ollama = OLLAMA_URL.replace(/\/$/, '');

async function readErrorDetail(r: Response, fallback: string): Promise<string> {
  try {
    const j: any = await r.json();
    const detail = String(j?.detail || j?.error || '').trim();
    if (detail) return detail;
  } catch {
    // ignore JSON parse failure and try plain text
  }
  try {
    const txt = (await r.text()).trim();
    if (txt) return txt;
  } catch {
    // ignore text read failure
  }
  return fallback;
}

function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const w: any = window as any;
  return (
    typeof w.__TAURI__ !== 'undefined' ||
    typeof w.__TAURI_INTERNALS__ !== 'undefined' ||
    String(w.location?.protocol || '') === 'tauri:' ||
    String(w.location?.origin || '').startsWith('tauri://')
  );
}

async function fetchOllamaModels(): Promise<Array<{id:string;name:string;description?:string}>> {
  const r = await fetch(`${ollama}/api/tags`);
  if (!r.ok) throw new Error(`ollama ${r.status}`);
  const j: any = await r.json();
  const models = Array.isArray(j?.models) ? j.models : [];
  const unique = new Map<string, {id:string;name:string;description?:string}>();
  models.forEach((m: any) => {
    const id = String(m?.name || '').trim();
    if (!id) return;
    unique.set(id, {
      id,
      name: id,
      description: m?.details?.family || 'Ollama'
    });
  });
  return Array.from(unique.values());
}

async function nativeOllamaModels(): Promise<Array<{id:string;name:string;description?:string}>> {
  try {
    const names = await invoke<string[]>('list_local_models');
    if (!Array.isArray(names)) return [];
    return names
      .map((name) => String(name || '').trim())
      .filter(Boolean)
      .map((id) => ({ id, name: id, description: 'Local Ollama' }));
  } catch {
    return [];
  }
}

async function nativeOllamaGenerate(req: GenReq): Promise<string> {
  try {
    const out = await invoke<string>('generate_with_ollama', {
      prompt: req.prompt,
      model: req.model ?? 'qwen2.5-coder:0.5b'
    });
    const text = String(out || '').trim();
    if (!text) throw new Error('empty_native_ollama_response');
    return text;
  } catch {
    throw new Error('native_ollama_unavailable');
  }
}

export async function getProviders(): Promise<Array<{ id: AIProvider; enabled: boolean }>> {
  try {
    const r = await fetch(`${backend}/providers`);
    if (!r.ok) throw new Error(`providers ${r.status}`);
    const j: any = await r.json();
    const providers = Array.isArray(j?.providers) ? j.providers : [];
    return providers
      .map((p: any) => ({ id: String(p?.id || '') as AIProvider, enabled: Boolean(p?.enabled) }))
      .filter((p: any) => p.id === 'ollama' || p.id === 'openai' || p.id === 'anthropic' || p.id === 'gemini');
  } catch {
    return [
      { id: 'ollama', enabled: true },
      { id: 'openai', enabled: false },
      { id: 'anthropic', enabled: false },
      { id: 'gemini', enabled: false },
    ];
  }
}

export async function getProviderStatus(): Promise<ProviderStatus[]> {
  try {
    const r = await fetch(`${backend}/providers/status`);
    if (!r.ok) throw new Error(`providers/status ${r.status}`);
    const j: any = await r.json();
    const providers = Array.isArray(j?.providers) ? j.providers : [];
    return providers
      .map((p: any) => ({
        id: String(p?.id || '') as AIProvider,
        enabled: Boolean(p?.enabled),
        configured: Boolean(p?.configured ?? p?.enabled),
        reachable: p?.reachable === undefined ? null : p?.reachable === null ? null : Boolean(p?.reachable),
        detail: String(p?.detail || ''),
      }))
      .filter((p: any) => p.id === 'ollama' || p.id === 'openai' || p.id === 'anthropic' || p.id === 'gemini');
  } catch {
    return [
      { id: 'ollama', enabled: true, configured: true, reachable: false, detail: 'Backend offline (status fetch failed).' },
      { id: 'openai', enabled: false, configured: false, reachable: false, detail: 'Backend offline (status fetch failed).' },
      { id: 'anthropic', enabled: false, configured: false, reachable: false, detail: 'Backend offline (status fetch failed).' },
      { id: 'gemini', enabled: false, configured: false, reachable: false, detail: 'Backend offline (status fetch failed).' },
    ];
  }
}

export async function testProvider(provider: AIProvider): Promise<{ ok: boolean; detail: string; status?: ProviderStatus }> {
  const r = await fetch(`${backend}/providers/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider }),
  });
  const j: any = await r.json().catch(() => ({}));
  return {
    ok: Boolean(j?.ok),
    detail: String(j?.detail || (r.ok ? 'Provider test passed.' : `Provider test failed (${r.status}).`)),
    status: j?.status
      ? {
          id: String(j.status.id || provider) as AIProvider,
          enabled: Boolean(j.status.enabled),
          configured: Boolean(j.status.configured ?? j.status.enabled),
          reachable: j.status.reachable === undefined ? null : j.status.reachable === null ? null : Boolean(j.status.reachable),
          detail: String(j.status.detail || ''),
        }
      : undefined,
  };
}

export async function generateCode(req: GenReq & { provider?: AIProvider }): Promise<GenRes> {
  const provider: AIProvider = (req.provider || 'ollama') as AIProvider;
  try {
    if (USE_OLLAMA && provider === 'ollama') {
      const r = await fetch(`${ollama}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: req.model ?? 'codellama:7b-code',
          prompt: req.prompt,
          stream: false
        })
      });
      if (!r.ok) throw new Error(`ollama ${r.status}`);
      const j: any = await r.json();
      return { code: (j?.response ?? '').toString().trim() };
    } else {
      try {
        const r = await fetch(`${backend}/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: req.prompt, model: req.model, language: req.language, provider })
        });
        if (!r.ok) {
          const detail = await readErrorDetail(r, `backend ${r.status}`);
          throw new Error(detail);
        }
        const j: any = await r.json();
        return { code: (j?.response ?? '').toString().trim() };
      } catch (err: any) {
        if (provider !== 'ollama') throw err;
        try {
          const native = await nativeOllamaGenerate(req);
          return { code: native };
        } catch {
          // fallback below
        }
        const or = await fetch(`${ollama}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: req.model ?? 'qwen2.5-coder:0.5b',
            prompt: req.prompt,
            stream: false
          })
        });
        if (!or.ok) {
          const detail = await readErrorDetail(or, `ollama ${or.status}`);
          throw new Error(detail);
        }
        const oj: any = await or.json();
        return { code: (oj?.response ?? '').toString().trim() };
      }
    }
  } catch (e: any) {
    return { code: '', error: e?.message || 'generate_failed' };
  }
}

export async function getAvailableModels(): Promise<Array<{id:string;name:string;description?:string}>> {
  return getAvailableModelsForProvider('ollama');
}

export async function getAvailableModelsForProvider(provider: AIProvider): Promise<Array<{id:string;name:string;description?:string}>> {
  try {
    const unique = new Map<string, {id:string;name:string;description?:string}>();

    if (provider === 'ollama') {
      const native = await nativeOllamaModels();
      native.forEach((m) => unique.set(m.id, m));
    }

    if (USE_OLLAMA && provider === 'ollama') {
      if (unique.size > 0) return Array.from(unique.values());
      return await fetchOllamaModels();
    } else {
      const r = await fetch(`${backend}/models?provider=${encodeURIComponent(provider)}`);
      if (!r.ok) throw new Error(`backend ${r.status}`);
      const j: any = await r.json();
      const names: string[] = j?.models ?? [];
      names.forEach((name) => {
        const id = String(name || '').trim();
        if (!id) return;
        unique.set(id, { id, name: id });
      });

      // Secondary source: direct Ollama tags when available, to avoid stale backend caches.
      try {
        if (provider !== 'ollama') throw new Error('skip_direct_ollama_for_non_ollama_provider');
        const or = await fetch(`${ollama}/api/tags`);
        if (or.ok) {
          const oj: any = await or.json();
          const omodels = Array.isArray(oj?.models) ? oj.models : [];
          omodels.forEach((m: any) => {
            const id = String(m?.name || '').trim();
            if (!id) return;
            unique.set(id, {
              id,
              name: id,
              description: m?.details?.family || 'Ollama'
            });
          });
        }
      } catch {
        // ignore direct ollama lookup failures
      }

      if (unique.size > 0) return Array.from(unique.values());
      const fallback = provider === 'openai' ? 'gpt-4.1-mini' : provider === 'anthropic' ? 'claude-3-5-haiku-latest' : provider === 'gemini' ? 'gemini-2.5-flash' : 'qwen2.5-coder:0.5b';
      return [{ id: fallback, name: fallback }];
    }
  } catch {
    try {
      if (provider !== 'ollama') throw new Error('no_direct_fallback_for_non_ollama');
      const direct = await fetchOllamaModels();
      if (direct.length > 0) return direct;
    } catch {
      // ignore
    }
    const fallback = provider === 'openai' ? 'gpt-4.1-mini' : provider === 'anthropic' ? 'claude-3-5-haiku-latest' : provider === 'gemini' ? 'gemini-2.5-flash' : 'qwen2.5-coder:0.5b';
    return [{ id: fallback, name: fallback }];
  }
}

export async function streamGenerate(
  req: { prompt: string; model?: string; language?: string; provider?: AIProvider },
  onDelta: (chunk: string) => void
): Promise<void> {
  const provider = (req.provider || 'ollama') as AIProvider;
  let hadDelta = false;
  try {
    const r = await fetch(`${backend}/generate/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...req, provider })
    });
    if (!r.ok || !r.body) {
      const detail = !r.ok ? await readErrorDetail(r, `stream failed: ${r.status}`) : 'stream body missing';
      throw new Error(detail);
    }

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      const parts = buf.split('\n\n');
      buf = parts.pop() || '';
      for (const evt of parts) {
        const lines = evt.split('\n');
        const type = lines[0].startsWith('event:') ? lines[0].slice(6).trim() : 'message';
        const dataLine = lines.find(l => l.startsWith('data:'));
        const data = dataLine ? dataLine.slice(5).trim() : '';
        if (type === 'done') {
          if (!hadDelta) throw new Error('stream returned no content');
          return;
        }
        if (type === 'error') throw new Error(data || 'stream_error');
        if (data) {
          try {
            const j = JSON.parse(data);
            if (j.delta) {
              hadDelta = true;
              onDelta(j.delta);
            }
          } catch { /* ignore */ }
        }
      }
    }

    if (!hadDelta) throw new Error('stream ended without content');
  } catch {
    // Tauri fallback (or transient stream failures): one-shot generation
    try {
      if (provider !== 'ollama') throw new Error('non_ollama_provider');
      const native = await nativeOllamaGenerate(req as any);
      if (native) {
        onDelta(native);
        return;
      }
    } catch {
      // ignore
    }
    const one = await generateCode(req as any);
    if (one.code) {
      onDelta(one.code);
      return;
    }
    throw new Error(one.error || 'stream generation failed');
  }
}
export async function checkHealth(): Promise<{ok:boolean;status?:string}> {
  const url = USE_OLLAMA ? `${ollama}/api/tags` : `${backend}/health`;
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return { ok: false };
    return { ok: true, status: 'healthy' };
  } catch {
    return { ok: false };
  }
}

export async function getWebWorkspaceInfo(): Promise<{ root: string; rootLabel: string; branch: string | null }> {
  const r = await fetch(`${backend}/workspace/info`);
  if (!r.ok) {
    const detail = await readErrorDetail(r, `workspace/info ${r.status}`);
    throw new Error(detail);
  }
  const j: any = await r.json();
  return {
    root: String(j?.root || ''),
    rootLabel: String(j?.rootLabel || ''),
    branch: j?.branch == null ? null : String(j.branch),
  };
}

export async function getWebWorkspaceTree(depth = 4): Promise<WorkspaceNode[]> {
  const r = await fetch(`${backend}/workspace/tree?depth=${encodeURIComponent(String(depth))}`);
  if (!r.ok) {
    const detail = await readErrorDetail(r, `workspace/tree ${r.status}`);
    throw new Error(detail);
  }
  const j: any = await r.json();
  return Array.isArray(j?.nodes) ? (j.nodes as WorkspaceNode[]) : [];
}

export async function getWebWorkspaceFile(filePath: string): Promise<string> {
  const r = await fetch(`${backend}/workspace/file?path=${encodeURIComponent(filePath)}`);
  if (!r.ok) {
    const detail = await readErrorDetail(r, `workspace/file ${r.status}`);
    throw new Error(detail);
  }
  const j: any = await r.json();
  return String(j?.content || '');
}

export async function getWebWorkspaceSnapshot(limit = 14000): Promise<string> {
  const r = await fetch(`${backend}/workspace/snapshot?limit=${encodeURIComponent(String(limit))}`);
  if (!r.ok) {
    const detail = await readErrorDetail(r, `workspace/snapshot ${r.status}`);
    throw new Error(detail);
  }
  const j: any = await r.json();
  return String(j?.snapshot || '');
}

