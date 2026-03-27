import express from 'express'
import cors from 'cors'

const PORT = Number(process.env.PORT) || 3001

// Try env first, then both localhost variants
const OLLAMA_URLS = [
  process.env.OLLAMA_URL,
  process.env.OLLAMA_HOST,
  'http://127.0.0.1:11434',
  'http://localhost:11434',
].filter(Boolean) as string[]

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
  try {
    const upstream = await callOllama('/api/tags')
    const data: any = await upstream.json()
    const models = Array.isArray(data?.models) ? data.models.map((m: any) => m.name).filter(Boolean) : []
    res.json({ models })
  } catch (err: any) {
    console.error('GET /models:', err?.message || err)
    res.json({ models: ['codellama:7b-code'] })
  }
})

async function generateHandler(req: express.Request, res: express.Response) {
  const { prompt, model = 'codellama:7b-code', language } = req.body || {}
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Missing "prompt" (string)' })
  }
  try {
    const installedModels = await listInstalledModels()
    const selectedModel = pickModel(model, installedModels)
    if (!selectedModel) {
      return res.status(503).json({
        error: 'no_models_installed',
        detail: 'No local Ollama models were found. Pull one model first, e.g. qwen2.5-coder:0.5b.',
      })
    }

    const fullPrompt =
      language && typeof language === 'string'
        ? `Write ${language} code.\n${prompt}`
        : prompt

    const upstream = await callOllama('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: selectedModel, prompt: fullPrompt, stream: false }),
    })
    const data: any = await upstream.json()

    const response: string = (data?.response ?? '').toString()
    res.json({ response, model: selectedModel })
  } catch (err: any) {
    console.error('POST /generate:', err?.message || err)
    res.status(502).json({ error: 'Generation failed', detail: String(err?.message || err) })
  }
}

app.post(['/generate', '/api/generate', '/v1/generate'], generateHandler)

app.post(['/generate/stream', '/api/generate/stream', '/v1/generate/stream'], async (req, res) => {
  const { prompt, model = 'codellama:7b-code', language } = req.body || {}
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Missing "prompt" (string)' })
  }

  try {
    const installedModels = await listInstalledModels()
    const selectedModel = pickModel(model, installedModels)

    const fullPrompt =
      language && typeof language === 'string'
        ? `Write ${language} code.\n${prompt}`
        : prompt

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders?.()

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
