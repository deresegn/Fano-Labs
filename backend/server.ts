import express from 'express'
import cors from 'cors'

const PORT = Number(process.env.PORT) || 3001

// Try env first, then both localhost variants
const OLLAMA_URLS = [
  process.env.OLLAMA_URL,
  'http://127.0.0.1:11434',
  'http://localhost:11434',
].filter(Boolean) as string[]

async function callOllama(path: string, init?: RequestInit) {
  let lastErr: any
  for (const base of OLLAMA_URLS) {
    try {
      const r = await fetch(`${base}${path}`, init)
      if (!r.ok) throw new Error(`${base}${path} -> ${r.status}`)
      return await r.json()
    } catch (e) {
      lastErr = e
      console.error('[ollama]', String(e))
    }
  }
  throw lastErr ?? new Error('Could not reach Ollama on any URL')
}

const app = express()

app.use(cors({
  origin: ['tauri://localhost', 'http://localhost:5173', '*'],
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}))
app.options('*', cors())

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// tiny logger
app.use((req, _res, next) => { console.log(new Date().toISOString(), req.method, req.url); next() })

app.get(['/health', '/api/health', '/v1/health'], (_req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.json({ ok: true, status: 'ok', timestamp: new Date().toISOString() })
})

app.get('/models', async (_req, res) => {
  try {
    const data: any = await callOllama('/api/tags')
    const models = Array.isArray(data?.models) ? data.models.map((m: any) => m.name).filter(Boolean) : []
    res.json({ models })
  } catch (err: any) {
    console.error('GET /models:', err?.message || err)
    res.json({ models: ['codellama:7b-code'] })
  }
})

app.post('/generate', async (req, res) => {
  const { prompt, model = 'codellama:7b-code', language } = req.body || {}
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Missing "prompt" (string)' })
  }
  try {
    const fullPrompt =
      language && typeof language === 'string'
        ? `Write ${language} code.\n${prompt}`
        : prompt

    const data: any = await callOllama('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: fullPrompt, stream: false }),
    })

    const text: string = data?.response ?? ''
    res.json({ text, model })
  } catch (err: any) {
    console.error('POST /generate:', err?.message || err)
    res.status(502).json({ error: 'Generation failed', detail: String(err?.message || err) })
  }
})

app.listen(PORT, () => {
  console.log(`🚀 FANO-LABS backend server running on http://127.0.0.1:${PORT}`)
  console.log(`📊 Health check: http://127.0.0.1:${PORT}/health`)
})
