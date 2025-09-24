import { Router } from 'express';
import { z } from 'zod';
import { listModels as listOllama, generate as genOllama } from '../providers/ollama';
import { listModels as listOpenAI, generate as genOpenAI } from '../providers/openai';

export const router = Router();

const provider = (process.env.FANO_PROVIDER || 'ollama').toLowerCase();

router.get('/models', async (_req, res) => {
  try {
    const models = provider === 'openai' ? await listOpenAI() : await listOllama();
    res.json({ models });
  } catch (e: any) {
    console.error('GET /models error:', e?.message);
    res.status(500).json({ error: e?.message || 'models_failed' });
  }
});

const GenSchema = z.object({
  prompt: z.string().min(1),
  model: z.string().optional(),
  language: z.string().optional(),
  stream: z.boolean().optional()
});

router.post('/generate', async (req, res) => {
  const t0 = Date.now();
  try {
    const { prompt, model = provider === 'openai' ? 'gpt-4o-mini' : 'codellama:7b-code', language, stream = false } = GenSchema.parse(req.body);
    console.log('POST /generate in', { provider, model, language, promptLen: prompt.length });
    if (provider === 'openai') {
      await genOpenAI({ model, prompt, stream });
      return res.status(501).json({ error: 'openai_not_implemented' });
    }
    // For Ollama, steer the LLM to return code only, gated by explicit markers
    const langPart = language ? ` in ${language}` : '';
    const startToken = '<<<JS\n';
    const endToken = '\n>>>';
    const systemInstruction =
      `You are a senior coding assistant. Return ONLY raw${langPart} code with no explanations, no markdown fences, and no HTML. Enclose ONLY the code between ${startToken.trim()} and ${endToken.trim()}.`;
    const steeredPrompt = `${startToken}${systemInstruction}\n\n${prompt}${endToken}`;

    // Be explicit with deterministic low-temp options to avoid long thinking
    console.log('→ calling Ollama', { model, timeoutMs: 120000 });
    const r = await genOllama(
      {
        model,
        prompt: steeredPrompt,
        stream: false,
        options: {
          temperature: 0.1,
          top_p: 0.9,
          num_predict: 64,
          stop: ["```", "</details>", "</summary>", endToken.trim()]
        }
      },
      { timeoutMs: 120000 }
    );
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      console.error('← Ollama error', r.status, txt.slice(0, 500));
      return res.status(502).json({ error: `ollama_upstream_${r.status}`, details: txt });
    }
    const j: any = await r.json();
    const raw = (j?.response || '').toString();

    // Extract code between markers or fences; fallback to first function/arrow/oneliner
    const marked = raw.match(/<<<JS\n([\s\S]*?)\n>>>/);
    const fenced = raw.match(/```[a-zA-Z0-9_-]*\n([\s\S]*?)```/);
    const body = (marked ? marked[1] : fenced ? fenced[1] : raw).toString();
    let code = body.replace(/^#+.*$/gm, '').trim();
    if (code.length < 2) {
      const func = body.match(/function\s+\w+\s*\([^)]*\)\s*\{[\s\S]*?\}/);
      const arrow = body.match(/\bconst\s+\w+\s*=\s*\([^)]*\)\s*=>\s*\{?[\s\S]*?\}?\s*;/);
      const oneliner = body.match(/\bfunction\s+\w+\([^)]*\)\{[^}]*\}/);
      code = (func?.[0] || arrow?.[0] || oneliner?.[0] || raw).toString().trim();
    }

    console.log('← /generate ok in', Date.now() - t0, 'ms, codeLen:', code.length);
    return res.json({ response: code });
  } catch (e: any) {
    console.error('POST /generate failed in', Date.now() - t0, 'ms:', e?.message);
    res.status(400).json({ error: e?.message || 'generate_failed' });
  }
});

router.post('/generate/stream', async (req, res) => {
  const t0 = Date.now();
  const abort = new AbortController();
  req.on('close', () => abort.abort());

  try {
    const { prompt, model = provider === 'openai' ? 'gpt-4o-mini' : 'codellama:7b-code', language } = GenSchema.parse({ ...req.body, stream: true });

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    if (provider === 'openai') {
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'openai_stream_not_implemented' })}\n\n`);
      return res.end();
    }

    const langPart = language ? ` in ${language}` : '';
    const startToken = '<<<JS\n';
    const endToken = '\n>>>';
    const systemInstruction = `You are a senior coding assistant. Return ONLY raw${langPart} code with no explanations, no markdown fences, and no HTML. Enclose ONLY the code between ${startToken.trim()} and ${endToken.trim()}.`;
    const steeredPrompt = `${startToken}${systemInstruction}\n\n${prompt}${endToken}`;

    const upstream = await fetch((process.env.OLLAMA_HOST || 'http://127.0.0.1:11434') + '/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: steeredPrompt,
        stream: true,
        options: { temperature: 0.1, top_p: 0.9, num_predict: 128, stop: ['```', '</details>', '</summary>', endToken.trim()] }
      }),
      signal: abort.signal
    });

    if (!upstream.ok || !upstream.body) {
      const txt = await upstream.text().catch(() => '');
      res.write(`event: error\ndata: ${JSON.stringify({ error: `ollama_${upstream.status}`, details: txt })}\n\n`);
      return res.end();
    }

    let gateBuf = '';
    let started = false;
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });

      // Ollama streams one JSON object per line
      gateBuf += chunk;
      let nl;
      while ((nl = gateBuf.indexOf('\n')) !== -1) {
        const line = gateBuf.slice(0, nl).trim();
        gateBuf = gateBuf.slice(nl + 1);
        if (!line) continue;
        let delta = '';
        try {
          const json = JSON.parse(line);
          if (json.response) delta = String(json.response);
          if (json.done) {
            res.write(`event: done\ndata: {}\n\n`);
            return res.end();
          }
        } catch {
          // ignore non-JSON lines
          continue;
        }

        if (!delta) continue;

        // Marker gate: only forward text between startToken and endToken
        let buf = delta;
        let out = '';
        while (buf.length) {
          if (!started) {
            const i = buf.indexOf(startToken);
            if (i === -1) break; // drop until we see start
            started = true;
            buf = buf.slice(i + startToken.length);
          }
          const j = buf.indexOf(endToken);
          if (j === -1) { out += buf; buf = ''; }
          else { out += buf.slice(0, j); buf = ''; started = false; }
        }
        if (out) res.write(`data: ${JSON.stringify({ delta: out })}\n\n`);
      }
    }

    res.write(`event: done\ndata: {}\n\n`);
    res.end();
    console.log('← /generate/stream ended in', Date.now() - t0, 'ms');
  } catch (e: any) {
    console.error('POST /generate/stream failed in', Date.now() - t0, 'ms:', e?.message);
    res.write(`event: error\ndata: ${JSON.stringify({ error: e?.message || 'stream_failed' })}\n\n`);
    res.end();
  }
});
