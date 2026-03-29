import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'

dotenv.config()

const PORT = Number(process.env.PORT) || 3001
type Provider = 'ollama' | 'openai' | 'anthropic' | 'gemini'
type ProviderStatus = {
  id: Provider
  enabled: boolean
  configured: boolean
  reachable: boolean | null
  detail: string
}

// Try env first, then both localhost variants
const OLLAMA_URLS = [
  process.env.OLLAMA_URL,
  process.env.OLLAMA_HOST,
  'http://127.0.0.1:11434',
  'http://localhost:11434',
].filter(Boolean) as string[]
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || ''
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''

const DEFAULT_MODELS: Record<Provider, string[]> = {
  ollama: ['qwen2.5-coder:0.5b'],
  openai: ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini'],
  anthropic: ['claude-3-5-haiku-latest', 'claude-3-7-sonnet-latest'],
  gemini: ['gemini-2.5-flash', 'gemini-2.5-pro'],
}

function parseProvider(input: any): Provider {
  const v = String(input || 'ollama').toLowerCase()
  if (v === 'openai' || v === 'anthropic' || v === 'gemini') return v
  return 'ollama'
}

function isConfigured(provider: Provider): boolean {
  if (provider === 'openai') return Boolean(OPENAI_API_KEY)
  if (provider === 'anthropic') return Boolean(ANTHROPIC_API_KEY)
  if (provider === 'gemini') return Boolean(GEMINI_API_KEY)
  return true
}

function providerStatus(provider: Provider): ProviderStatus {
  if (provider === 'ollama') {
    return {
      id: 'ollama',
      enabled: true,
      configured: true,
      reachable: null,
      detail: 'Local provider. Use Ollama running on this machine.',
    }
  }

  const configured = isConfigured(provider)
  const label = provider === 'openai' ? 'OPENAI_API_KEY' : provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'GEMINI_API_KEY'
  return {
    id: provider,
    enabled: configured,
    configured,
    reachable: null,
    detail: configured ? 'API key detected.' : `Missing ${label} in backend environment.`,
  }
}

async function callOllama(path: string, init?: RequestInit): Promise<Response> {
  let lastErr: any
  for (const base of OLLAMA_URLS) {
    try {
      const r = await fetch(`${base}${path}`, init)
      if (!r.ok) throw new Error(`${base}${path} -> ${r.status}`)
      return r
    } catch (e) {
      lastErr = e
      console.error('[ollama]', String(e))
    }
  }
  throw lastErr ?? new Error('Could not reach Ollama on any URL')
}

async function listInstalledModels(): Promise<string[]> {
  try {
    const upstream = await callOllama('/api/tags')
    const data: any = await upstream.json()
    return Array.isArray(data?.models) ? data.models.map((m: any) => m?.name).filter(Boolean) : []
  } catch {
    return []
  }
}

function pickModel(requestedModel: string, installedModels: string[]): string | null {
  if (installedModels.includes(requestedModel)) return requestedModel
  if (installedModels.length > 0) return installedModels[0]
  return null
}

async function listOpenAIModels(): Promise<string[]> {
  if (!OPENAI_API_KEY) return []
  try {
    const r = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    })
    if (!r.ok) throw new Error(`openai_models_${r.status}`)
    const j: any = await r.json()
    const ids = Array.isArray(j?.data) ? j.data.map((m: any) => String(m?.id || '')) : []
    const filtered = ids.filter((id: string) => /^gpt-/.test(id)).sort()
    return filtered.length > 0 ? filtered : DEFAULT_MODELS.openai
  } catch {
    return DEFAULT_MODELS.openai
  }
}

async function generateWithOpenAI(prompt: string, model: string): Promise<string> {
  if (!OPENAI_API_KEY) throw new Error('openai_api_key_missing')
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!r.ok) {
    const txt = await r.text().catch(() => '')
    throw new Error(`openai_generate_${r.status}: ${txt}`)
  }
  const j: any = await r.json()
  return String(j?.choices?.[0]?.message?.content || '').trim()
}

async function generateWithAnthropic(prompt: string, model: string): Promise<string> {
  if (!ANTHROPIC_API_KEY) throw new Error('anthropic_api_key_missing')
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!r.ok) {
    const txt = await r.text().catch(() => '')
    throw new Error(`anthropic_generate_${r.status}: ${txt}`)
  }
  const j: any = await r.json()
  const content = Array.isArray(j?.content) ? j.content : []
  const text = content.map((c: any) => c?.text || '').join('\n')
  return String(text || '').trim()
}

async function generateWithGemini(prompt: string, model: string): Promise<string> {
  if (!GEMINI_API_KEY) throw new Error('gemini_api_key_missing')
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2 },
    }),
  })
  if (!r.ok) {
    const txt = await r.text().catch(() => '')
    throw new Error(`gemini_generate_${r.status}: ${txt}`)
  }
  const j: any = await r.json()
  const text =
    j?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || '').join('\n') || ''
  return String(text).trim()
}

async function testProvider(provider: Provider): Promise<{ ok: boolean; detail: string }> {
  try {
    if (provider === 'ollama') {
      const upstream = await callOllama('/api/tags')
      const j: any = await upstream.json()
      const count = Array.isArray(j?.models) ? j.models.length : 0
      return { ok: true, detail: `Ollama reachable. ${count} model(s) detected.` }
    }

    if (provider === 'openai') {
      if (!OPENAI_API_KEY) return { ok: false, detail: 'Missing OPENAI_API_KEY.' }
      const r = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      })
      if (!r.ok) return { ok: false, detail: `OpenAI test failed (${r.status}).` }
      return { ok: true, detail: 'OpenAI connection is healthy.' }
    }

    if (provider === 'anthropic') {
      if (!ANTHROPIC_API_KEY) return { ok: false, detail: 'Missing ANTHROPIC_API_KEY.' }
      const r = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
      })
      if (!r.ok) return { ok: false, detail: `Anthropic test failed (${r.status}).` }
      return { ok: true, detail: 'Anthropic connection is healthy.' }
    }

    if (!GEMINI_API_KEY) return { ok: false, detail: 'Missing GEMINI_API_KEY.' }
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(GEMINI_API_KEY)}`
    )
    if (!r.ok) return { ok: false, detail: `Gemini test failed (${r.status}).` }
    return { ok: true, detail: 'Gemini connection is healthy.' }
  } catch (err: any) {
    return { ok: false, detail: String(err?.message || err || 'unknown_error') }
  }
}

const app = express()

app.use(cors({
  origin: ['tauri://localhost', 'http://localhost:5173', '*'],
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}))
app.options(/.*/, cors())

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// tiny logger
app.use((req, _res, next) => { console.log(new Date().toISOString(), req.method, req.url); next() })

app.get(['/health', '/api/health', '/v1/health'], (_req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.json({ ok: true, status: 'healthy', timestamp: new Date().toISOString() })
})

app.get(['/models', '/api/models', '/v1/models'], async (_req, res) => {
  const provider = parseProvider((_req.query as any)?.provider)
  try {
    let models: string[] = []
    if (provider === 'openai') {
      models = await listOpenAIModels()
    } else if (provider === 'anthropic') {
      models = ANTHROPIC_API_KEY ? DEFAULT_MODELS.anthropic : []
    } else if (provider === 'gemini') {
      models = GEMINI_API_KEY ? DEFAULT_MODELS.gemini : []
    } else {
      const upstream = await callOllama('/api/tags')
      const data: any = await upstream.json()
      models = Array.isArray(data?.models) ? data.models.map((m: any) => m.name).filter(Boolean) : []
    }
    res.json({ models })
  } catch (err: any) {
    console.error('GET /models:', err?.message || err)
    res.json({ models: DEFAULT_MODELS[provider] || DEFAULT_MODELS.ollama })
  }
})

app.get(['/providers', '/api/providers', '/v1/providers'], (_req, res) => {
  res.json({
    providers: [
      providerStatus('ollama'),
      providerStatus('openai'),
      providerStatus('anthropic'),
      providerStatus('gemini'),
    ],
  })
})

app.get(['/providers/status', '/api/providers/status', '/v1/providers/status'], (_req, res) => {
  res.json({
    providers: [
      providerStatus('ollama'),
      providerStatus('openai'),
      providerStatus('anthropic'),
      providerStatus('gemini'),
    ],
  })
})

app.post(['/providers/test', '/api/providers/test', '/v1/providers/test'], async (req, res) => {
  const provider = parseProvider((req.body as any)?.provider)
  const result = await testProvider(provider)
  const base = providerStatus(provider)
  res.status(result.ok ? 200 : 502).json({
    provider,
    ok: result.ok,
    detail: result.detail,
    status: {
      ...base,
      reachable: result.ok,
      detail: result.detail,
    },
  })
})

async function generateHandler(req: express.Request, res: express.Response) {
  const { prompt, model = 'codellama:7b-code', language, provider: providerInput } = req.body || {}
  const provider = parseProvider(providerInput)
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Missing "prompt" (string)' })
  }
  try {
    const fullPrompt =
      language && typeof language === 'string'
        ? `Write ${language} code.\n${prompt}`
        : prompt

    if (provider === 'openai') {
      const selectedModel = model || DEFAULT_MODELS.openai[0]
      const response = await generateWithOpenAI(fullPrompt, selectedModel)
      return res.json({ response, model: selectedModel, provider })
    }
    if (provider === 'anthropic') {
      const selectedModel = model || DEFAULT_MODELS.anthropic[0]
      const response = await generateWithAnthropic(fullPrompt, selectedModel)
      return res.json({ response, model: selectedModel, provider })
    }
    if (provider === 'gemini') {
      const selectedModel = model || DEFAULT_MODELS.gemini[0]
      const response = await generateWithGemini(fullPrompt, selectedModel)
      return res.json({ response, model: selectedModel, provider })
    }

    const installedModels = await listInstalledModels()
    const selectedModel = pickModel(model, installedModels)
    if (!selectedModel) {
      return res.status(503).json({
        error: 'no_models_installed',
        detail: 'No local Ollama models were found. Pull one model first, e.g. qwen2.5-coder:0.5b.',
      })
    }

    const upstream = await callOllama('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: selectedModel, prompt: fullPrompt, stream: false }),
    })
    const data: any = await upstream.json()

    const response: string = (data?.response ?? '').toString()
    res.json({ response, model: selectedModel, provider })
  } catch (err: any) {
    console.error('POST /generate:', err?.message || err)
    res.status(502).json({ error: 'Generation failed', detail: String(err?.message || err) })
  }
}

app.post(['/generate', '/api/generate', '/v1/generate'], generateHandler)

app.post(['/generate/stream', '/api/generate/stream', '/v1/generate/stream'], async (req, res) => {
  const { prompt, model = 'codellama:7b-code', language, provider: providerInput } = req.body || {}
  const provider = parseProvider(providerInput)
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Missing "prompt" (string)' })
  }

  try {
    const fullPrompt =
      language && typeof language === 'string'
        ? `Write ${language} code.\n${prompt}`
        : prompt

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders?.()

    if (provider !== 'ollama') {
      const selectedModel = model || DEFAULT_MODELS[provider][0]
      let response = ''
      if (provider === 'openai') response = await generateWithOpenAI(fullPrompt, selectedModel)
      if (provider === 'anthropic') response = await generateWithAnthropic(fullPrompt, selectedModel)
      if (provider === 'gemini') response = await generateWithGemini(fullPrompt, selectedModel)
      res.write(`data: ${JSON.stringify({ delta: response })}\n\n`)
      res.write('event: done\ndata: {}\n\n')
      res.end()
      return
    }

    const installedModels = await listInstalledModels()
    const selectedModel = pickModel(model, installedModels)

    if (!selectedModel) {
      res.write(`event: error\ndata: ${JSON.stringify({
        error: 'no_models_installed',
        detail: 'No local Ollama models were found. Pull one model first, e.g. qwen2.5-coder:0.5b.',
      })}\n\n`)
      res.end()
      return
    }

    let upstream: Response | null = null
    let lastUpstreamError = ''
    for (const base of OLLAMA_URLS) {
      try {
        const maybe = await fetch(`${base}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: selectedModel, prompt: fullPrompt, stream: true }),
        })
        if (maybe.ok && maybe.body) {
          upstream = maybe
          break
        }
        const txt = await maybe.text().catch(() => '')
        lastUpstreamError = txt || `${maybe.status}`
      } catch (e) {
        console.error('[ollama stream]', String(e))
        lastUpstreamError = String(e)
      }
    }

    if (!upstream?.body) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'stream_upstream_failed', detail: lastUpstreamError || 'unknown_upstream_error' })}\n\n`)
      res.end()
      return
    }

    const reader = upstream.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })

      let nl = buf.indexOf('\n')
      while (nl !== -1) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (line) {
          try {
            const j = JSON.parse(line)
            if (j?.response) {
              res.write(`data: ${JSON.stringify({ delta: String(j.response) })}\n\n`)
            }
            if (j?.done) {
              res.write('event: done\ndata: {}\n\n')
              res.end()
              return
            }
          } catch {
            // Ignore malformed JSON chunks
          }
        }
        nl = buf.indexOf('\n')
      }
    }

    res.write('event: done\ndata: {}\n\n')
    res.end()
  } catch (err: any) {
    console.error('POST /generate/stream:', err?.message || err)
    res.write(`event: error\ndata: ${JSON.stringify({ error: 'Generation stream failed', detail: String(err?.message || err) })}\n\n`)
    res.end()
  }
})

app.listen(PORT, () => {
  console.log(`🚀 FANO-LABS backend server running on http://127.0.0.1:${PORT}`)
  console.log(`📊 Health check: http://127.0.0.1:${PORT}/health`)
})
