import { invoke } from '@tauri-apps/api/core';

type GenReq = { prompt: string; model?: string; language?: string; context?: string };
type GenRes = { code: string; error?: string };

const USE_OLLAMA = String((import.meta as any).env?.VITE_USE_OLLAMA ?? 'false') === 'true';
const OLLAMA_URL =
  (import.meta as any).env?.VITE_OLLAMA_URL ?? 'http://127.0.0.1:11434';
const BACKEND_URL =
  (import.meta as any).env?.VITE_BACKEND_URL ?? 'http://127.0.0.1:3001';

const backend = BACKEND_URL.replace(/\/$/, '');
const ollama = OLLAMA_URL.replace(/\/$/, '');

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
  if (!isTauriRuntime()) return [];
  const names = await invoke<string[]>('list_local_models');
  if (!Array.isArray(names)) return [];
  return names
    .map((name) => String(name || '').trim())
    .filter(Boolean)
    .map((id) => ({ id, name: id, description: 'Local Ollama' }));
}

async function nativeOllamaGenerate(req: GenReq): Promise<string> {
  if (!isTauriRuntime()) throw new Error('native_ollama_unavailable');
  const out = await invoke<string>('generate_with_ollama', {
    prompt: req.prompt,
    model: req.model ?? 'qwen2.5-coder:0.5b'
  });
  const text = String(out || '').trim();
  if (!text) throw new Error('empty_native_ollama_response');
  return text;
}

export async function generateCode(req: GenReq): Promise<GenRes> {
  try {
    if (USE_OLLAMA) {
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
          body: JSON.stringify({ prompt: req.prompt, model: req.model, language: req.language })
        });
        if (!r.ok) throw new Error(`backend ${r.status}`);
        const j: any = await r.json();
        return { code: (j?.response ?? '').toString().trim() };
      } catch {
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
        if (!or.ok) throw new Error(`ollama ${or.status}`);
        const oj: any = await or.json();
        return { code: (oj?.response ?? '').toString().trim() };
      }
    }
  } catch (e: any) {
    return { code: '', error: e?.message || 'generate_failed' };
  }
}

export async function getAvailableModels(): Promise<Array<{id:string;name:string;description?:string}>> {
  try {
    const unique = new Map<string, {id:string;name:string;description?:string}>();

    if (isTauriRuntime()) {
      try {
        const native = await nativeOllamaModels();
        native.forEach((m) => unique.set(m.id, m));
      } catch {
        // ignore
      }
    }

    if (USE_OLLAMA) {
      if (unique.size > 0) return Array.from(unique.values());
      return await fetchOllamaModels();
    } else {
      const r = await fetch(`${backend}/models`);
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
      return [{ id: 'qwen2.5-coder:0.5b', name: 'qwen2.5-coder:0.5b' }];
    }
  } catch {
    try {
      const direct = await fetchOllamaModels();
      if (direct.length > 0) return direct;
    } catch {
      // ignore
    }
    return [{ id: 'qwen2.5-coder:0.5b', name: 'qwen2.5-coder:0.5b' }];
  }
}

export async function streamGenerate(
  req: { prompt: string; model?: string; language?: string },
  onDelta: (chunk: string) => void
): Promise<void> {
  let hadDelta = false;
  try {
    const r = await fetch(`${backend}/generate/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req)
    });
    if (!r.ok || !r.body) throw new Error(`stream failed: ${r.status}`);

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

